// train-sync — private pipe between the Train PWA and the vault. v2: multiplayer.
// Auth: Bearer token. env.SYNC_TOKEN = Patrick (admin, back-compat with the live app
// and the iMac sync agent). Other players: tokens minted via POST /admin/player,
// stored as sha256 hashes in the KV blob `auth` ({hash: pid}).
//
// Storage layout (per-player separation — friends' data must never ride the
// patrick-only vault sync):
//   patrick: legacy keys unchanged — log:<ts>:<sid>, idx:log, unprefixed R2 keys
//   others:  log:<ts>:<pid>:<sid> indexed in idx:log:<pid>; R2 keys forced under p/<pid>/
//   game (all players): scores:<pid> blob {day: score}, feed blob, challenges blob, players blob
//
// Routes:
// POST /log            session log -> KV (player-scoped)
// POST /upload?key=..  media -> R2 (non-admin keys forced under p/<pid>/)
// GET  /logs           caller's OWN logs back (restore after an app reinstall wipes localStorage)
// GET  /pull           PATRICK-ONLY logs+media since ?after= (vault sync agent; friends' data excluded by design)
// GET/DELETE /media/:key   (non-admin restricted to own p/<pid>/ prefix)
// POST/GET /feedback   per-clip coach notes (non-admin sees own clips only)
// POST /score          {day, score} -> scores:<pid>; keeps server-side adj; feed on big jumps
// POST /score/adjust   {pid, day, coach?, whoop?} coach/WHOOP bonuses (admin only)
// GET  /scoreboard?day=YYYY-MM-DD   daily/weekly/monthly totals for every player
// GET  /feed           last 100 events
// POST /challenge      {title, desc, mode:'boss'|'player', wager?, expiresDay?} (boss = admin only; wager clamped 10-200, default 50)
// POST /challenge/result {id, result, clipKey?}
// POST /challenge/close  {id, winner?, second?} settle it (issuer or admin); W-L in `cwl`; wager settles
//                        via adj.challenge — winner +wager, 2nd +half; ONLY the issuer can lose
//                        (2nd: -half, out of the money: -wager); boss mode nobody pays
// GET  /scoreboard also runs the lazy weekly close (`weeks` + `wl` blobs) and returns wl/cwl/lastWeek
// GET  /challenges     open + recently closed
// GET  /me             {pid, name, admin, onboarded, profile}
// POST /me/profile     player writes their OWN intake (onboarding); sets profile.onboarded
// POST /admin/player   {pid, name} -> mints + returns a token ONCE (admin only)
// GET  /admin/players  roster w/o hashes (admin only)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- KV blob helpers (free-tier discipline: hot paths are gets on blobs, never list()) ----
async function blobGet(env, name, fallback) {
  try { const v = await env.LOGS.get(name); return v === null ? fallback : (JSON.parse(v) ?? fallback); } catch (e) { return fallback; }
}
const blobPut = (env, name, v) => env.LOGS.put(name, JSON.stringify(v));

async function idxGet(env, name) { return blobGet(env, 'idx:' + name, []); }
async function idxAdd(env, name, key) {
  const a = await idxGet(env, name);
  if (!a.includes(key)) { a.push(key); await blobPut(env, 'idx:' + name, a); }
}

// All feedback lives in ONE blob key (fb-all: {clipKey: {notes,at}}) — see v1 notes:
// per-clip reads on the 60s poller crossed the free 100k reads/day once clips accumulated.
async function fbAll(env) {
  const blob = await env.LOGS.get('fb-all');
  if (blob !== null) { try { return JSON.parse(blob) || {}; } catch (e) { return {}; } }
  const out = {};
  for (const key of await idxGet(env, 'fb')) {
    const v = await env.LOGS.get('fb:' + key);
    if (v) { try { out[key] = JSON.parse(v); } catch (e) {} }
  }
  await blobPut(env, 'fb-all', out);
  return out;
}

