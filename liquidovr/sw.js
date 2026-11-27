// LiquidoVR — service worker.
// Проксирует запросы <video> вида ./stream/<fileId>?size=..&mime=.. в Google Drive API,
// добавляя заголовок Authorization и пробрасывая Range-запросы (перемотка).
// Токен берётся у ПК-сервера (./api/token) и обновляется автоматически.
// Видео НЕ кешируется и не сохраняется: байты идут потоком из Google прямо в декодер.

const AUTH_CACHE = 'liquido-auth-v1';
const SCOPE = self.registration.scope;
const AUTH_KEY = new URL('__liquido_auth__', SCOPE).href;
let auth = null; // { token, exp }
// Плеер с самого ПК-сервера → тот же адрес; с сайта (GitHub Pages) → ПК через localhost:8080 на шлеме
const PC_BASE = /^(localhost|127\.0\.0\.1)$/.test(self.location.hostname) ? SCOPE : 'http://localhost:8080/';
let refreshing = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'auth') return;
  auth = d.auth || null;
  e.waitUntil(saveAuth(auth).finally(() => e.ports?.[0]?.postMessage({ ok: true })));
});

async function saveAuth(a) {
  try {
    const c = await caches.open(AUTH_CACHE);
    if (a) await c.put(AUTH_KEY, new Response(JSON.stringify(a)));
    else await c.delete(AUTH_KEY);
  } catch (_) { /* ignore */ }
}

async function loadAuth() {
  if (auth) return auth;
  try {
    const c = await caches.open(AUTH_CACHE);
    const r = await c.match(AUTH_KEY);
    if (r) auth = await r.json();
  } catch (_) { /* ignore */ }
  return auth;
}

// Свежий токен у ПК-сервера
function refreshAuth(force) {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch(new URL('api/token' + (force ? '?force=1' : ''), PC_BASE), {
          headers: { 'X-Liquido': '1' }, cache: 'no-store',
        });
        if (!r.ok) {
          notify({ type: r.status === 401 ? 'need-login' : 'server-error', status: r.status });
          return null;
        }
        const j = await r.json();
        auth = { token: j.access_token, exp: j.expires_at * 1000 };
        await saveAuth(auth);
        return auth;
      } catch (_) {
        notify({ type: 'server-down' });
        return null;
      } finally {
        setTimeout(() => { refreshing = null; }, 0);
      }
    })();
  }
  return refreshing;
}

async function validAuth() {
  const a = await loadAuth();
  if (a && a.token && Date.now() < (a.exp || 0) - 60000) return a;
  return refreshAuth(false);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const prefix = new URL(SCOPE).pathname + 'stream/';
  if (!url.pathname.startsWith(prefix)) return;
  e.respondWith(stream(e.request, url, prefix));
});

async function notify(msg) {
  const list = await self.clients.matchAll({ type: 'window' });
  for (const c of list) c.postMessage(msg);
}

function parseTotal(contentRange) {
  const m = /\/(\d+)\s*$/.exec(contentRange || '');
  return m ? Number(m[1]) : 0;
}

async function stream(req, url, prefix) {
  const id = decodeURIComponent(url.pathname.slice(prefix.length));
  const size = Number(url.searchParams.get('size')) || 0;
  const mime = url.searchParams.get('mime') || 'video/mp4';
  const upstream = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
    '?alt=media&supportsAllDrives=true';

  // Range от медиа-элемента
  const range = req.headers.get('Range');
  let start = 0;
  let end = null;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1] === '' && m[2] !== '' && size) { // суффиксный диапазон
        start = Math.max(0, size - Number(m[2]));
        end = size - 1;
      } else {
        start = Number(m[1]) || 0;
        end = m[2] !== '' ? Number(m[2]) : null;
      }
    }
  }
  if (size && start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }

  let a = await validAuth();
  if (!a) return new Response('Not signed in', { status: 401 });

  const doFetch = (tokenValue) => {
    const headers = { Authorization: 'Bearer ' + tokenValue };
    if (range) headers.Range = 'bytes=' + start + '-' + (end != null ? end : '');
    return fetch(upstream, { headers, cache: 'no-store', signal: req.signal });
  };

  let resp;
  try {
    resp = await doFetch(a.token);
    if (resp.status === 401) { // токен протух — берём новый у ПК и повторяем
      a = await refreshAuth(true);
      if (!a) return new Response('Not signed in', { status: 401 });
      resp = await doFetch(a.token);
    }
  } catch (err) {
    return new Response('Network error: ' + err, { status: 502 });
  }

  if (!resp.ok) {
    let text = '';
    try { text = await resp.text(); } catch (_) {}
    notify({ type: resp.status === 403 ? 'forbidden' : 'stream-error', status: resp.status, detail: text.slice(0, 500) });
    return new Response(text, { status: resp.status });
  }

  const h = new Headers({
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });

  if (resp.status === 206) {
    const total = size || parseTotal(resp.headers.get('Content-Range'));
    if (total) {
      const last = end != null ? Math.min(end, total - 1) : total - 1;
      h.set('Content-Range', 'bytes ' + start + '-' + last + '/' + total);
      h.set('Content-Length', String(last - start + 1));
    } else {
      const cr = resp.headers.get('Content-Range');
      if (cr) h.set('Content-Range', cr);
    }
    return new Response(resp.body, { status: 206, headers: h });
  }

  const len = resp.headers.get('Content-Length') || (size ? String(size) : null);
  if (len) h.set('Content-Length', len);
  return new Response(resp.body, { status: 200, headers: h });
}
