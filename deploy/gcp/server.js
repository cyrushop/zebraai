// Zebra Sales Hub on Cloud Run: serves the hub files and a small shared database for them.
// Sign-in is done by Identity-Aware Proxy in front of the service; this server never sees a password.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = path.join(__dirname, 'public');
const COLLS = new Set(['forecast', 'weekly', 'targets']);   // the collections the hub writes
const MAX_BODY = 1 << 20;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// Firestore on Cloud Run; STORE=memory keeps everything in this process (local testing only)
const store = process.env.STORE === 'memory' ? memoryStore() : firestoreStore();
function firestoreStore() {
  const { Firestore } = require('@google-cloud/firestore');
  const db = new Firestore({ databaseId: process.env.FIRESTORE_DB || '(default)' });
  const coll = c => db.collection('hub_' + c);
  return {
    list: async c => (await coll(c).get()).docs.map(d => ({ id: d.id, data: d.data() })),
    set: (c, id, data) => coll(c).doc(id).set(data),
  };
}
function memoryStore() {
  const m = new Map();
  return {
    list: async c => [...(m.get(c) || new Map())].map(([id, data]) => ({ id, data })),
    set: async (c, id, data) => { if (!m.has(c)) m.set(c, new Map()); m.get(c).set(id, data); },
  };
}

// IAP passes the signed-in account as "accounts.google.com:name@example.com"
const userOf = req => String(req.headers['x-goog-authenticated-user-email'] || '').replace(/^accounts\.google\.com:/, '');

function send(res, code, body, type) {
  res.writeHead(code, { 'content-type': type || 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', b => { n += b.length; if (n > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else parts.push(b); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

async function api(req, res, parts) {
  if (parts[0] === 'me') return send(res, 200, { email: userOf(req) || null });
  if (parts[0] !== 'db' || !COLLS.has(parts[1])) return send(res, 404, { error: 'not found' });
  const c = parts[1], id = parts[2];
  if (req.method === 'GET' && !id) return send(res, 200, { docs: await store.list(c) });
  if (req.method === 'PUT' && id && /^[\w.@ -]{1,120}$/.test(id)) {
    let data;
    try { data = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: 'bad body' }); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { error: 'bad body' });
    await store.set(c, id, Object.assign({}, data, { _by: userOf(req) || null, _at: Date.now() }));
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

function file(req, res, url) {
  let rel = decodeURIComponent(url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = req.url || '/', parts = url.split('?')[0].split('/').filter(Boolean);
  if (parts[0] === 'api') return api(req, res, parts.slice(1)).catch(e => { console.error(e); send(res, 500, { error: 'server error' }); });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
  return file(req, res, url);
}).listen(PORT, () => console.log('Zebra Sales Hub on port ' + PORT + (process.env.STORE === 'memory' ? ' (memory store)' : '')));
