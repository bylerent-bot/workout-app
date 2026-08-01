// train-sync — private pipe between the Train PWA and the vault.
// Auth: Bearer token (secret SYNC_TOKEN). All routes 401 without it.
// POST /log            JSON session log -> KV (key log:<sessionId>:<ts>)
// POST /upload?key=..  video/photo bytes -> R2 (key e.g. s3/a-set3.mov)
// GET  /pull           list + return all logs since ?after= (vault sync agent)
// GET  /media/:key     fetch one object (vault sync agent)
// DELETE /media/:key   remove after the vault has filed it

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

// Free-tier KV allows only 1,000 list() calls/day — the 60s poller burned through
// that (found 7/30, worker 500'd all day). So the hot read paths use INDEX KEYS
// (plain gets, 100k/day) that the write paths append to. list() runs at most once
// per UTC day, as a self-heal that picks up anything written outside the index.
async function idxGet(env, name) {
  try { return JSON.parse(await env.LOGS.get('idx:' + name)) || []; } catch (e) { return []; }
}
async function idxAdd(env, name, key) {
  const a = await idxGet(env, name);
  if (!a.includes(key)) { a.push(key); await env.LOGS.put('idx:' + name, JSON.stringify(a)); }
}
// All feedback lives in ONE blob key (fb-all: {clipKey: {notes,at}}). Per-clip fb:*
// keys nearly sank the free tier a second way: the 60s poller re-read every
// accumulated key every poll (1,440 x total keys/day), crossing 100k reads/day
// once enough clips existed. One blob = 1 read per poll, and writes stay rare.
async function fbAll(env) {
  const blob = await env.LOGS.get('fb-all');
  if (blob !== null) { try { return JSON.parse(blob) || {}; } catch (e) { return {}; } }
  // one-time migration from the legacy per-clip keys
  const out = {};
  for (const key of await idxGet(env, 'fb')) {
    const v = await env.LOGS.get('fb:' + key);
    if (v) { try { out[key] = JSON.parse(v); } catch (e) {} }
  }
  await env.LOGS.put('fb-all', JSON.stringify(out));
  return out;
}
async function dailyReconcile(env) {
  const day = new Date().toISOString().slice(0, 10);
  if ((await env.LOGS.get('idx:day')) === day) return;
  await env.LOGS.put('idx:day', day);            // claim first, so a failed list doesn't retry all day
  try {
    const listAll = async prefix => { // KV list caps at 1000 keys/page — paginate
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
    const fbs  = (await listAll('fb:')).map(n => n.slice(3));
    const li = await idxGet(env, 'log');
    const lm = [...new Set([...li, ...logs])].sort();
    if (lm.length !== li.length) await env.LOGS.put('idx:log', JSON.stringify(lm));
    if (fbs.length) {                              // sweep stragglers into the blob
      const all = await fbAll(env);
      let changed = false;
      for (const k of fbs) {
        if (!(k in all)) { const v = await env.LOGS.get('fb:' + k); if (v) { try { all[k] = JSON.parse(v); changed = true; } catch (e) {} } }
      }
      if (changed) await env.LOGS.put('fb-all', JSON.stringify(all));
    }
  } catch (e) { /* list quota gone — try again next UTC day */ }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const auth = req.headers.get('Authorization') || '';
    if (auth !== 'Bearer ' + env.SYNC_TOKEN) return json({ error: 'unauthorized' }, 401);

    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'POST' && path === '/log') {
      const body = await req.json();
      // timestamp-first so key order == time order (the sync cursor relies on it)
      const key = `log:${Date.now()}:${body.sessionId || 'unknown'}`;
      await env.LOGS.put(key, JSON.stringify(body));
      await idxAdd(env, 'log', key);
      return json({ ok: true, key });
    }

    if (req.method === 'POST' && path === '/upload') {
      const key = url.searchParams.get('key');
      if (!key || key.includes('..')) return json({ error: 'bad key' }, 400);
      const bytes = await req.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) return json({ error: 'empty upload' }, 400);
      await env.FOOTAGE.put(key, bytes, {
        httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' },
      });
      return json({ ok: true, key, size: bytes.byteLength });
    }

    if (req.method === 'GET' && path === '/pull') {
      await dailyReconcile(env);
      const after = url.searchParams.get('after') || '';
      const out = [];
      for (const name of await idxGet(env, 'log')) {
        if (after && name <= after) continue;
        const v = await env.LOGS.get(name);
        if (v) out.push({ key: name, log: JSON.parse(v) });
      }
      const media = [];
      let mcur;
      do { // R2 list pages at 1000 objects
        const r = await env.FOOTAGE.list(mcur ? { cursor: mcur } : {});
        media.push(...r.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
        mcur = r.truncated ? r.cursor : null;
      } while (mcur);
      return json({ logs: out, media });
    }

    if (req.method === 'POST' && path === '/feedback') {
      const body = await req.json();
      if (!body.clipKey) return json({ error: 'clipKey required' }, 400);
      const entry = { notes: body.notes, at: Date.now() };
      // per-clip key first = the durable record; the blob is just the hot-read cache.
      // If two writers race on the blob, the daily reconcile sweeps fb:* back in — nothing lost.
      await env.LOGS.put('fb:' + body.clipKey, JSON.stringify(entry));
      const all = await fbAll(env);
      all[body.clipKey] = entry;
      await env.LOGS.put('fb-all', JSON.stringify(all));
      return json({ ok: true });
    }

    if (req.method === 'GET' && path === '/feedback') {
      await dailyReconcile(env);
      return json(await fbAll(env));
    }

    if (path.startsWith('/media/')) {
      const key = decodeURIComponent(path.slice(7));
      if (req.method === 'GET') {
        const obj = await env.FOOTAGE.get(key);
        if (!obj) return json({ error: 'not found' }, 404);
        return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', ...CORS } });
      }
      if (req.method === 'DELETE') {
        await env.FOOTAGE.delete(key);
        return json({ ok: true });
      }
    }

    return json({ error: 'not found' }, 404);
  },
};
