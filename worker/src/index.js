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

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const auth = req.headers.get('Authorization') || '';
    if (auth !== 'Bearer ' + env.SYNC_TOKEN) return json({ error: 'unauthorized' }, 401);

    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'POST' && path === '/log') {
      const body = await req.json();
      const key = `log:${body.sessionId || 'unknown'}:${Date.now()}`;
      await env.LOGS.put(key, JSON.stringify(body));
      return json({ ok: true, key });
    }

    if (req.method === 'POST' && path === '/upload') {
      const key = url.searchParams.get('key');
      if (!key || key.includes('..')) return json({ error: 'bad key' }, 400);
      await env.FOOTAGE.put(key, req.body, {
        httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' },
      });
      return json({ ok: true, key });
    }

    if (req.method === 'GET' && path === '/pull') {
      const after = url.searchParams.get('after') || '';
      const list = await env.LOGS.list({ prefix: 'log:' });
      const out = [];
      for (const k of list.keys) {
        if (after && k.name <= after) continue;
        out.push({ key: k.name, log: JSON.parse(await env.LOGS.get(k.name)) });
      }
      const media = (await env.FOOTAGE.list()).objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
      return json({ logs: out, media });
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