async function dailyReconcile(env) {
  const day = new Date().toISOString().slice(0, 10);
  if ((await env.LOGS.get('idx:day')) === day) return;
  await env.LOGS.put('idx:day', day); // claim first, so a failed list doesn't retry all day
  try {
    const listAll = async prefix => {
      const names = [];
      let cursor;
      do {
        const r = await env.LOGS.list({ prefix, cursor });
        names.push(...r.keys.map(k => k.name));
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      return names;
    };
    const logs = await listAll('log:');
    // patrick's legacy logs (log:<ts>:<sid>) vs player logs (log:<ts>:<pid>:<sid>, 4 parts)
    const players = await blobGet(env, 'players', {});
    const byIdx = {};
    for (const name of logs) {
      const parts = name.split(':');
      const pid = parts.length >= 4 && players[parts[2]] ? parts[2] : null;
      const idx = pid ? 'log:' + pid : 'log';
      (byIdx[idx] = byIdx[idx] || []).push(name);
    }
    for (const [idx, names] of Object.entries(byIdx)) {
      const li = await idxGet(env, idx);
      const merged = [...new Set([...li, ...names])].sort();
      if (merged.length !== li.length) await blobPut(env, 'idx:' + idx, merged);
    }
    const fbs = (await listAll('fb:')).map(n => n.slice(3));
    if (fbs.length) {
      const all = await fbAll(env);
      let changed = false;
      for (const k of fbs) {
        if (!(k in all)) { const v = await env.LOGS.get('fb:' + k); if (v) { try { all[k] = JSON.parse(v); changed = true; } catch (e) {} } }
      }
      if (changed) await blobPut(env, 'fb-all', all);
    }
  } catch (e) { /* list quota gone — next UTC day */ }
}

// ---- game helpers ----
// challenge stakes are a WAGER, and only the CHALLENGER risks anything (Patrick 8/04):
// winner takes the full wager, 2nd place takes half, answerers can never lose points.
// The issuer: wins -> +wager like anyone; places 2nd -> pays half; anything else -> pays it all.
// Boss battles: coach bounty — winner +wager, 2nd +half, nobody ever pays.
const WAGER_MIN = 10, WAGER_MAX = 200, WAGER_DEFAULT = 50;
// apply challenge points into a day's score via the server-side adj (survives client reposts, can be negative)
async function challengePoints(env, pid, day, delta) {
  const scores = await blobGet(env, 'scores:' + pid, {});
  const e = scores[day] || { total: 0, base: 0, parts: {} };
  const adj = { ...(e.adj || {}) };
  const base = e.base ?? ((e.total || 0) - ((adj.coach || 0) + (adj.whoop || 0) + (adj.challenge || 0)));
  adj.challenge = (adj.challenge || 0) + delta;
  const total = Math.max(0, base + (adj.coach || 0) + (adj.whoop || 0) + adj.challenge);
  scores[day] = { ...e, base, adj, total, parts: { ...(e.parts || {}), challenge: adj.challenge }, at: Date.now() };
  await blobPut(env, 'scores:' + pid, scores);
}
async function feedAdd(env, entry) {
  const feed = await blobGet(env, 'feed', []);
  feed.push({ ...entry, at: Date.now() });
  await blobPut(env, 'feed', feed.slice(-100));
}
const dayOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
// last-7-days window ending at ref (inclusive) — cheap, no ISO-week math
function weekDays(ref) {
  const out = [];
  const d = new Date(ref + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out;
}
// Monday-start calendar week containing ref: {id: monday, days:[7]}
function calWeek(ref) {
  const d = new Date(ref + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  const days = [];
  for (let i = 0; i < 7; i++) { days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return { id: days[0], days };
}
// lazy weekly close, run on scoreboard reads: once the previous Mon-Sun week has fully
// elapsed, record its totals + winner and settle W-L. No cron needed — first read closes it.
async function weeklyClose(env, players, ref) {
  const weeks = await blobGet(env, 'weeks', []);
  const prevSunday = new Date(calWeek(ref).id + 'T00:00:00Z');
  prevSunday.setUTCDate(prevSunday.getUTCDate() - 1);
  const prev = calWeek(prevSunday.toISOString().slice(0, 10));
  if (weeks.some(w => w.id === prev.id)) return weeks;
  const totals = {};
  for (const p of Object.keys(players)) {
    const sc = await blobGet(env, 'scores:' + p, {});
    totals[p] = prev.days.reduce((s, d) => s + (sc[d]?.total || 0), 0);
  }
  const scored = Object.keys(totals).filter(p => totals[p] > 0);
  if (!scored.length) { weeks.push({ id: prev.id, empty: true }); await blobPut(env, 'weeks', weeks.slice(-60)); return weeks; }
  const max = Math.max(...scored.map(p => totals[p]));
  const winners = scored.filter(p => totals[p] === max);
  const wl = await blobGet(env, 'wl', {});
  for (const p of scored) {
    wl[p] = wl[p] || { w: 0, l: 0 };
    winners.includes(p) ? wl[p].w++ : wl[p].l++;
  }
  await blobPut(env, 'wl', wl);
  weeks.push({ id: prev.id, totals, winners });
  await blobPut(env, 'weeks', weeks.slice(-60));
  if (scored.length > 1)
    await feedAdd(env, { pid: winners[0], name: players[winners[0]]?.name || winners[0], type: 'week', week: prev.id, total: max, winners: winners.map(p => players[p]?.name || p) });
  return weeks;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!auth) return json({ error: 'unauthorized' }, 401);

    // resolve player
    let pid = null, admin = false;
    if (auth === env.SYNC_TOKEN) { pid = 'patrick'; admin = true; }
    else {
      const map = await blobGet(env, 'auth', {});
      pid = map[await sha256hex(auth)] || null;
    }
    if (!pid) return json({ error: 'unauthorized' }, 401);
    const players = await blobGet(env, 'players', { patrick: { name: 'Patrick' } });
    const myName = players[pid]?.name || pid;

    const url = new URL(req.url);
    const path = url.pathname;

    // ---- admin: player management ----
    if (path === '/admin/player' && req.method === 'POST') {
      if (!admin) return json({ error: 'forbidden' }, 403);
      const body = await req.json();
      const npid = (body.pid || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!npid || npid === 'patrick') return json({ error: 'bad pid' }, 400);
      if (!body.name) return json({ error: 'name required' }, 400);
      const tok = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
      const map = await blobGet(env, 'auth', {});
      // one token per player: minting again rotates (old token dies)
      for (const [h, p] of Object.entries(map)) if (p === npid) delete map[h];
      map[await sha256hex(tok)] = npid;
      await blobPut(env, 'auth', map);
      players[npid] = { ...(players[npid] || {}), name: body.name, profile: body.profile || players[npid]?.profile || {}, created: players[npid]?.created || Date.now() };
      await blobPut(env, 'players', players);
      return json({ ok: true, pid: npid, token: tok, note: 'token shown once — store it now' });
    }
    if (path === '/admin/players' && req.method === 'GET') {
      if (!admin) return json({ error: 'forbidden' }, 403);
      return json(players);
    }

    if (path === '/me') {
      const prof = players[pid]?.profile || {};
      // Patrick's historical defaults apply to HIM only — a new player with no profile
      // must come back unonboarded and with no borrowed numbers.
      const base = pid === 'patrick' ? { foodTarget: 140, foodFloor: 100, age: 43 } : {};
      return json({ pid, name: myName, admin, onboarded: !!prof.onboarded, profile: { ...base, ...prof } });
    }

    // a player writes their OWN intake profile (onboarding). Coach fields stay admin-only.
    if (path === '/me/profile' && req.method === 'POST') {
      const b = await req.json();
      const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
      const str = (v, n = 200) => typeof v === 'string' ? v.slice(0, n) : '';
      const prof = { ...(players[pid]?.profile || {}) };
      if (b.age != null) prof.age = num(b.age, 13, 100);
      if (b.bodyweightLb != null) prof.bodyweightLb = num(b.bodyweightLb, 60, 600);
      if (b.sex != null) prof.sex = ['m', 'f', 'x'].includes(String(b.sex)) ? String(b.sex) : 'x';
      if (b.daysPerWeek != null) prof.daysPerWeek = num(b.daysPerWeek, 1, 7);
      if (b.foodTarget != null) prof.foodTarget = num(b.foodTarget, 40, 400);
      if (b.foodFloor != null) prof.foodFloor = num(b.foodFloor, 30, 400);
      if (b.equipment != null) prof.equipment = str(b.equipment, 60);
      if (b.limits != null) prof.limits = str(b.limits, 500);
      if (b.goal != null) prof.goal = str(b.goal, 60);
      if (b.experience != null) prof.experience = str(b.experience, 40);
      if (b.name) players[pid] = { ...(players[pid] || {}), name: str(b.name, 40) };
      prof.onboarded = true;
      prof.onboardedAt = prof.onboardedAt || Date.now();
      prof.updatedAt = Date.now();
      players[pid] = { ...(players[pid] || {}), profile: prof };
      await blobPut(env, 'players', players);
      await feedAdd(env, { pid, name: players[pid]?.name || pid, type: 'joined' });
      return json({ ok: true, profile: prof });
    }

    // media listing that works for every player: admin sees the vault lanes (non-p/),
    // players see exactly their own p/<pid>/ prefix. Feeds the Film room.
    if (path === '/media-list' && req.method === 'GET') {
      const media = [];
      let mcur;
      do {
        const r = await env.FOOTAGE.list(mcur ? { cursor: mcur } : {});
        media.push(...r.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
        mcur = r.truncated ? r.cursor : null;
      } while (mcur);
      return json({ media: admin ? media.filter(m => !m.key.startsWith('p/')) : media.filter(m => m.key.startsWith(`p/${pid}/`)) });
    }

    // per-player session queue: coach publishes via admin POST; players read their own.
    // No blob for a player -> client falls back to the static data/sessions.json (Patrick's channel).
    if (path === '/sessions' && req.method === 'GET') {
      const blob = await blobGet(env, 'sessions:' + pid, null);
      return json(blob || { sessions: null });
    }
    if (path === '/admin/sessions' && req.method === 'POST') {
      if (!admin) return json({ error: 'forbidden' }, 403);
      const body = await req.json();
      if (!body.pid || !Array.isArray(body.sessions)) return json({ error: 'need {pid, sessions:[]}' }, 400);
      await blobPut(env, 'sessions:' + body.pid, { sessions: body.sessions, published: Date.now() });
      return json({ ok: true, count: body.sessions.length });
    }

    // ---- logs ----
    if (req.method === 'POST' && path === '/log') {
      const body = await req.json();
      // patrick keeps the legacy 3-part key + idx (the vault sync agent's cursor relies on it)
      const key = pid === 'patrick'
        ? `log:${Date.now()}:${body.sessionId || 'unknown'}`
        : `log:${Date.now()}:${pid}:${body.sessionId || 'unknown'}`;
      await env.LOGS.put(key, JSON.stringify(body));
      await idxAdd(env, pid === 'patrick' ? 'log' : 'log:' + pid, key);
      return json({ ok: true, key });
    }

    if (req.method === 'POST' && path === '/upload') {
      let key = url.searchParams.get('key');
      if (!key || key.includes('..')) return json({ error: 'bad key' }, 400);
      if (pid !== 'patrick' && !key.startsWith(`p/${pid}/`)) key = `p/${pid}/` + key; // hard per-player prefix
      const bytes = await req.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) return json({ error: 'empty upload' }, 400);
      await env.FOOTAGE.put(key, bytes, {
        httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' },
      });
      return json({ ok: true, key, size: bytes.byteLength });
    }

    // self-restore: any player pulls their OWN logs back. A deleted/reinstalled app loses
    // localStorage — history lives here. Own lane only, no media, no cross-player reads.
    if (req.method === 'GET' && path === '/logs') {
      await dailyReconcile(env);
      const out = [];
      for (const name of await idxGet(env, pid === 'patrick' ? 'log' : 'log:' + pid)) {
        const v = await env.LOGS.get(name);
        if (v) out.push({ key: name, log: JSON.parse(v) });
      }
      return json({ logs: out });
    }

    // vault sync agent — PATRICK'S data only, by design (friends' data stays out of the family vault)
    if (req.method === 'GET' && path === '/pull') {
      if (!admin) return json({ error: 'forbidden' }, 403);
      await dailyReconcile(env);
      const after = url.searchParams.get('after') || '';
      const player = url.searchParams.get('player'); // explicit opt-in to read another player's logs
      const out = [];
      for (const name of await idxGet(env, player ? 'log:' + player : 'log')) {
        if (after && name <= after) continue;
        const v = await env.LOGS.get(name);
        if (v) out.push({ key: name, log: JSON.parse(v) });
      }
      const media = [];
      let mcur;
      do {
        const r = await env.FOOTAGE.list(mcur ? { cursor: mcur } : {});
        media.push(...r.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
        mcur = r.truncated ? r.cursor : null;
      } while (mcur);
      // default pull excludes p/<pid>/ media so friends' footage never auto-lands in the vault
      return json({ logs: out, media: player ? media.filter(m => m.key.startsWith(`p/${player}/`)) : media.filter(m => !m.key.startsWith('p/')) });
    }

    if (req.method === 'POST' && path === '/feedback') {
      if (!admin) return json({ error: 'forbidden' }, 403); // coach loop writes feedback
      const body = await req.json();
      if (!body.clipKey) return json({ error: 'clipKey required' }, 400);
      const entry = { notes: body.notes, at: Date.now() };
      await env.LOGS.put('fb:' + body.clipKey, JSON.stringify(entry));
      const all = await fbAll(env);
      all[body.clipKey] = entry;
      await blobPut(env, 'fb-all', all);
      return json({ ok: true });
    }

    if (req.method === 'GET' && path === '/feedback') {
      await dailyReconcile(env);
      const all = await fbAll(env);
      if (admin) return json(all);
      const mine = {};
      for (const [k, v] of Object.entries(all)) if (k.startsWith(`p/${pid}/`)) mine[k] = v;
      return json(mine);
    }

    if (path.startsWith('/media/')) {
      const key = decodeURIComponent(path.slice(7));
      if (!admin && !key.startsWith(`p/${pid}/`)) return json({ error: 'forbidden' }, 403);
      if (req.method === 'GET') {
        const obj = await env.FOOTAGE.get(key);
        if (!obj) return json({ error: 'not found' }, 404);
        return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', ...CORS } });
      }
      if (req.method === 'DELETE') {
        if (!admin) return json({ error: 'forbidden' }, 403);
        await env.FOOTAGE.delete(key);
        return json({ ok: true });
      }
    }

    // ---- game ----
    if (req.method === 'POST' && path === '/score') {
      const body = await req.json();
      if (!dayOk(body.day) || !body.score || typeof body.score.total !== 'number') return json({ error: 'need {day: YYYY-MM-DD, score:{total,...}}' }, 400);
      const scores = await blobGet(env, 'scores:' + pid, {});
      const prior = scores[body.day];
      // coach/whoop adjustments live server-side (see /score/adjust) and survive client reposts
      const adj = prior?.adj || null;
      const adjSum = adj ? (adj.coach || 0) + (adj.whoop || 0) + (adj.challenge || 0) : 0;
      const total = body.score.total + adjSum;
      // max-wins per day: a stale or post-unfinish lower recompute can't clobber a better score
      if (prior && prior.total >= total) return json({ ok: true, kept: prior.total });
      const parts = { ...(body.score.parts || {}), ...(adj ? { coach: adj.coach || 0, whoop: Math.max(body.score.parts?.whoop || 0, adj.whoop || 0) } : {}) };
      scores[body.day] = { ...body.score, total, base: body.score.total, parts, ...(adj ? { adj } : {}), at: Date.now() };
      await blobPut(env, 'scores:' + pid, scores);
      // fuel recomputes fire all day — only headline jumps hit the feed (first post or +100)
      if (!prior || total - prior.total >= 100) await feedAdd(env, { pid, name: myName, type: 'score', day: body.day, total });
      return json({ ok: true });
    }

    // coach loop / WHOOP leg posts bonuses after the fact: {pid, day, coach?, whoop?}
    if (req.method === 'POST' && path === '/score/adjust') {
      if (!admin) return json({ error: 'forbidden' }, 403);
      const body = await req.json();
      const tpid = body.pid || 'patrick';
      if (!players[tpid] || !dayOk(body.day)) return json({ error: 'need {pid, day: YYYY-MM-DD}' }, 400);
      const clampN = (x, hi) => Math.min(hi, Math.max(0, Math.round(x || 0)));
      const scores = await blobGet(env, 'scores:' + tpid, {});
      const e = scores[body.day] || { total: 0, base: 0, parts: {} };
      const base = e.base ?? ((e.total || 0) - ((e.adj?.coach || 0) + (e.adj?.whoop || 0) + (e.adj?.challenge || 0)));
      const adj = { coach: clampN(body.coach ?? e.adj?.coach, 150), whoop: clampN(body.whoop ?? e.adj?.whoop, 50), challenge: e.adj?.challenge || 0 };
      scores[body.day] = { ...e, base, adj, total: Math.max(0, base + adj.coach + adj.whoop + adj.challenge), parts: { ...(e.parts || {}), coach: adj.coach, whoop: adj.whoop }, at: Date.now() };
      await blobPut(env, 'scores:' + tpid, scores);
      if (adj.coach)
        await feedAdd(env, { pid: tpid, name: players[tpid]?.name || tpid, type: 'bonus', day: body.day, coach: adj.coach, total: scores[body.day].total });
      return json({ ok: true, total: scores[body.day].total });
    }

    if (req.method === 'GET' && path === '/scoreboard') {
      const ref = dayOk(url.searchParams.get('day')) ? url.searchParams.get('day') : new Date().toISOString().slice(0, 10);
      const weeks = await weeklyClose(env, players, ref);
      const wl = await blobGet(env, 'wl', {});
      const cwl = await blobGet(env, 'cwl', {});
      const week = weekDays(ref);
      const month = ref.slice(0, 7);
      const board = [];
      for (const p of Object.keys(players)) {
        const scores = await blobGet(env, 'scores:' + p, {});
        const sum = days => days.reduce((s, d) => s + (scores[d]?.total || 0), 0);
        board.push({
          pid: p, name: players[p]?.name || p,
          today: scores[ref]?.total || 0,
          week: sum(week),
          month: Object.entries(scores).filter(([d]) => d.startsWith(month)).reduce((s, [, v]) => s + (v.total || 0), 0),
          wl: wl[p] || { w: 0, l: 0 },
          cwl: cwl[p] || { w: 0, l: 0 },
        });
      }
      board.sort((a, b) => b.week - a.week);
      const lastWeek = [...weeks].reverse().find(w => !w.empty) || null;
      return json({ ref, board, lastWeek });
    }

    if (req.method === 'GET' && path === '/feed') return json(await blobGet(env, 'feed', []));

    if (req.method === 'POST' && path === '/challenge') {
      const body = await req.json();
      if (!body.title) return json({ error: 'title required' }, 400);
      const mode = body.mode === 'boss' ? 'boss' : 'player';
      if (mode === 'boss' && !admin) return json({ error: 'boss battles come from the coach' }, 403);
      const ch = await blobGet(env, 'challenges', []);
      const id = 'c' + Date.now();
      const wager = Math.min(WAGER_MAX, Math.max(WAGER_MIN, Math.round(Number(body.wager)) || WAGER_DEFAULT));
      ch.push({ id, mode, title: body.title, desc: body.desc || '', by: pid, wager, expiresDay: dayOk(body.expiresDay) ? body.expiresDay : null, results: {}, created: Date.now() });
      await blobPut(env, 'challenges', ch.slice(-50));
      await feedAdd(env, { pid, name: myName, type: 'challenge', id, title: body.title, mode });
      return json({ ok: true, id });
    }

    if (req.method === 'POST' && path === '/challenge/result') {
      const body = await req.json();
      const ch = await blobGet(env, 'challenges', []);
      const c = ch.find(x => x.id === body.id);
      if (!c) return json({ error: 'not found' }, 404);
      c.results[pid] = { result: body.result, clipKey: body.clipKey || null, at: Date.now() };
      await blobPut(env, 'challenges', ch);
      await feedAdd(env, { pid, name: myName, type: 'challenge-result', id: c.id, title: c.title, result: body.result });
      return json({ ok: true });
    }

    // settle a challenge: issuer (or coach) calls the winner once results are in.
    // Winner banks a W in the challenge record; everyone else who answered takes the L.
    if (req.method === 'POST' && path === '/challenge/close') {
      const body = await req.json();
      const ch = await blobGet(env, 'challenges', []);
      const c = ch.find(x => x.id === body.id);
      if (!c) return json({ error: 'not found' }, 404);
      if (c.by !== pid && !admin) return json({ error: 'only the issuer or the coach settles it' }, 403);
      if (c.closed) return json({ error: 'already settled' }, 400);
      const winner = body.winner && (players[body.winner] ? body.winner : null);
      const second = (body.second && players[body.second] && body.second !== winner) ? body.second : null;
      c.closed = { winner: winner || null, second, by: pid, at: Date.now() };
      await blobPut(env, 'challenges', ch);
      const wager = c.wager || WAGER_DEFAULT;
      const half = Math.round(wager / 2);
      let issuerDelta = 0;
      if (winner) {
        // participants for the record: winner, 2nd, everyone who answered, + the issuer on player challenges
        const iss = c.mode === 'player' && players[c.by] ? c.by : null;
        const parts = new Set([winner, ...(second ? [second] : []), ...Object.keys(c.results || {}).filter(p => players[p]), ...(iss ? [iss] : [])]);
        const cwl = await blobGet(env, 'cwl', {});
        for (const p of parts) {
          cwl[p] = cwl[p] || { w: 0, l: 0 };
          p === winner ? cwl[p].w++ : cwl[p].l++;
        }
        await blobPut(env, 'cwl', cwl);
        const day = new Date().toISOString().slice(0, 10);
        // payouts: winner full, 2nd half — but the issuer never collects the 2nd-place prize,
        // he pays: 2nd = -half, out of the money = -wager. Answerers can only go up.
        await challengePoints(env, winner, day, wager);
        if (second && second !== iss) await challengePoints(env, second, day, half);
        if (iss && iss !== winner) {
          issuerDelta = iss === second ? -half : -wager;
          await challengePoints(env, iss, day, issuerDelta);
        }
      }
      await feedAdd(env, {
        pid, name: myName, type: 'challenge-close', id: c.id, title: c.title, wager,
        winner: winner ? (players[winner]?.name || winner) : null,
        second: second ? (players[second]?.name || second) : null, secondPts: second && second !== c.by ? half : 0,
        issuer: players[c.by]?.name || c.by, issuerDelta,
      });
      return json({ ok: true, wager, winner, second, issuerDelta });
    }

    if (req.method === 'GET' && path === '/challenges') return json(await blobGet(env, 'challenges', []));

    return json({ error: 'not found' }, 404);
  },
};
