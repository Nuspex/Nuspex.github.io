// LiquidoVR — WebXR-плеер видео с Google Диска без скачивания.
import * as THREE from 'three';

// ───────────────────────── утилиты ─────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
function fmtBytes(n) {
  n = Number(n);
  if (!n) return '';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Где программа на ПК: если плеер открыт с самого ПК-сервера — тот же адрес,
// если с сайта (GitHub Pages, приложение LiquidoVR) — через localhost:8080 на шлеме
// (посредник приложения по Wi-Fi или adb reverse по кабелю).
const PC_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '' : 'http://localhost:8080/';
const IS_APP = matchMedia('(display-mode: standalone)').matches || 'getDigitalGoodsService' in window ||
  document.referrer.startsWith('android-app://');
const now = () => performance.now();

const ICONS = {
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  film: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5Z"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  unfull: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="m17 9 5 6M22 9l-5 6"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
};

// ───────────────────────── константы и настройки ─────────────────────────
const DRIVE = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const FILE_FIELDS = 'id,name,mimeType,size,thumbnailLink,modifiedTime,videoMediaMetadata(width,height,durationMillis),shortcutDetails(targetId,targetMimeType)';

const PROJ = ['flat', '180', '360', 'fisheye'];
const PROJ_NAME = { flat: 'Экран', 180: '180°', 360: '360°', fisheye: 'Fisheye' };
const STEREO = ['mono', 'sbs', 'tb'];
const STEREO_NAME = { mono: '2D', sbs: 'SBS 3D', tb: 'TB 3D' };
const STEREO_LONG = { mono: '2D', sbs: 'Side-by-Side', tb: 'Top-Bottom' };
const QUALITY = {
  std: { name: 'Стандарт', scale: 1.0, seg: 64 },
  high: { name: 'Высокое', scale: 1.25, seg: 96 },
  '8k': { name: '8K', scale: 1.5, seg: 128 },
};
const QUALITY_KEYS = ['std', 'high', '8k'];
const DEFAULT_PREFS = {
  projection: '180', stereo: 'sbs', swap: false, zoom: 0, quality: '8k', autoVR: true, volume: 1, layers: true,
  speed: 1, autoNext: true, fisheyeFov: 180, picture: { b: 0, c: 0, s: 0, t: 0, sh: 0 }, aa: true,
  seekStep: 10, endMode: 'next',
};
let prefs = { ...DEFAULT_PREFS, ...LS.get('liquido.prefs', {}) };
prefs.picture = { b: 0, c: 0, s: 0, t: 0, sh: 0, ...(prefs.picture || {}) };
if (!LS.get('liquido.prefs', {}).endMode && prefs.autoNext === false) prefs.endMode = 'stop';   // старая настройка
const SEEK_STEPS = [5, 10, 15, 30, 60];
const END_MODES = [['next', 'Следующее'], ['repeat', 'Повторить'], ['shuffle', 'Случайное'], ['stop', 'Стоп']];
const savePrefs = () => LS.set('liquido.prefs', prefs);

// ───────────────────────── баннер / статус ─────────────────────────
function banner(text, btnText, onClick) {
  const b = $('#banner');
  if (!text) { b.hidden = true; return; }
  $('#bannerText').textContent = text;
  const btn = $('#bannerBtn');
  btn.hidden = !btnText;
  btn.textContent = btnText || '';
  btn.onclick = onClick || null;
  b.hidden = false;
}
function listStatus(text, isError) {
  const el = $('#listStatus');
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}
function stageMsg(text) { $('#stageMsg').textContent = text || ''; }

// ───────────────────────── авторизация через ПК-сервер ─────────────────────────
// Вход в Google делается ОДИН раз в браузере компьютера (http://127.0.0.1:8080/setup).
// Шлем получает у ПК-сервера только короткоживущий access token — входить на Quest не нужно.
let token = null;
let tokenExp = 0;
let account = null;
const hasToken = () => !!token && Date.now() < tokenExp - 60000;
class NeedLogin extends Error {}

async function serverJSON(path) {
  let r;
  try {
    r = await fetch(PC_BASE + path, { cache: 'no-store', headers: { 'X-Liquido': '1' } });
  } catch {
    throw new Error('Нет связи с программой на ПК. Запустите «Запустить.cmd» на компьютере.');
  }
  if (r.status === 401) throw new NeedLogin('Нужно войти в Google на компьютере.');
  if (!r.ok) {
    let m = 'HTTP ' + r.status;
    try { m = (await r.json()).error || m; } catch { /* ignore */ }
    throw new Error('Программа на ПК: ' + m);
  }
  return r.json();
}

async function getToken(force = false) {
  if (!force && hasToken()) return token;
  try {
    const j = await serverJSON('api/token' + (force ? '?force=1' : ''));
    token = j.access_token;
    tokenExp = j.expires_at * 1000;
  } catch (e) {
    if (e instanceof NeedLogin) { account = null; updateAuthUI(); showLoginHelp(true); }
    throw e;
  }
  await sendAuthToSW();
  return token;
}

function showLoginHelp(configured) {
  banner((configured ? 'Google Диск не подключён.' : 'Программа на ПК ещё не настроена.') +
    ' На компьютере откройте в браузере http://127.0.0.1:8080/setup и войдите в Google, затем нажмите «Проверить».',
  'Проверить', async () => { if (await checkAccount()) openSource('root'); });
}

// Посредник приложения LiquidoVR (Quest, Wi-Fi): /__liquido/status. null — его нет (кабель или ПК напрямую).
async function bridgeStatus() {
  if (!PC_BASE) return null;
  let r;
  try { r = await fetch(PC_BASE + '__liquido/status', { cache: 'no-store' }); } catch { throw new Error('Нет связи с программой на ПК.'); }
  if (r.status === 404 || r.status === 403) return null; // отвечает сам ПК (adb reverse)
  return r.ok ? r.json() : null;
}

function showPairing(st, error) {
  account = null;
  updateAuthUI();
  const where = st?.host ? 'Компьютер найден: ' + st.host + '. ' : 'Компьютер с LiquidoVR не найден в сети. ';
  banner(where + 'Введите PIN из окна «Запустить.cmd» на ПК.', 'Ввести PIN', async () => {
    const pin = prompt('PIN из окна «Запустить.cmd» на ПК:');
    if (pin) pairWith(pin.trim(), '');
  });
  if (ui) {
    ui.pair = { ...(ui.pair || {}), st, error: error || '', busy: false };
    if (!st?.host && !ui.pair.mode) ui.pair.mode = 'pin';
    ui.openSheet('pair', true);
  }
}

async function pairWith(pin, host) {
  if (ui?.pair) { ui.pair.busy = true; ui.pair.error = ''; ui.redraw(); }
  let res;
  try {
    const q = 'pin=' + encodeURIComponent(pin) + (host ? '&host=' + encodeURIComponent(host) : '');
    res = await fetch(PC_BASE + '__liquido/pair?' + q, { cache: 'no-store' }).then((r) => r.json());
  } catch { res = { ok: false, error: 'Нет связи с приложением' }; }
  if (res.ok) {
    if (ui?.pair) ui.pair = { mode: 'pin', pin: '', ip: '' };
    if (await checkAccount()) { openSource('root'); ui?.openLibrary(true); ui?.toastMsg('Шлем привязан к ПК'); }
  } else {
    let st = null;
    try { st = await bridgeStatus(); } catch { /* ignore */ }
    showPairing(st, res.error || 'Неверный PIN');
  }
}

async function checkAccount() {
  try {
    const st = await bridgeStatus();
    if (st && !st.paired) { showPairing(st); return false; }
    if (ui?.sheet === 'pair') ui.openSheet('pair', false);
    const s = await serverJSON('api/status');
    account = s.signedIn ? s : null;
    if (account) { banner(null); await getToken(); } else showLoginHelp(s.configured);
  } catch (e) {
    account = null;
    banner(e.message, 'Повторить', async () => { if (await checkAccount()) openSource('root'); });
  }
  updateAuthUI();
  return !!account;
}

function updateAuthUI() {
  const who = $('#who');
  who.textContent = account ? '● ' + (account.name || account.email || 'Google Диск') : 'Диск не подключён';
  who.classList.toggle('ok', !!account);
  $('#btnLogin').hidden = !!account;
}

setInterval(() => {
  if (account && token && Date.now() > tokenExp - 10 * 60000) getToken(true).catch(() => {});
}, 60000);

// ───────────────────────── Drive API ─────────────────────────
async function api(path, params = {}, retry = true) {
  const url = new URL(DRIVE + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const t = await getToken();
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
  if (r.status === 401 && retry) { await getToken(true); return api(path, params, false); }
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
    throw new Error('Google Drive: ' + msg);
  }
  return r.json();
}

// ───────────────────────── service worker ─────────────────────────
let swReg = null;
async function ensureSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    throw new Error('Потоковое воспроизведение работает только по адресу http://localhost:8080 (через adb reverse).');
  }
  if (!swReg) swReg = await navigator.serviceWorker.register('./sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((r) => {
      navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
      setTimeout(r, 3000);
    });
  }
  if (!navigator.serviceWorker.controller) {
    throw new Error('Service Worker ещё не активен. Обновите страницу обычным способом.');
  }
}

async function sendAuthToSW() {
  if (!('serviceWorker' in navigator)) return;
  const target = navigator.serviceWorker.controller || swReg?.active;
  if (!target) return;
  const auth = hasToken() ? { token, exp: tokenExp } : null;
  await new Promise((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => res();
    target.postMessage({ type: 'auth', auth }, [ch.port2]);
    setTimeout(res, 1500);
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'need-login') {
      account = null; updateAuthUI(); showLoginHelp(true);
      ui?.toastMsg('Диск отключён — войдите на ПК (/setup)', true);
    } else if (d.type === 'server-down') {
      banner('Нет связи с программой на ПК — запустите «Запустить.cmd» и проверьте кабель.');
      ui?.toastMsg('Нет связи с ПК', true);
    } else if (d.type === 'forbidden') {
      const quota = /quota|limit/i.test(d.detail || '');
      const t = quota ? 'Google временно ограничил скачивание этого файла (квота). Попробуйте позже.' : 'Нет доступа к файлу (403).';
      banner(t); ui?.toastMsg(t, true);
    } else if (d.type === 'stream-error' || d.type === 'server-error') {
      banner('Ошибка потока: HTTP ' + d.status);
    }
  });
}

// ───────────────────────── формат видео ─────────────────────────
// Формат по меткам в имени файла (конвенции PLAY'A / DeoVR / HereSphere / SKYBOX).
// Метка — отдельное «слово» между _ - . пробелами и скобками: «1360x768», год «1800» или «scene180x»
// не превращают обычное видео в 180°/360°.
const FE_FOV = { fisheye180: 180, fisheye190: 190, fisheye200: 200, fisheye220: 220, rf52: 190, mkx200: 200, mkx220: 220, vrca220: 220 };
function detectFormat(name) {
  const base = (name || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '');
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
  const has = (...xs) => xs.some((x) => tokens.includes(x));
  let proj = null, stereo = null, swap = null, fov = null;
  for (const t of tokens) {
    // fisheye и объективы двойных VR-камер
    if (t in FE_FOV) { proj = 'fisheye'; fov = FE_FOV[t]; continue; }
    if (t === 'fisheye' || t === 'fe') { proj = 'fisheye'; continue; }
    // 180 / 360 вместе с режимом: 180, vr180, 180x180, mono180, 180sbs, lr180, 360tb…
    const m = /^(?:vr|mono|sbs|lr|tb|ou)?(180|360)(?:x180|vr|3d|mono|sbs|lr|tb|ou)?$/.exec(t);
    if (m) {
      if (proj !== 'fisheye') proj = m[1];
      if (/mono/.test(t) || t === '180x180') stereo = 'mono';   // как в PLAY'A: 180x180 — моно 180°
      else if (/sbs|lr/.test(t)) stereo = 'sbs';
      else if (/tb|ou/.test(t)) stereo = 'tb';
    }
  }
  // плоское видео: 2D, flat и метки PLAY'A 2dp / 3dph / 3dpv
  if (!proj && has('2d', 'flat', '2dp', '3dph', '3dpv')) proj = 'flat';
  // стерео
  if (has('sbs', 'lr', '3dh', '3dph', 'fullsbs', 'halfsbs', 'hsbs', 'sidebyside')) stereo = 'sbs';
  else if (has('tb', 'ou', '3dv', '3dpv', 'overunder', 'topbottom', 'htb', 'hou')) stereo = 'tb';
  else if (has('rl')) { stereo = 'sbs'; swap = true; }          // правый глаз слева
  else if (has('bt')) { stereo = 'tb'; swap = true; }           // правый глаз сверху
  else if (!stereo && has('mono', '2d', '2dp')) stereo = 'mono';
  // как в PLAY'A: 3dh / 3dv без 180 означают панораму 360°
  if (!proj && has('3dh', '3dv')) proj = '360';
  // fisheye_lr / fisheye_tb уже разобраны выше; плоское без стерео-метки — обычное 2D
  if (proj === 'flat' && !stereo) stereo = 'mono';
  const marked = !!proj;
  return {
    projection: proj || prefs.projection,
    stereo: stereo || (proj === 'flat' ? 'mono' : prefs.stereo),
    swap: swap ?? prefs.swap,
    fisheyeFov: fov,
    marked,
    stereoMarked: !!stereo,
  };
}

// Формат из метаданных файла (ffprobe на ПК) — когда в имени нет меток. Результат кешируется.
async function probeFormat(f) {
  const key = 'liquido.meta.' + f.id;
  let meta = LS.get(key, null);
  if (!meta) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(PC_BASE + 'api/meta?id=' + encodeURIComponent(f.id), { headers: { 'X-Liquido': '1' }, signal: ctl.signal });
      clearTimeout(timer);
      meta = r.ok ? await r.json() : null;
      if (meta) LS.set(key, meta);
    } catch { meta = null; }
  }
  return meta || {};
}
// Плоские видео (16:9, 4:3, 32:9) по пропорциям кадра — чтобы обычные фильмы не попадали в купол 180°
function aspectGuess(f) {
  const vm = f.videoMediaMetadata;
  if (!vm?.width || !vm?.height) return null;
  const r = vm.width / vm.height;
  if (r > 3.3 && r < 3.8) return { projection: 'flat', stereo: 'sbs' };   // Full-SBS 3D-фильм 32:9
  if ((r > 1.25 && r < 1.45) || (r > 1.6 && r < 1.9) || (r > 2.25 && r < 2.5)) return { projection: 'flat', stereo: 'mono' };
  if (r > 0.95 && r < 1.05) return { stereo: 'tb' };                       // 1:1 — VR Top-Bottom
  return null;                                                              // 2:1 — VR180 SBS / 360 → по умолчанию
}

function fileFormat(f) {
  const saved = LS.get('liquido.fmt.' + f.id, null);
  const det = detectFormat(f.name);
  const guess = !saved && !det.marked ? aspectGuess(f) : null;
  // метка стерео в имени (_SBS, _TB…) важнее догадки по пропорциям кадра
  const keep = det.stereoMarked ? { stereo: det.stereo, swap: det.swap } : {};
  return { ...det, ...(guess || {}), ...keep, guessed: !!guess, view: '3d', zoom: prefs.zoom, height: 0, ...(saved || {}) };
}
function formatLabel(fmt) {
  if (fmt.projection === 'flat') return fmt.stereo === 'mono' ? 'Экран' : 'Экран ' + (fmt.stereo === 'tb' ? 'TB 3D' : '3D');
  return PROJ_NAME[fmt.projection] + (fmt.stereo === 'mono' ? '' : fmt.stereo === 'tb' ? ' TB 3D' : ' 3D');
}
// «180° · SBS · 8K» — для героя, плеера и VR-билета
function formatLine(fmt, vm) {
  const parts = [PROJ_NAME[fmt.projection], fmt.stereo === 'mono' ? '2D' : fmt.stereo.toUpperCase() + (fmt.view === 'mono' ? ' · MONO' : '')];
  const w = vm?.width || 0;
  if (w) parts.push(w >= 7000 ? '8K' : w >= 5000 ? '6K' : w >= 3800 ? '4K' : w >= 2500 ? '2.7K' : w >= 1900 ? 'HD' : w + 'p');
  return parts.join(' · ');
}
function guessMime(f) {
  if ((f.mimeType || '').startsWith('video/')) return f.mimeType;
  const n = (f.name || '').toLowerCase();
  if (n.endsWith('.mkv')) return 'video/x-matroska';
  if (n.endsWith('.webm')) return 'video/webm';
  if (n.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

// ───────────────────────── обзор Диска ─────────────────────────
const nav = { source: 'root', stack: [], query: '', pageToken: null, loading: false, items: [] };
const VIDEO_Q = `(mimeType='${FOLDER}' or mimeType contains 'video/' or mimeType='${SHORTCUT}')`;
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function setActiveTab(src) { $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.src === src)); }

function openSource(src) {
  setActiveTab(src);
  nav.source = src;
  nav.stack = src === 'root' ? [{ id: 'root', name: 'Мой диск' }] : [];
  loadList(true);
}

function currentQuery() {
  const all = $('#showAll').checked;
  const filt = all ? '' : ' and ' + VIDEO_Q;
  if (nav.stack.length) {
    const id = nav.stack[nav.stack.length - 1].id;
    return { q: `'${esc(id)}' in parents and trashed=false` + filt, orderBy: 'folder,name' };
  }
  if (nav.source === 'shared') return { q: 'sharedWithMe and trashed=false' + filt };
  if (nav.source === 'recent') return { q: "trashed=false and mimeType contains 'video/'", orderBy: 'viewedByMeTime desc' };
  if (nav.source === 'search') return { q: `name contains '${esc(nav.query)}' and trashed=false` + filt, orderBy: 'folder,name' };
  return { q: "'root' in parents and trashed=false" + filt, orderBy: 'folder,name' };
}

async function loadList(reset) {
  if (nav.loading) return;
  if (!account) {
    $('#list').replaceChildren();
    renderCrumbs();
    listStatus('Google Диск не подключён.\n1. На компьютере запустите «Запустить.cmd».\n2. В браузере ПК откройте http://127.0.0.1:8080/setup и войдите в Google.\n3. Здесь нажмите «Проверить подключение».');
    $('#btnMore').hidden = true;
    return;
  }
  if (reset) { nav.pageToken = null; nav.items = []; $('#list').replaceChildren(); }
  renderCrumbs();
  nav.loading = true;
  listStatus('Загрузка…');
  try {
    const { q, orderBy } = currentQuery();
    const r = await api('/files', {
      q, orderBy, pageSize: 100, pageToken: nav.pageToken,
      fields: 'nextPageToken,files(' + FILE_FIELDS + ')',
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    const files = r.files || [];
    if (nav.source === 'shared' && !nav.stack.length) {
      files.sort((a, b) => (b.mimeType === FOLDER) - (a.mimeType === FOLDER) || a.name.localeCompare(b.name));
    }
    nav.items.push(...files);
    nav.pageToken = r.nextPageToken || null;
    renderItems(files);
    updateCount();
    listStatus(nav.items.length ? '' : 'Здесь нет видео.');
    $('#btnMore').hidden = !nav.pageToken;
  } catch (e) {
    listStatus(e.message, true);
  } finally {
    nav.loading = false;
    ui?.redraw();
  }
}

function renderCrumbs() {
  const c = $('#crumbs');
  c.replaceChildren();
  const label = { shared: 'Доступные мне', recent: 'Недавние видео', search: 'Поиск: ' + nav.query }[nav.source];
  $('#folderTitle').textContent = nav.stack.length ? nav.stack[nav.stack.length - 1].name : (label || 'Мой диск');
  updateCount();
  if (label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { nav.stack = []; loadList(true); };
    c.append(b);
  }
  nav.stack.forEach((f, i) => {
    if (c.children.length) { const s = document.createElement('span'); s.textContent = '›'; c.append(s); }
    const b = document.createElement('button');
    b.textContent = f.name;
    b.onclick = () => { nav.stack = nav.stack.slice(0, i + 1); loadList(true); };
    c.append(b);
  });
}

// Превью: кадр из случайной секунды в середине видео (генерирует ПК через ffmpeg)
const thumbQueue = [];
let thumbActive = 0;
function queueThumb(fn) { thumbQueue.push(fn); pumpThumbs(); }
function pumpThumbs() {
  while (thumbActive < 3 && thumbQueue.length) {
    const fn = thumbQueue.shift();
    thumbActive++;
    fn().finally(() => { thumbActive--; pumpThumbs(); });
  }
}
const thumbObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    thumbObserver.unobserve(e.target);
    e.target._loadThumb?.();
  }
}, { rootMargin: '300px' }) : null;

// адрес превью закрепляется при первом показе → дальше картинка берётся из кеша браузера
function ownThumbUrl(f) {
  const key = 'liquido.thumb.' + f.id;
  let q = LS.get(key, null);
  if (!q) {
    const fmt = fileFormat(f);
    const dur = (f.videoMediaMetadata?.durationMillis || 0) / 1000;
    q = `v=2&proj=${fmt.projection}&stereo=${fmt.stereo}&dur=${dur.toFixed(1)}`;
    LS.set(key, q);
  }
  return `${PC_BASE}thumb/${encodeURIComponent(f.id)}.jpg?${q}`;
}

function attachThumb(thumbEl, f) {
  const shimmer = document.createElement('div');
  shimmer.className = 'shimmer';
  thumbEl.append(shimmer);
  const tryLoad = (src) => new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    if (src.startsWith(PC_BASE + 'thumb/')) img.crossOrigin = 'anonymous';
    else {
      // превью Google — целый кадр: для 3D берём левый глаз, а не стык двух глаз по центру
      const st = fileFormat(f).stereo;
      if (st === 'sbs') img.style.objectPosition = '12% 50%';   // центр левой половины кадра в постере 2:3
      if (st === 'tb') img.style.objectPosition = '50% 0%';
    }
    img.alt = '';
    img.onload = () => { thumbEl.append(img); requestAnimationFrame(() => img.classList.add('loaded')); resolve(true); };
    img.onerror = () => resolve(false);
    img.src = src;
  });
  thumbEl._loadThumb = () => queueThumb(async () => {
    const own = ownThumbUrl(f);
    const ok = await tryLoad(own) || (f.thumbnailLink && await tryLoad(f.thumbnailLink));
    shimmer.remove();
    return ok;
  });
  if (thumbObserver) thumbObserver.observe(thumbEl); else thumbEl._loadThumb();
}

// ── превью папок: кадр из первого видео папки (или подпапки) + число видео ──
// Ответ Диска кешируется на сутки, а сама картинка — то же превью видео, что и в его карточке (делается один раз).
const FPREV_TTL = 15 * 60 * 1000;   // 15 минут: новая обложка, положенная в папку, появится быстро
const COVER_NAMES = /^(cover|poster|folder|preview|thumb|thumbnail|обложка|превью|постер)$/i;
const folderPrevs = new Map();   // id → Promise<{ v, n, more, subs }>
const pickVideo = (f) => (f ? { id: f.id, name: f.name, size: f.size, mimeType: f.mimeType, videoMediaMetadata: f.videoMediaMetadata } : null);
function folderPreview(id, folderName = '') {
  if (folderPrevs.has(id)) return folderPrevs.get(id);
  const p = (async () => {
    const key = 'liquido.fprev3.' + id;
    const c = LS.get(key, null);
    if (c && Date.now() - c.at < FPREV_TTL) return c;
    const common = { supportsAllDrives: true, includeItemsFromAllDrives: true, orderBy: 'name' };
    const vq = `trashed=false and mimeType contains 'video/'`;
    const r = await api('/files', { ...common, q: `'${esc(id)}' in parents and ${vq}`, pageSize: 100, fields: 'nextPageToken,files(' + FILE_FIELDS + ')' });
    let vids = r.files || [];
    const res = { v: pickVideo(vids[0]), n: vids.length, more: !!r.nextPageToken, subs: 0, at: Date.now(), cover: null };
    // своя обложка: картинка в папке с именем cover / poster / folder / обложка / превью (или любая картинка)
    try {
      const im = await api('/files', { ...common, q: `'${esc(id)}' in parents and trashed=false and mimeType contains 'image/'`, pageSize: 50, fields: 'files(id,name,modifiedTime,size)' });
      const imgs = (im.files || []).filter((x) => !/\.(heic|heif|svg)$/i.test(x.name));
      const base = (x) => x.name.replace(/\.[a-z0-9]{2,5}$/i, '').trim().toLowerCase();
      const own = folderName.trim().toLowerCase();
      // 1) картинка с тем же именем, что и папка (папка «VR» → VR.jpg); 2) cover/обложка/…; 3) любая картинка
      const c = (own && imgs.find((x) => base(x) === own)) || imgs.find((x) => COVER_NAMES.test(base(x))) || imgs[0];
      if (c) res.cover = { id: c.id, mod: c.modifiedTime || '' };
    } catch { /* без обложки — кадр из видео */ }
    if (!vids.length) {          // видео нет — смотрим во вложенных папках (один уровень)
      const sub = await api('/files', { ...common, q: `'${esc(id)}' in parents and trashed=false and mimeType='${FOLDER}'`, pageSize: 20, fields: 'nextPageToken,files(id)' });
      const ids = (sub.files || []).map((x) => x.id);
      res.subs = ids.length + (sub.nextPageToken ? 1 : 0);
      if (ids.length) {
        const r2 = await api('/files', { ...common, q: '(' + ids.map((i) => `'${esc(i)}' in parents`).join(' or ') + ') and ' + vq, pageSize: 1, fields: 'files(' + FILE_FIELDS + ')' });
        vids = r2.files || [];
        res.v = pickVideo(vids[0]);
      }
    }
    LS.set(key, res);
    return res;
  })();
  p.catch(() => folderPrevs.delete(id));   // ошибка сети — попробуем при следующем показе
  folderPrevs.set(id, p);
  return p;
}
// Обложка папки: файл с Диска → уменьшенная копия (до 900 px) в Cache Storage браузера → blob-адрес.
// blob-адрес «свой» для страницы, поэтому картинку можно рисовать и в VR-панели (WebGL).
const coverUrls = new Map();
async function shrinkImage(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return new Promise((res) => cv.toBlob((b) => res(b || blob), 'image/jpeg', 0.88));
}
function coverUrl(c) {
  const key = c.id + '|' + c.mod;
  if (coverUrls.has(key)) return coverUrls.get(key);
  const p = (async () => {
    const cache = 'caches' in window ? await caches.open('liquido-covers').catch(() => null) : null;
    const req = new Request(new URL('__cover/' + encodeURIComponent(c.id) + '?m=' + encodeURIComponent(c.mod), location.href).href);
    let resp = cache ? await cache.match(req) : null;
    if (!resp) {
      const t = await getToken();
      const r = await fetch(DRIVE + '/files/' + encodeURIComponent(c.id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) throw new Error('cover ' + r.status);
      const small = await shrinkImage(await r.blob());
      resp = new Response(small, { headers: { 'Content-Type': small.type || 'image/jpeg' } });
      if (cache) await cache.put(req, resp.clone()).catch(() => {});
    }
    return URL.createObjectURL(await resp.blob());
  })();
  p.catch(() => coverUrls.delete(key));
  coverUrls.set(key, p);
  return p;
}
// адрес картинки для постера папки: своя обложка, иначе кадр из видео
async function folderImageUrl(pv) {
  if (pv.cover) { try { return await coverUrl(pv.cover); } catch { /* не открылась — кадр из видео */ } }
  return pv.v ? ownThumbUrl(pv.v) : null;
}

function folderCountText(pv) {
  if (pv.n) return pv.n + (pv.more ? '+' : '') + ' ' + plural(pv.n, 'видео', 'видео', 'видео');
  if (pv.subs) return pv.subs + (pv.subs > 20 ? '+' : '') + ' ' + plural(pv.subs, 'папка', 'папки', 'папок');
  return 'Нет видео';
}
function attachFolderThumb(thumbEl, folderId, countEl, metaEl, folderName) {
  thumbEl._loadThumb = () => queueThumb(async () => {
    let pv;
    try { pv = await folderPreview(folderId, folderName); } catch { return false; }
    const txt = folderCountText(pv);
    countEl.textContent = txt;
    metaEl.textContent = 'Папка · ' + txt.toLowerCase();
    const src = await folderImageUrl(pv);
    if (!src) return false;
    const shimmer = document.createElement('div');
    shimmer.className = 'shimmer';
    thumbEl.append(shimmer);
    const ok = await new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      if (!src.startsWith('blob:')) img.crossOrigin = 'anonymous';
      img.alt = '';
      img.onload = () => {
        thumbEl.insertBefore(img, thumbEl.firstChild);
        thumbEl.classList.add('has-img');
        requestAnimationFrame(() => img.classList.add('loaded'));
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = src;
    });
    shimmer.remove();
    return ok;
  });
  if (thumbObserver) thumbObserver.observe(thumbEl); else thumbEl._loadThumb();
}

function renderItems(files) {
  const list = $('#list');
  for (const f of files) {
    const targetMime = f.shortcutDetails?.targetMimeType || f.mimeType || '';
    const isFolder = targetMime === FOLDER;
    const isVideo = targetMime.startsWith('video/');
    const card = document.createElement('button');
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = f.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    info.append(name, meta);

    if (isFolder) {
      card.className = 'card folder';
      const wrap = document.createElement('div');
      wrap.className = 'fwrap';
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.innerHTML = ICONS.folder;
      const b = document.createElement('span');
      b.className = 'badge';
      b.innerHTML = ICONS.folder + '<span>Папка</span>';
      const cnt = document.createElement('span');
      cnt.className = 'fcount';
      thumb.append(b, cnt);
      wrap.append(thumb);
      meta.textContent = 'Папка';
      card.append(wrap, info);
      attachFolderThumb(thumb, f.shortcutDetails?.targetId || f.id, cnt, meta, f.name);
    } else {
      card.className = 'card';
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.innerHTML = isVideo ? ICONS.film : ICONS.file;
      const vm = f.videoMediaMetadata;
      const durS = (vm?.durationMillis || 0) / 1000;
      if (isVideo) {
        const fmt = fileFormat(f);
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = formatLabel(fmt);
        thumb.append(b);
        const pos = LS.get('liquido.pos.' + f.id, 0);
        if (pos > 0 && durS > 0) {          // частично просмотрено — янтарная полоска
          const pr = document.createElement('i');
          pr.className = 'progress';
          pr.style.width = clamp((pos / durS) * 100, 2, 100).toFixed(1) + '%';
          thumb.append(pr);
        }
        const ph = document.createElement('div');
        ph.className = 'play-hint';
        ph.innerHTML = ICONS.play;
        thumb.append(ph);
        if (f.mimeType !== SHORTCUT) attachThumb(thumb, f);
      }
      meta.textContent = [durS ? fmtTime(durS) : '', fmtBytes(f.size)].filter(Boolean).join(' · ');
      card.append(thumb, info);
    }
    card.onclick = () => {
      if (isVideo && prefs.autoVR && xrSupported) enterVR(); // вход в VR сразу по клику (нужен жест пользователя)
      openItem(f);
    };
    list.append(card);
  }
}

// «Мой диск / Путешествия · 14 видео»
function updateCount() {
  const n = nav.items.filter((f) => (f.shortcutDetails?.targetMimeType || f.mimeType || '').startsWith('video/')).length;
  $('#listCount').textContent = n ? `· ${n} ${plural(n, 'видео', 'видео', 'видео')}${nav.pageToken ? '+' : ''}` : '';
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}

// ── герой «Продолжить»: последнее недосмотренное видео (позиция уже хранится в liquido.pos.<id>) ──
function lastWatched() {
  const last = LS.get('liquido.last', null);
  if (!last?.f?.id) return null;
  const pos = LS.get('liquido.pos.' + last.f.id, 0);
  return pos > 0 ? { ...last, pos } : null;
}
function renderHero() {
  const hero = $('#hero');
  const last = lastWatched();
  hero.replaceChildren();
  const left = document.createElement('div');
  const eb = document.createElement('div');
  eb.className = 'eyebrow';
  const h1 = document.createElement('h1');
  const p = document.createElement('p');
  left.append(eb, h1, p);
  hero.append(left);
  if (!last) {
    hero.className = 'hero solo';
    eb.textContent = 'LiquidoVR';
    h1.textContent = 'Ваш кинозал';
    p.textContent = 'Видео с Google Диска — сразу в шлем, без скачивания.';
    return;
  }
  hero.className = 'hero';
  const f = last.f;
  const dur = (f.videoMediaMetadata?.durationMillis || 0) / 1000;
  eb.textContent = 'Сегодня в зале · Google Диск';
  h1.textContent = f.name.replace(/\.[a-z0-9]{2,4}$/i, '');
  p.textContent = `Остановились на ${fmtTime(last.pos)}${dur ? ' из ' + fmtTime(dur) : ''}. Видео идёт с Диска прямо в шлем — без скачивания.`;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const go = document.createElement('button');
  go.className = 'btn';
  go.innerHTML = '<svg viewBox="0 0 24 24"><path class="fill" d="M7 4.5v15l13-7.5Z"/></svg><span></span>';
  go.querySelector('span').textContent = xrSupported ? 'Продолжить в VR' : 'Продолжить';
  const restart = document.createElement('button');
  restart.className = 'btn ghost';
  restart.textContent = 'С начала';
  const play = (fromStart) => {
    if (fromStart) LS.del('liquido.pos.' + f.id);
    if (xrSupported) enterVR();          // вход в VR — внутри жеста пользователя
    openItem(f);
  };
  go.onclick = () => play(false);
  restart.onclick = () => play(true);
  actions.append(go, restart);
  left.append(actions);

  const poster = document.createElement('div');
  poster.className = 'poster';
  poster.onclick = () => play(false);
  const img = new Image();
  img.alt = '';
  img.crossOrigin = 'anonymous';
  img.onerror = () => img.remove();
  img.src = ownThumbUrl(f);
  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.innerHTML = '<span class="tag">Продолжить</span><span class="fmt"></span>';
  cap.querySelector('.fmt').textContent = formatLine(fileFormat(f), f.videoMediaMetadata);
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = '<i></i>';
  bar.firstChild.style.width = dur ? clamp((last.pos / dur) * 100, 2, 100).toFixed(1) + '%' : '0';
  poster.append(img, cap, bar);
  hero.append(poster);
}

async function openItem(f) {
  try {
    if (f.mimeType === SHORTCUT) {
      const t = await api('/files/' + encodeURIComponent(f.shortcutDetails.targetId), { fields: FILE_FIELDS, supportsAllDrives: true });
      return openItem(t);
    }
    if (f.mimeType === FOLDER) {
      nav.stack.push({ id: f.id, name: f.name });
      return loadList(true);
    }
    await playFile(f);
  } catch (e) {
    if (renderer?.xr?.isPresenting) renderer.xr.getSession()?.end();
    banner(e.message);
  }
}

function parseDriveId(text) {
  text = (text || '').trim();
  const m = /\/folders\/([\w-]{10,})/.exec(text) || /\/file\/d\/([\w-]{10,})/.exec(text) ||
    /[?&]id=([\w-]{10,})/.exec(text) || /^([\w-]{20,})$/.exec(text);
  return m ? m[1] : null;
}

async function openLink(text) {
  const id = parseDriveId(text);
  if (!id) { banner('Не похоже на ссылку Google Диска.'); return; }
  try {
    const f = await api('/files/' + encodeURIComponent(id), { fields: FILE_FIELDS, supportsAllDrives: true });
    if (f.mimeType === FOLDER) {
      showBrowser();
      setActiveTab(null);
      nav.source = 'link';
      nav.stack = [{ id: f.id, name: f.name }];
      return loadList(true);
    }
    await openItem(f);
  } catch (e) {
    banner(e.message);
  }
}

// ───────────────────────── 3D-сцена ─────────────────────────
const video = $('#video');
const R = 10;           // радиус сферы
const SCREEN_W = 4;     // ширина виртуального экрана, м
// Зум: −1 … +1. Минус — отдалить (видео превращается в «окно» впереди, до 5× меньше),
// плюс — приблизить. 0 — обычный размер.
const FLAT_BASE = 5;    // дистанция экрана при зуме 0, м
const FLAT_FAR = 20;    // при зуме −100 %
const FLAT_NEAR = 1.3;  // при зуме +100 %
// Отдаление как в популярных плеерах: купол 180° целиком уезжает вдаль (край остаётся круглым,
// без «квадратной рамки»). Для 360 — в пределах сферы, чтобы не оказаться снаружи шара.
const zoomAngle = () => 1;
const zoomOffset = (z) => {
  if (z >= 0) return z * 0.55 * R;                                     // приближение: сфера ближе
  return z * (effProj() === '360' ? 0.85 : 3.2) * R;                   // отдаление: купол уезжает вперёд
};
const domeAway = () => effProj() !== 'flat' && state.zoom < -0.001;
const flatDist = (z) => (z < 0 ? THREE.MathUtils.lerp(FLAT_BASE, FLAT_FAR, -z) : THREE.MathUtils.lerp(FLAT_BASE, FLAT_NEAR, z));
const fmtZoom = (z) => (z > 0.005 ? '+' : z < -0.005 ? '−' : '') + Math.round(Math.abs(z) * 100) + '%';
let baseYaw = 0, basePitch = 0, tilt = 0; // ориентация видео в VR (центр + наклон стиком)
let baseDirs = null, lastAngle = -1;     // исходные направления вершин сферы (для зума в WebGL)

const state = { projection: prefs.projection, stereo: prefs.stereo, swap: prefs.swap, zoom: prefs.zoom, height: 0, view: '3d', fisheyeFov: null };
// Режим как в популярных плеерах: «3D» — VR (купол/сфера/3D-экран), «2D» — обычный плоский экран, один глаз
const effProj = () => (state.view === '2d' ? 'flat' : state.projection);
let renderer, scene, camera, world, mediaGroup, videoTex, ui;
const controllers = [];
let current = null;
let currentSrc = '';
let yaw = 0, pitch = 0;
let recenterFrames = 0;
let lastPosSave = 0;
let xrSupported = false;

function buildEnvironment() {
  const env = new THREE.Group();
  const cv = document.createElement('canvas');
  cv.width = 8; cv.height = 256;
  const cx = cv.getContext('2d');
  const g = cx.createLinearGradient(0, 0, 0, 256);   // тёплый тёмный зал
  g.addColorStop(0, '#1c140e');
  g.addColorStop(0.42, '#120d0a');
  g.addColorStop(0.52, '#0b0807');
  g.addColorStop(1, '#050403');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false }));
  dome.renderOrder = -2;
  dome.name = 'dome';
  env.add(dome);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 96),
    new THREE.MeshBasicMaterial({ color: 0x120d09, transparent: true, opacity: 0.85, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.6;
  floor.renderOrder = -1;
  floor.name = 'floor';
  env.add(floor);
  // (тонкое кольцо пола и звёзды-точки убраны: мерцали при поворотах головы)

  // Режим «Экран»: мягкое тёплое свечение за экраном (одна плоскость с градиентом — на FPS не влияет)
  const gc = document.createElement('canvas');
  gc.width = gc.height = 256;
  const gx = gc.getContext('2d');
  const rg = gx.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0, 'rgba(255,181,71,0.18)');
  rg.addColorStop(0.55, 'rgba(255,181,71,0.07)');
  rg.addColorStop(1, 'rgba(255,181,71,0)');
  gx.fillStyle = rg;
  gx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(gc);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, toneMapped: false }));
  glow.renderOrder = -1.5;
  glow.name = 'glow';
  env.add(glow);

  // «Окно» для XR-слоя: в чёткем режиме экран выводит шлем ПОД нашей сценой, поэтому зал рисуем вокруг,
  // а на месте экрана делаем прозрачную дыру (пишем альфу 0) — видео видно сквозь неё.
  // «окно» пишет в кадр готовый фильтр картинки (или прозрачность 0, если регулировок нет)
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), FILTER_MAT);
  hole.renderOrder = -1.2;
  hole.name = 'hole';
  hole.visible = false;
  env.add(hole);
  return env;
}

// свечение и «окно» повторяют положение и размер виртуального экрана
function placeScreenDecor(layerOn) {
  const glow = scene?.getObjectByName('glow'), hole = scene?.getObjectByName('hole');
  if (!glow || !hole) return;
  const flat = effProj() === 'flat';
  const d = flatDist(state.zoom);
  glow.visible = flat;
  glow.position.set(0, state.height, -d - 0.02);
  glow.scale.set(flatEye.w * 1.9, flatEye.h * 2.2, 1);
  hole.visible = flat && layerOn;
  hole.position.set(0, state.height, -d);
  hole.scale.set(flatEye.w * 1.004, flatEye.h * 1.004, 1);
}

function initScene() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  renderer.xr.setFoveation(0); // без размытия по краям (по умолчанию three.js включает максимум)
  $('#stage').prepend(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050403);
  camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  camera.layers.enable(1); // вне VR показываем левый глаз
  scene.add(camera);

  world = new THREE.Group();
  scene.add(world);
  world.add(buildEnvironment());
  mediaGroup = new THREE.Group();
  world.add(mediaGroup);

  ui = new VRUI(world);

  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    const ray = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0015, 0.004, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.5, depthWrite: false })
    );
    ray.scale.z = 3;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 24),
      new THREE.MeshBasicMaterial({ color: 0xffb547, depthTest: false, transparent: true }));
    dot.renderOrder = 1001;
    dot.visible = false;
    c.add(ray);
    scene.add(dot);
    c.userData = { ray, dot, hit: null, drag: null, hoverId: null, source: null };
    c.visible = false;
    c.addEventListener('connected', (e) => { c.userData.source = e.data; c.visible = !!e.data.gamepad; });
    c.addEventListener('disconnected', () => { c.visible = false; c.userData.source = null; dot.visible = false; });
    c.addEventListener('selectstart', () => onSelectStart(c));
    c.addEventListener('selectend', () => { c.userData.drag = null; });
    scene.add(c);
    controllers.push(c);
  }

  renderer.xr.addEventListener('sessionstart', () => {
    camera.layers.disable(1); // каждый глаз видит свой слой: 1 — левый, 2 — правый
    renderer.xr.setFoveation(0);
    // WebXR Media Layers: видео выводит сам шлем в родном разрешении (максимальная чёткость)
    xrLayersOK = typeof XRMediaBinding !== 'undefined' && typeof XRProjectionLayer !== 'undefined' &&
      renderer.xr.getBaseLayer() instanceof XRProjectionLayer;
    updateMediaLayer();
    recenterFrames = 3;
    updateNativeMode();
    ui.setVisible(true);
    $('#btnVR span').textContent = 'Выйти из VR';
    if (!pbActive) video.play().catch(() => {});   // идёт предзагрузка — видео стартует само, когда наберётся запас
  });
  renderer.xr.addEventListener('sessionend', () => {
    camera.layers.enable(1);
    mediaLayer = null; mediaBinding = null; mediaLayerKey = ''; xrLayersOK = false;
    setSceneForLayer(false);
    ui.setVisible(false);
    world.position.set(0, 0, 0);
    world.rotation.set(0, 0, 0);
    baseYaw = 0; basePitch = 0; tilt = 0;
    $('#btnVR span').textContent = 'Смотреть в VR';
    updateNativeMode();
    onResize();
  });

  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw = drag.yaw + (e.clientX - drag.x) * 0.005;
    pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.005, -1.5, 1.5);
  });
  el.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(state.zoom - e.deltaY * 0.001); }, { passive: false });
  new ResizeObserver(onResize).observe($('#stage'));
  onResize();
}

function onResize() {
  if (!renderer || renderer.xr.isPresenting) return;
  const st = $('#stage');
  const w = st.clientWidth || 640, h = st.clientHeight || 360;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function disposeMedia() {
  for (const m of [...mediaGroup.children]) {
    mediaGroup.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
}

function fisheyeUV(geo, fovDeg = 180) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const half = THREE.MathUtils.degToRad(fovDeg) / 2;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const theta = Math.acos(clamp(-v.z, -1, 1));
    const a = Math.atan2(v.y, v.x);
    const r = (theta / half) * 0.5;
    uv.setXY(i, 0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a));
  }
  uv.needsUpdate = true;
}

// Плоский экран → направление взгляда → координаты кадра VR-видео (равнопромежуточная/fisheye развёртка)
function rectilinearUV(geo, proj, w, hfovDeg) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const t = Math.tan(THREE.MathUtils.degToRad(hfovDeg) / 2);
  const half = THREE.MathUtils.degToRad(fisheyeFov()) / 2;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.set(pos.getX(i) / (w / 2) * t, pos.getY(i) / (w / 2) * t, -1).normalize();
    let u, v;
    if (proj === 'fisheye') {
      const th = Math.acos(clamp(-d.z, -1, 1)), a = Math.atan2(d.y, d.x), r = (th / half) * 0.5;
      u = 0.5 + r * Math.cos(a); v = 0.5 + r * Math.sin(a);
    } else {
      const lon = Math.atan2(d.x, -d.z), lat = Math.asin(clamp(d.y, -1, 1));
      u = 0.5 + lon / (proj === '360' ? 2 * Math.PI : Math.PI);
      v = 0.5 + lat / Math.PI;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function eyeUV(geo, layout, eye) { // eye: 0 — левый, 1 — правый
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i), v = uv.getY(i);
    if (layout === 'sbs') u = u * 0.5 + (eye ? 0.5 : 0);
    else v = v * 0.5 + (eye ? 0 : 0.5); // верх кадра — левый глаз
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function rebuildMedia() {
  if (!renderer) return;
  disposeMedia();
  const vw = video.videoWidth || 1920, vh = video.videoHeight || 1080;
  const { stereo, swap } = state;
  const projection = effProj();
  const vrSource = state.projection !== 'flat';   // 2D-режим для VR-видео: глаз квадратный, без «half-SBS»
  const seg = QUALITY[prefs.quality]?.seg || 96;
  let base;
  if (state.view === '2d' && vrSource) {
    // 2D для VR-видео: плоский экран 16:9 с «виртуальной камерой» в центр сцены — нормальная перспектива
    const H = SCREEN_W * 9 / 16;
    flatEye = { w: SCREEN_W, h: H };
    base = new THREE.PlaneGeometry(SCREEN_W, H, 96, 54);
    rectilinearUV(base, state.projection, SCREEN_W, 95);
  } else if (projection === 'flat') {
    let eyeAspect = vw / vh;
    if (stereo === 'sbs') { eyeAspect /= 2; if (eyeAspect < 1.2 && !vrSource) eyeAspect *= 2; }  // half-SBS
    if (stereo === 'tb') { eyeAspect *= 2; if (eyeAspect > 2.6 && !vrSource) eyeAspect /= 2; }   // half-TB
    flatEye = { w: SCREEN_W, h: SCREEN_W / eyeAspect };
    base = new THREE.PlaneGeometry(SCREEN_W, SCREEN_W / eyeAspect);
  } else if (projection === '360') {
    base = new THREE.SphereGeometry(R, seg * 1.5, seg, -1.5 * Math.PI, 2 * Math.PI);
    base.scale(-1, 1, 1);
  } else {
    base = new THREE.SphereGeometry(R, seg, seg, -Math.PI, Math.PI);
    base.scale(-1, 1, 1);
    if (projection === 'fisheye') fisheyeUV(base, fisheyeFov());
  }
  baseDirs = projection === 'flat' ? null : Float32Array.from(base.attributes.position.array);
  lastAngle = -1;
  // область кадра одного глаза: выборки не выходят за неё — иначе на краю купола/экрана
  // просвечивает тонкая полоса соседнего глаза (билинейная фильтрация через границу половин)
  const eyeRect = (e) => (stereo === 'sbs' ? [e * 0.5, 0, e * 0.5 + 0.5, 1] : e === 0 ? [0, 0.5, 1, 1] : [0, 0, 1, 0.5]);
  const mat = (rect = [0, 0, 1, 1]) => {
    const m = new THREE.MeshBasicMaterial({ map: videoTex || null, side: THREE.DoubleSide, toneMapped: false, color: videoTex ? 0xffffff : 0x15110d });
    const eyeU = { value: new THREE.Vector4(...rect) };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, PIC_UNIFORMS);
      sh.uniforms.uEyeRect = eyeU;
      // map_fragment из three r160, но выборка — через liqSample (сглаживание ряби, резкость, граница глаза)
      const mapFrag = THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'liqSample( vMapUv )');
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', `uniform float uBright;\nuniform float uContrast;\nuniform float uSat;\nuniform float uAA;
uniform float uTemp;\nuniform float uSharp;\nuniform vec4 uEyeRect;
#ifdef USE_MAP
vec2 liqClamp( vec2 uv ) {
  vec2 hp = 0.5 / vec2( textureSize( map, 0 ) );
  return clamp( uv, uEyeRect.xy + hp, uEyeRect.zw - hp );
}
// Видео 8K на экране шлема уменьшается, а мип-карт у видео нет: одна выборка «прыгает» между пикселями
// кадра при малейшем движении головы — мелкие детали мерцают и рябят. Где на пиксель экрана приходится
// больше одного пикселя видео, усредняем 4 выборки внутри пикселя (rotated grid). Иначе — одна выборка.
vec4 liqSample( vec2 uv ) {
  vec2 dx = dFdx( uv ), dy = dFdy( uv );
  uv = liqClamp( uv );
  vec4 c = texture2D( map, uv );
  vec2 ts = vec2( textureSize( map, 0 ) );
  if ( uAA > 0.5 ) {
    float fp = max( length( dx * ts ), length( dy * ts ) );
    if ( fp > 1.0 ) {
      vec4 s = texture2D( map, liqClamp( uv - 0.125 * dx - 0.375 * dy ) )
             + texture2D( map, liqClamp( uv + 0.375 * dx - 0.125 * dy ) )
             + texture2D( map, liqClamp( uv + 0.125 * dx + 0.375 * dy ) )
             + texture2D( map, liqClamp( uv - 0.375 * dx + 0.125 * dy ) );
      c = mix( c, s * 0.25, clamp( fp - 1.0, 0.0, 1.0 ) );   // плавно: без скачка резкости
    }
  }
  // резкость (как в PLAY'A): усиливаем разницу с соседями — только при ненулевой настройке
  if ( uSharp > 0.001 ) {
    vec2 px = 1.0 / ts;
    vec4 n = texture2D( map, liqClamp( uv + vec2( px.x, 0.0 ) ) ) + texture2D( map, liqClamp( uv - vec2( px.x, 0.0 ) ) )
           + texture2D( map, liqClamp( uv + vec2( 0.0, px.y ) ) ) + texture2D( map, liqClamp( uv - vec2( 0.0, px.y ) ) );
    c.rgb = clamp( c.rgb + uSharp * ( c.rgb - n.rgb * 0.25 ), 0.0, 1.0 );
  }
  return c;
}
#endif
void main() {`)
        .replace('#include <map_fragment>', `${mapFrag}
          diffuseColor.rgb *= vec3(1.0 + 0.12 * uTemp, 1.0 + 0.02 * uTemp, 1.0 - 0.14 * uTemp);   // теплота
          diffuseColor.rgb = (diffuseColor.rgb - 0.5) * uContrast + 0.5 + uBright;
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = clamp(mix(vec3(lum), diffuseColor.rgb, uSat), 0.0, 1.0);`);
    };
    m.customProgramCacheKey = () => 'liquido-picture-aa-v2';
    return m;
  };
  if (stereo === 'mono') {
    mediaGroup.add(new THREE.Mesh(base, mat()));
  } else if (state.view === '2d' || state.view === 'mono') {   // mono: купол 180°, оба глаза — одна половина кадра
    eyeUV(base, stereo, swap ? 1 : 0);          // 2D: оба глаза видят один и тот же кадр (левый глаз)
    mediaGroup.add(new THREE.Mesh(base, mat(eyeRect(swap ? 1 : 0))));
  } else {
    for (const eye of [0, 1]) {
      const g = base.clone();
      const e = swap ? 1 - eye : eye;
      eyeUV(g, stereo, e);
      const m = new THREE.Mesh(g, mat(eyeRect(e)));
      m.layers.set(eye === 0 ? 1 : 2);
      mediaGroup.add(m);
    }
    base.dispose();
  }
  // пол виртуального зала — только для режима «Экран» (в 180/360 он оказался бы поверх видео)
  for (const n of ['floor']) { const o = scene.getObjectByName(n); if (o) o.visible = projection === 'flat'; }
  placeScreenDecor(layerOnScene);
  updateMipmaps();
  applyZoom();
  updateMediaLayer();
  updateNativeMode();
  ui?.redraw();
}

// ── ПК: обычное (плоское 2D) видео показываем настоящим <video> браузера — чётче и без нагрузки 3D-сцены.
// В VR и для 180°/360°/3D остаётся 3D-сцена. На весь экран: кнопка, двойной клик или клавиша F.
let nativeOn = false;
function updateNativeMode() {
  const on = !!current && !renderer?.xr?.isPresenting && state.projection === 'flat' && state.stereo === 'mono';
  if (on === nativeOn) return;
  nativeOn = on;
  document.body.classList.toggle('native-video', on);
  $('#btnVR').hidden = on && !xrSupported;
  if (!on && document.fullscreenElement === video) document.exitFullscreen().catch(() => {});
}
// На весь экран разворачиваем весь #stage: видео + наша панель управления (не стандартные кнопки браузера).
function toggleFullscreen() {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  $('#stage').requestFullscreen?.().catch((e) => stageMsg('Не удалось открыть на весь экран: ' + e.message));
}
let idleTimer = 0;
function wakeControls() {
  const st = $('#stage');
  st.classList.remove('idle');
  clearTimeout(idleTimer);
  if (document.fullscreenElement === st) idleTimer = setTimeout(() => { if (!video.paused) st.classList.add('idle'); }, 2500);
}
document.addEventListener('fullscreenchange', () => {
  const st = $('#stage'), tr = $('.transport'), fs = document.fullscreenElement === st;
  if (fs) st.append(tr); else if (tr.parentElement === st) st.after(tr);   // панель переезжает внутрь полноэкранного плеера
  $('#fsTitle').textContent = $('#nowTitle').textContent;
  $('#fsFmt').textContent = $('#nowFmt').textContent;
  syncFullBtn();
  wakeControls();
  onResize();
});
function syncFullBtn() {
  const fs = !!document.fullscreenElement;
  $('#cFull').innerHTML = fs ? ICONS.unfull : ICONS.full;
  $('#cFull').title = fs ? 'Выйти из полноэкранного режима (F, Esc)' : 'На весь экран (F)';
}
function syncMute() {
  $('#cMute').innerHTML = video.muted || video.volume === 0 ? ICONS.muted : ICONS.sound;
  $('#cVolT').value = video.muted ? 0 : Math.round(video.volume * 100);
  paintRange($('#cVolT'));
}
video.addEventListener('volumechange', syncMute);
video.addEventListener('pause', wakeControls);
video.addEventListener('play', wakeControls);
video.addEventListener('click', () => { if (nativeOn) togglePlay(); });
video.addEventListener('dblclick', (e) => { if (nativeOn) { e.preventDefault(); toggleFullscreen(); } });

// ───────── регулировка картинки ─────────
const PIC_UNIFORMS = {
  uBright: { value: 0 }, uContrast: { value: 1 }, uSat: { value: 1 }, uAA: { value: 1 }, uTemp: { value: 0 }, uSharp: { value: 0 },
};
const PIC_KEYS = ['b', 'c', 's', 't', 'sh'];   // яркость, контраст, насыщенность, теплота, резкость
const pictureActive = () => PIC_KEYS.some((k) => Math.abs(prefs.picture[k] || 0) > 0.005);
function applyPicture() {
  PIC_UNIFORMS.uBright.value = (prefs.picture.b || 0) * 0.25;
  PIC_UNIFORMS.uContrast.value = 1 + (prefs.picture.c || 0) * 0.5;
  PIC_UNIFORMS.uSat.value = 1 + (prefs.picture.s || 0);
  PIC_UNIFORMS.uTemp.value = prefs.picture.t || 0;
  PIC_UNIFORMS.uSharp.value = (prefs.picture.sh || 0) * 0.9;
  PIC_UNIFORMS.uAA.value = prefs.aa !== false ? 1 : 0;
}
applyPicture();
// ── Регулировки поверх чёткого XR-слоя (без выключения слоя) ──
// Видео в XR-слое выводит сам шлем, а наш WebGL-кадр накладывается сверху с «премультиплицированной» альфой:
// итог = наш_цвет + (1 − наша_альфа) × видео. Этим можно затемнить/осветлить, сдвинуть к серому
// (меньше контраста) и к тёплому/холодному. Насыщенность, резкость и «больше контраста» так не сделать —
// для них нужен WebGL-вывод, а он на 6K/8K мигает: там эти три регулировки не применяются.
const FILTER_U = { uC: { value: new THREE.Vector4(0, 0, 0, 0) } };
const FILTER_MAT = new THREE.ShaderMaterial({
  uniforms: FILTER_U,
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec4 uC; void main() { gl_FragColor = uC; }',
  side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor,
});
let filterDome = null;   // сфера вокруг головы с фильтром — для 180°/360°
function overlayRGBA() {
  const pc = prefs.picture;
  let m = 1, r = 0, g = 0, b = 0;
  const mul = (k) => { m *= k; r *= k; g *= k; b *= k; };
  const add = (x, y, z) => { r += x; g += y; b += z; };
  const c = pc.c || 0, t = pc.t || 0, br = pc.b || 0;
  if (c < 0) { const a = -c * 0.5; mul(1 - a); add(0.5 * a, 0.5 * a, 0.5 * a); }   // меньше контраста — к серому
  if (t) {                                                                       // теплее / холоднее
    const a = Math.abs(t) * 0.14;
    mul(1 - a);
    if (t > 0) add(0.11 * Math.abs(t), 0.045 * Math.abs(t), 0);
    else add(0, 0.03 * Math.abs(t), 0.11 * Math.abs(t));
  }
  if (br > 0) add(br * 0.2, br * 0.2, br * 0.2);                                // светлее
  else if (br < 0) mul(1 + br * 0.6);                                            // темнее
  return [r, g, b, 1 - m];
}
const bigVideo = () => (video.videoWidth || 0) > 4096;
// регулировки, которым нужен WebGL-вывод (насыщенность, резкость, больше контраста)
const glOnlyPicture = () => Math.abs(prefs.picture.s || 0) > 0.005 || (prefs.picture.sh || 0) > 0.005 || (prefs.picture.c || 0) > 0.005;
const needsGLPicture = () => glOnlyPicture() && !bigVideo();
function applyFilterOverlay() {
  const on = layerOnScene;
  const [r, g, b, a] = on ? overlayRGBA() : [0, 0, 0, 0];
  FILTER_U.uC.value.set(r, g, b, a);
  const active = on && (a > 0.001 || r + g + b > 0.001) && effProj() !== 'flat';
  if (active && !filterDome && world) {
    filterDome = new THREE.Mesh(new THREE.SphereGeometry(3, 32, 16), FILTER_MAT);
    filterDome.renderOrder = -1.1;
    filterDome.frustumCulled = false;
    world.add(filterDome);
  }
  if (filterDome) filterDome.visible = active;
}
function setPicture(k, v) {
  const was = needsGLPicture();
  prefs.picture[k] = Math.abs(v) < 0.03 ? 0 : clamp(v, k === 'sh' ? 0 : -1, 1);
  savePrefs();
  applyPicture();
  if (was !== needsGLPicture()) updateMediaLayer();
  applyFilterOverlay();
  if (layerOnScene && bigVideo() && glOnlyPicture() && (k === 's' || k === 'sh' || (k === 'c' && v > 0))) {
    ui?.toastMsg('На 6K/8K насыщенность, резкость и «больше контраста» не работают — иначе видео мигает', true);
  }
}

// ───────── WebXR Media Layers ─────────
// Видео отдаётся компоновщику шлема напрямую (без перерисовки через WebGL): чётко и без нагрузки.
let xrLayersOK = false, mediaBinding = null, mediaLayer = null, mediaLayerKey = '', layerRetries = 0;
let flatEye = { w: SCREEN_W, h: SCREEN_W * 9 / 16 };
const BG_COLOR = new THREE.Color(0x050403);

function layerWanted() {
  return xrLayersOK && prefs.layers !== false && !!renderer?.xr?.isPresenting && video.videoWidth > 0 &&
    effProj() !== 'fisheye' && !state.swap && !needsGLPicture() &&
    !(state.view === '2d' && (state.stereo !== 'mono' || state.projection !== 'flat')) &&
    !(state.view === 'mono' && state.stereo !== 'mono');   // XR-слой не умеет показать обоим глазам одну половину
}

let layerOnScene = false;
function setSceneForLayer(on) {
  if (!scene) return;
  layerOnScene = on;
  mediaGroup.visible = !on;
  // экран (quad-слой): зал остаётся, в нём «окно»; 180/360: купол закрывает всё — зал прячем
  const keepHall = on && effProj() === 'flat';
  for (const n of ['dome']) { const o = scene.getObjectByName(n); if (o) o.visible = !on || keepHall; }
  scene.background = on ? null : BG_COLOR;
  renderer.setClearColor(0x000000, on ? 0 : 1);
  placeScreenDecor(on);
  applyFilterOverlay();
}

function layerTransform(dist, follow) {
  world.updateMatrixWorld(true);
  const base = follow ? headLocal : ZERO3;
  const pt = new THREE.Vector3(base.x, base.y + state.height, base.z - dist).applyMatrix4(world.matrixWorld);
  const q = world.getWorldQuaternion(new THREE.Quaternion());
  return new XRRigidTransform({ x: pt.x, y: pt.y, z: pt.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
}

function applyLayerProps() {
  if (!mediaLayer) return;
  const z = state.zoom;
  try {
    if (effProj() === 'flat') {
      mediaLayer.transform = layerTransform(flatDist(z));
    } else {
      // Отдаление в XR-слое: кадр ужимается в меньший угол обзора (окно впереди), слой при этом НЕ выключается.
      // Раньше при отдалении включался WebGL-рендер 8K-кадра — браузер Quest не успевал копировать кадр
      // в текстуру, и видео моргало чёрными кадрами.
      const a = z < -0.001 ? 1 + z * 0.7 : 1;
      const zoomed = z > 0.001;
      // свойства слоя меняем только при изменении: лишние присваивания каждый кадр заставляют
      // компоновщик шлема пересобирать слой (риск мигания при движении головы)
      const radius = zoomed ? R : 0;   // 0 = бесконечная сфера: при движении головы картинка не «плывёт»
      const ch = (state.projection === '360' ? 2 * Math.PI : Math.PI) * a;
      if (mediaLayer.radius !== radius) mediaLayer.radius = radius;
      if (Math.abs(mediaLayer.centralHorizontalAngle - ch) > 1e-5) mediaLayer.centralHorizontalAngle = ch;
      if (Math.abs(mediaLayer.upperVerticalAngle - (Math.PI / 2) * a) > 1e-5) {
        mediaLayer.upperVerticalAngle = (Math.PI / 2) * a;
        mediaLayer.lowerVerticalAngle = (-Math.PI / 2) * a;
      }
      const tKey = [-zoomOffset(z), zoomed, headLocal.x, headLocal.y, headLocal.z, state.height, baseYaw, basePitch, tilt,
        world.position.x, world.position.y, world.position.z]
        .map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join('|');
      if (tKey !== mediaLayer._tKey) { mediaLayer._tKey = tKey; mediaLayer.transform = layerTransform(-zoomOffset(z), zoomed); }
    }
  } catch (e) { console.warn('layer props', e); }
}

function updateMediaLayer() {
  if (!renderer?.xr?.isPresenting) return;
  const session = renderer.xr.getSession();
  const base = renderer.xr.getBaseLayer();
  const want = layerWanted();
  const key = want ? [effProj(), state.stereo, video.currentSrc, flatEye.w.toFixed(3), flatEye.h.toFixed(3)].join('|') : '';
  if (want && key === mediaLayerKey && mediaLayer) { applyLayerProps(); return; }
  if (mediaLayer) { try { mediaLayer.destroy(); } catch { /* ignore */ } mediaLayer = null; }
  mediaLayerKey = '';
  if (want) {
    try {
      mediaBinding = mediaBinding || new XRMediaBinding(session);
      const layout = state.stereo === 'sbs' ? 'stereo-left-right' : state.stereo === 'tb' ? 'stereo-top-bottom' : 'mono';
      const space = renderer.xr.getReferenceSpace();
      mediaLayer = effProj() === 'flat'
        ? mediaBinding.createQuadLayer(video, { space, layout, width: flatEye.w, height: flatEye.h })
        : mediaBinding.createEquirectLayer(video, { space, layout, radius: state.zoom > 0.001 ? R : 0 });
      mediaLayerKey = key;
      applyLayerProps();
      session.updateRenderState({ layers: [mediaLayer, base] });
      setSceneForLayer(true);
      return;
    } catch (e) {
      console.warn('XR media layer:', e);
      mediaLayer = null;
      // Раньше одна неудача навсегда выключала XR-слой до конца сеанса → всё шло через WebGL (а он на 8K мигает).
      // Теперь пробуем снова через 1,5 с (до 6 раз за видео).
      layerRetries = (layerRetries || 0) + 1;
      if (layerRetries <= 6) setTimeout(() => updateMediaLayer(), 1500);
      else ui?.toastMsg('XR-слой недоступен — включён совместимый режим', true);
    }
  }
  if (base) { try { session.updateRenderState({ layers: [base] }); } catch { /* базовый XRWebGLLayer */ } }
  setSceneForLayer(false);
}

// Сжимает сферу к направлению «вперёд»: угол от центра × a (видео становится меньше, как окно вдали)
function applyAngular(a) {
  if (!baseDirs || a === lastAngle) return;
  lastAngle = a;
  for (const m of mediaGroup.children) {
    const pos = m.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = baseDirs[i] / R, y = baseDirs[i + 1] / R, zz = baseDirs[i + 2] / R;
      const th = Math.acos(clamp(-zz, -1, 1));
      if (th < 1e-6) { arr[i] = 0; arr[i + 1] = 0; arr[i + 2] = -R; continue; }
      const az = Math.atan2(y, x), nt = th * a, sn = Math.sin(nt) * R;
      arr[i] = sn * Math.cos(az); arr[i + 1] = sn * Math.sin(az); arr[i + 2] = -Math.cos(nt) * R;
    }
    pos.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  }
}

// ───────── сфера «следует» за головой (только перенос), как во всех VR-плеерах ─────────
const ZERO3 = new THREE.Vector3();
const headLocal = new THREE.Vector3();
const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hs = new THREE.Vector3();
function followHead() {
  const cams = renderer.xr.getCamera().cameras;   // позы глаз текущего кадра
  if (!cams || !cams.length) return;
  headLocal.set(0, 0, 0);
  for (const c of cams) { c.matrix.decompose(_hp, _hq, _hs); headLocal.add(_hp); }
  headLocal.multiplyScalar(1 / cams.length);
  world.worldToLocal(headLocal);
  if (filterDome?.visible) filterDome.position.copy(headLocal);
  if (effProj() !== 'flat' && !domeAway()) {
    mediaGroup.position.set(headLocal.x, headLocal.y + state.height, headLocal.z + zoomOffset(state.zoom));
    if (mediaLayer && state.zoom > 0.001) applyLayerProps();
  }
}

// Мип-карты нужны, когда видео заметно уменьшено (далёкий экран, отъехавший купол) — иначе рябь
let mipOn = null;
function updateMipmaps() {
  if (!videoTex) return;
  // для 6K/8K мип-карты не строим: пересчёт пирамиды огромного кадра 30–60 раз в секунду даёт рывки,
  // а рябь там гасит сглаживание в шейдере (liqSample)
  const on = !mediaLayer && (video.videoWidth || 0) <= 4096 &&
    (domeAway() || (effProj() === 'flat' && flatDist(state.zoom) > 3));
  if (on === mipOn) return;
  mipOn = on;
  videoTex.generateMipmaps = on;
  videoTex.minFilter = on ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  videoTex.anisotropy = on ? (renderer.capabilities.getMaxAnisotropy() || 1) : 1;
  videoTex.needsUpdate = true;
}

function applyZoom() {
  if (!mediaGroup) return;
  const z = state.zoom;
  if (effProj() === 'flat') mediaGroup.position.set(0, state.height, -flatDist(z));
  else { mediaGroup.position.set(headLocal.x, headLocal.y + state.height, headLocal.z + zoomOffset(z)); applyAngular(zoomAngle(z)); }
  placeScreenDecor(layerOnScene);
  updateMipmaps();
  if (renderer?.xr?.isPresenting && layerWanted() !== !!mediaLayer) updateMediaLayer();
  else applyLayerProps();
}
function setZoom(z, snap = true) {
  z = clamp(z, -1, 1);
  // «прилипание» к обычному размеру — только для ползунка/колеса (крупные шаги).
  // Стик меняет зум маленькими шагами каждый кадр: прилипание там намертво держало зум на 0.
  if (snap && Math.abs(z) < 0.02) z = 0;
  state.zoom = z;
  applyZoom();
  syncZoomUI();
}

function setHeight(h) {
  state.height = clamp(Math.round(h * 100) / 100, -1.5, 1.5);
  applyZoom();
}

function applyWorldRotation() {
  world.rotation.set(basePitch + tilt, baseYaw, 0, 'YXZ');
  applyLayerProps();
}

function saveFormat() {
  if (current && !String(current.id).startsWith('demo:')) {
    LS.set('liquido.fmt.' + current.id, { projection: state.projection, stereo: state.stereo, swap: state.swap, zoom: state.zoom, height: state.height, view: state.view, fisheyeFov: state.fisheyeFov });
  }
}
function setFormat(patch) {
  Object.assign(state, patch);
  saveFormat();
  rebuildMedia();
  syncControls();
}

function recenter() {
  if (renderer?.xr?.isPresenting) {
    const xrCam = renderer.xr.getCamera();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    xrCam.matrixWorld.decompose(pos, q, s);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    world.position.copy(pos);
    baseYaw = Math.atan2(-fwd.x, -fwd.z);
    basePitch = Math.asin(clamp(fwd.y, -1, 1)); // лёжа — видео встаёт перед глазами
    tilt = 0;
    applyWorldRotation();
    ui?.resetPlacement();
  } else {
    yaw = 0; pitch = 0;
  }
}

const seekStep = () => (SEEK_STEPS.includes(prefs.seekStep) ? prefs.seekStep : 10);
const fisheyeFov = () => state.fisheyeFov || prefs.fisheyeFov || 180;
function seekBy(d) {
  if (!isFinite(video.duration)) return;
  video.currentTime = clamp(video.currentTime + d, 0, video.duration - 0.5);
}
function togglePlay() {
  pbToken++;                       // пользователь сам нажал — отменяем ожидание предзагрузки
  if (video.paused) video.play().catch((e) => stageMsg('Не удалось запустить: ' + e.message));
  else video.pause();
}
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function setSpeed(v) {
  prefs.speed = v; savePrefs();
  video.defaultPlaybackRate = v;
  video.playbackRate = v;
}

// ───────── плейлист: соседние видео текущей папки ─────────
const isVideoFile = (f) => (f.mimeType || '').startsWith('video/');
// Очередь — видео той папки, из которой запустили просмотр. Раньше бралась текущая открытая папка:
// если во время просмотра полистать библиотеку, «следующее» и «случайное» уходили в чужую папку.
let playQueue = [];
function playlist() { return playQueue.length ? playQueue : nav.items.filter(isVideoFile); }
function playSibling(dir) {
  const list = playlist();
  const i = list.findIndex((f) => f.id === current?.id);
  const next = i >= 0 ? list[i + dir] : null;
  if (!next) { ui?.toastMsg(dir > 0 ? 'Это последнее видео в папке' : 'Это первое видео в папке'); return; }
  savePosition();
  playFile(next).catch((e) => { banner(e.message); ui?.toastMsg(e.message, true); });
}

function setVolume(v) {
  video.volume = clamp(v, 0, 1);
  prefs.volume = video.volume;
  savePrefs();
  $('#cVol').value = Math.round(video.volume * 100);
  paintRange($('#cVol'));
  syncMute();
}

// ───────────────────────── VR-интерфейс (рисуется на canvas) ─────────────────────────
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const DISPLAY = '"Playfair Display", Georgia, serif';
const C = {
  bg: 'rgba(26,23,20,0.96)', card: 'rgba(255,236,210,0.06)', hover: 'rgba(255,236,210,0.14)',
  text: '#f4ece1', muted: '#a89a88', accent: '#ffb547', onAccent: '#1a1206',
  line: '#3a332b', curtain: '#b3262d', warn: '#ffd896',
};
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
// разрядка для надписей в стиле «eyebrow/label»
function spaced(c, text, x, y, px, align = 'left') {
  if ('letterSpacing' in c) {
    c.letterSpacing = Math.round(px * 0.18) + 'px';
    c.textAlign = align; c.fillText(text, x, y);
    c.letterSpacing = '0px';
    return;
  }
  c.textAlign = align; c.fillText(text.split('').join(' '), x, y);
}
// canvas рисует веб-шрифт, только если он уже загружен (иначе — системный); кириллицу грузим явно
const fontsReady = (document.fonts ? Promise.all([
  document.fonts.load(`800 52px ${DISPLAY}`, 'АаЯя Aa'),
  document.fonts.load(`700 40px ${DISPLAY}`, 'АаЯя Aa'),
  document.fonts.load(`600 32px ${FONT}`, 'АаЯя Aa 0123'),
  document.fonts.load(`700 32px ${FONT}`, 'АаЯя Aa 0123'),
  document.fonts.load(`500 26px ${FONT}`, 'АаЯя Aa'),
]).catch(() => {}) : Promise.resolve()).then(() => { ui?.redraw(); });
function ellipsize(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 2 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

class CanvasPanel {
  constructor(W, H, widthM) {
    this.W = W; this.H = H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, widthM * H / W),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    );
    this.mesh.renderOrder = 1000;
    this.mesh.userData.panel = this;
    this.regions = [];
    this.hover = null;
    this.lastDraw = 0;
  }
  begin() {
    this.regions = [];
    const c = this.ctx;
    c.clearRect(0, 0, this.W, this.H);
    rr(c, 4, 4, this.W - 8, this.H - 8, 24);
    c.fillStyle = C.bg; c.fill();
    c.strokeStyle = C.line; c.lineWidth = 3; c.stroke();
    c.textBaseline = 'middle';
  }
  end() { this.tex.needsUpdate = true; this.lastDraw = now(); }
  region(id, x, y, w, h, onPress, drag = false) { this.regions.push({ id, x, y, w, h, onPress, drag }); }
  hitAt(uv) {
    const x = uv.x * this.W, y = (1 - uv.y) * this.H;
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { panel: this, region: r, fx: clamp((x - r.x) / r.w, 0, 1) };
    }
    return { panel: this, region: null };
  }
  fxFor(region, uv) { return clamp((uv.x * this.W - region.x) / region.w, 0, 1); }
}

function drawIcon(c, name, cx, cy, s, color) {
  c.save();
  c.translate(cx, cy);
  c.fillStyle = color; c.strokeStyle = color;
  c.lineWidth = Math.max(3, s * 0.085); c.lineCap = 'round'; c.lineJoin = 'round';
  const u = s / 2;
  switch (name) {
    case 'play':
      c.beginPath(); c.moveTo(-u * 0.32, -u * 0.5); c.lineTo(u * 0.55, 0); c.lineTo(-u * 0.32, u * 0.5); c.closePath(); c.fill(); break;
    case 'pause':
      rr(c, -u * 0.42, -u * 0.48, u * 0.28, u * 0.96, u * 0.06); c.fill();
      rr(c, u * 0.14, -u * 0.48, u * 0.28, u * 0.96, u * 0.06); c.fill(); break;
    case 'back10': case 'fwd10': {
      const r = u * 0.58;
      c.save();
      if (name === 'back10') c.scale(-1, 1);
      const a0 = -Math.PI / 2 + 0.25, a1 = Math.PI * 1.5 - 0.55;
      c.beginPath(); c.arc(0, 0, r, a0, a1); c.stroke();
      const px = r * Math.cos(a1), py = r * Math.sin(a1);
      const tx = -Math.sin(a1), ty = Math.cos(a1); // касательная по часовой
      const nx = Math.cos(a1), ny = Math.sin(a1);
      const h = u * 0.26;
      c.beginPath();
      c.moveTo(px + tx * h, py + ty * h);
      c.lineTo(px + nx * h * 0.7, py + ny * h * 0.7);
      c.lineTo(px - nx * h * 0.7, py - ny * h * 0.7);
      c.closePath(); c.fill();
      c.restore();
      c.font = `700 ${Math.round(u * 0.5)}px ${FONT}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(seekStep()), 0, u * 0.04);
      break;
    }
    case 'gear': {
      for (let i = 0; i < 8; i++) { c.save(); c.rotate(i * Math.PI / 4); rr(c, -u * 0.11, -u * 0.62, u * 0.22, u * 0.3, u * 0.05); c.fill(); c.restore(); }
      c.lineWidth = u * 0.2;
      c.beginPath(); c.arc(0, 0, u * 0.36, 0, Math.PI * 2); c.stroke();
      break;
    }
    case 'center':
      c.beginPath(); c.arc(0, 0, u * 0.42, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(0, 0, u * 0.12, 0, Math.PI * 2); c.fill();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        c.beginPath(); c.moveTo(dx * u * 0.55, dy * u * 0.55); c.lineTo(dx * u * 0.72, dy * u * 0.72); c.stroke();
      }
      break;
    case 'exit': case 'close':
      c.beginPath(); c.moveTo(-u * 0.36, -u * 0.36); c.lineTo(u * 0.36, u * 0.36);
      c.moveTo(u * 0.36, -u * 0.36); c.lineTo(-u * 0.36, u * 0.36); c.stroke(); break;
    case 'grid':
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { rr(c, dx * u * 0.3 - u * 0.24, dy * u * 0.3 - u * 0.24, u * 0.48, u * 0.48, u * 0.1); c.fill(); }
      break;
    case 'prev': case 'next': {
      c.save();
      if (name === 'prev') c.scale(-1, 1);
      c.beginPath(); c.moveTo(-u * 0.38, -u * 0.42); c.lineTo(u * 0.22, 0); c.lineTo(-u * 0.38, u * 0.42); c.closePath(); c.fill();
      rr(c, u * 0.26, -u * 0.42, u * 0.14, u * 0.84, u * 0.04); c.fill();
      c.restore();
      break;
    }
    case 'back':
      c.beginPath(); c.moveTo(u * 0.2, -u * 0.4); c.lineTo(-u * 0.2, 0); c.lineTo(u * 0.2, u * 0.4); c.stroke(); break;
    case 'minus':
      c.beginPath(); c.moveTo(-u * 0.38, 0); c.lineTo(u * 0.38, 0); c.stroke(); break;
    case 'plus':
      c.beginPath(); c.moveTo(-u * 0.38, 0); c.lineTo(u * 0.38, 0); c.moveTo(0, -u * 0.38); c.lineTo(0, u * 0.38); c.stroke(); break;
  }
  c.restore();
}

// наведение — янтарное кольцо
function hoverRing(c, hov) { if (hov) { c.lineWidth = 6; c.strokeStyle = C.accent; c.stroke(); } }

function iconButton(p, id, cx, cy, r, icon, onPress, opts = {}) {
  const c = p.ctx, hov = p.hover === id;
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
  if (opts.primary) {
    c.fillStyle = C.accent; c.fill();
    if (hov) { c.beginPath(); c.arc(cx, cy, r + 9, 0, Math.PI * 2); c.lineWidth = 5; c.strokeStyle = 'rgba(255,181,71,0.55)'; c.stroke(); }
  } else {
    c.fillStyle = opts.active ? 'rgba(255,181,71,0.16)' : hov ? '#26211c' : 'rgba(0,0,0,0)'; c.fill();   // как .icon-btn на сайте
    c.lineWidth = 3; c.strokeStyle = opts.active ? C.accent : C.line; c.stroke();
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); hoverRing(c, hov);
  }
  const k = opts.primary ? 0.95 : (icon === 'back10' || icon === 'fwd10') ? 1.35 : 0.9;
  drawIcon(c, icon, cx, cy, r * k, opts.primary ? C.onAccent : opts.active ? C.accent : C.text);
  if (opts.label) {
    c.fillStyle = hov ? C.text : C.muted;
    c.font = `600 26px ${FONT}`; c.textAlign = 'center';
    c.fillText(opts.label, cx, cy + r + 30);
  }
  p.region(id, cx - r, cy - r, 2 * r, 2 * r, onPress);
}

function textButton(p, id, x, y, w, h, label, onPress, primary) {
  const c = p.ctx, hov = p.hover === id;
  rr(c, x, y, w, h, 16);
  c.fillStyle = primary ? C.accent : hov ? C.hover : C.card; c.fill();
  if (!primary) { c.lineWidth = 3; c.strokeStyle = C.line; c.stroke(); }
  rr(c, x, y, w, h, 16); hoverRing(c, hov);
  c.fillStyle = primary ? C.onAccent : C.text; c.font = `600 32px ${FONT}`; c.textAlign = 'center';
  c.fillText(ellipsize(c, label, w - 40), x + w / 2, y + h / 2 + 1);
  p.region(id, x, y, w, h, onPress);
}

// сегменты → «чипы»: отдельные прямоугольники с рамкой, активный — янтарь
function segmented(p, id, x, y, w, h, options, value, onSelect) {
  const c = p.ctx, GAP = 14;
  const sw = (w - GAP * (options.length - 1)) / options.length;
  options.forEach(([k, label], i) => {
    const sx = x + i * (sw + GAP), rid = id + ':' + k, active = k === value, hov = p.hover === rid;
    rr(c, sx, y, sw, h, 16);
    c.fillStyle = active ? C.accent : hov ? C.hover : 'transparent'; c.fill();
    if (!active) { c.lineWidth = 3; c.strokeStyle = C.line; c.stroke(); }
    rr(c, sx, y, sw, h, 16); hoverRing(c, hov && !active);
    c.fillStyle = active ? C.onAccent : hov ? C.text : C.muted;
    c.font = `600 30px ${FONT}`; c.textAlign = 'center';
    c.fillText(ellipsize(c, label, sw - 24), sx + sw / 2, y + h / 2 + 1);
    p.region(rid, sx, y, sw, h, () => onSelect(k));
  });
}

// тонкий трек, янтарное заполнение, бегунок цвета текста
function slider(p, id, x, y, w, h, v, onChange) {
  const c = p.ctx, hov = p.hover === id, ty = y + h / 2;
  rr(c, x, ty - 4, w, 8, 4); c.fillStyle = C.line; c.fill();
  rr(c, x, ty - 4, Math.max(8, w * v), 8, 4); c.fillStyle = C.accent; c.fill();
  c.beginPath(); c.arc(x + w * v, ty, hov ? 22 : 16, 0, Math.PI * 2);
  c.fillStyle = C.text; c.fill();
  if (hov) { c.lineWidth = 5; c.strokeStyle = C.accent; c.stroke(); }
  p.region(id, x, y, w, h, onChange, true);
}

// Основная панель — «билет»: информация | перфорация | транспорт | перфорация | кнопки
const TICKET = { W: 2000, H: 320, P1: 640, P2: 1380, NOTCH: 22 };
function drawMain(p) {
  const c = p.ctx, W = p.W, H = p.H;
  p.regions = [];
  c.clearRect(0, 0, W, H);
  c.textBaseline = 'middle';
  // панель как плеер на сайте: тёмная поверхность, тонкая рамка, разделители между блоками
  rr(c, 4, 4, W - 8, H - 8, 24);
  c.fillStyle = C.bg; c.fill();
  c.strokeStyle = C.line; c.lineWidth = 3; c.stroke();
  c.fillStyle = C.line;
  for (const x of [TICKET.P1, TICKET.P2]) c.fillRect(x - 1, 40, 2, H - 80);

  // 1) сеанс: формат, название, тех. строка
  const vm = current?.videoMediaMetadata || { width: video.videoWidth };
  const LX = 56, LW = TICKET.P1 - LX - 40;
  c.fillStyle = C.accent; c.font = `600 26px ${FONT}`;
  spaced(c, ellipsize(c, ('Сеанс · ' + formatLine(state, vm)).toUpperCase(), LW - 40), LX, 100, 26);
  c.textAlign = 'left'; c.fillStyle = C.text; c.font = `700 42px ${DISPLAY}`;
  c.fillText(ellipsize(c, (current?.name || 'LiquidoVR').replace(/\.[a-z0-9]{2,4}$/i, ''), LW), LX, 160);
  c.fillStyle = C.muted; c.font = `500 24px ${FONT}`;
  const res = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '—';
  const sp = (prefs.speed || 1) !== 1 ? ` · ${prefs.speed}×` : '';
  c.fillText(ellipsize(c, `${res} · ${mediaLayer ? 'XR-слой' : 'рендер ' + QUALITY[prefs.quality].name} · зум ${fmtZoom(state.zoom)}${sp}`, LW), LX, 222);

  // 2) транспорт: ⏮ −10 ▶ +10 ⏭ и прогресс со временем
  const cx = (TICKET.P1 + TICKET.P2) / 2, cy = 112;
  iconButton(p, 'prev', cx - 255, cy, 42, 'prev', () => playSibling(-1));
  iconButton(p, 'back', cx - 135, cy, 52, 'back10', () => seekBy(-seekStep()));
  iconButton(p, 'play', cx, cy, 64, video.paused ? 'play' : 'pause', togglePlay, { primary: true });
  iconButton(p, 'fwd', cx + 135, cy, 52, 'fwd10', () => seekBy(seekStep()));
  iconButton(p, 'next', cx + 255, cy, 42, 'next', () => playSibling(1));

  const ty = 246, dur = video.duration || 0;
  const tx0 = TICKET.P1 + 40, tx1 = TICKET.P2 - 40;
  c.fillStyle = C.muted; c.font = `600 26px ${FONT}`;
  c.textAlign = 'left'; c.fillText(fmtTime(video.currentTime), tx0, ty);
  c.textAlign = 'right'; c.fillText(fmtTime(dur), tx1, ty);
  const bx = tx0 + 100, bw = tx1 - 100 - bx;
  const frac = dur ? clamp(video.currentTime / dur, 0, 1) : 0, hov = p.hover === 'seek';
  rr(c, bx, ty - 4, bw, 8, 4); c.fillStyle = C.line; c.fill();
  if (dur) {
    c.fillStyle = 'rgba(244,236,225,0.18)';
    for (let i = 0; i < video.buffered.length; i++) {
      const s0 = video.buffered.start(i) / dur, e = video.buffered.end(i) / dur;
      rr(c, bx + s0 * bw, ty - 4, Math.max(0, (e - s0) * bw), 8, 4); c.fill();
    }
  }
  rr(c, bx, ty - 4, Math.max(8, bw * frac), 8, 4); c.fillStyle = C.accent; c.fill();
  c.beginPath(); c.arc(bx + bw * frac, ty, hov ? 20 : 14, 0, Math.PI * 2); c.fillStyle = C.text; c.fill();
  if (hov) { c.lineWidth = 5; c.strokeStyle = C.accent; c.stroke(); }
  p.region('seek', bx - 10, ty - 44, bw + 20, 88, (fx) => { if (dur) video.currentTime = clamp((fx * (bw + 20) - 10) / bw, 0, 1) * dur; }, true);

  // 3) режим и формат, ниже — библиотека, настройки, центр, выход
  const RX = TICKET.P2 + 44;
  // кнопка 3D/2D: у VR-видео (180°/360° SBS/TB) — 3D ↔ 2D Mono (купол остаётся), у обычных — 3D ↔ плоский экран
  const vrStereo = state.projection !== 'flat' && state.stereo !== 'mono';
  textButton(p, 'view', RX, cy - 46, 136, 92, state.view === '3d' ? '3D' : '2D',
    () => setFormat({ view: state.view === '3d' ? (vrStereo ? 'mono' : '2d') : '3d' }), state.view === '3d');
  textButton(p, 'fmt', RX + 152, cy - 46, W - 56 - (RX + 152), 92,
    `${PROJ_NAME[state.projection]} · ${state.stereo === 'mono' ? '2D' : state.stereo.toUpperCase()}`, () => ui.openSettings(true));
  const by = 246, step = 128;
  iconButton(p, 'library', RX + 46, by, 46, 'grid', () => ui.openLibrary(), { active: ui.sheet === 'library' });
  iconButton(p, 'settings', RX + 46 + step, by, 46, 'gear', () => ui.openSettings(), { active: ui.sheet === 'settings' });
  iconButton(p, 'center', RX + 46 + step * 2, by, 46, 'center', recenter);
  iconButton(p, 'exit', RX + 46 + step * 3, by, 46, 'exit', () => renderer.xr.getSession()?.end());
  p.end();
}

function sheetHeader(p, title, extra) {
  const c = p.ctx, W = p.W;
  c.textAlign = 'left'; c.fillStyle = C.text; c.font = `800 52px ${DISPLAY}`;
  c.fillText(title, 64, 84);
  iconButton(p, 'close', W - 96, 84, 46, 'close', () => { ui.sheet = null; ui.setVisible(true); });
  if (extra) extra();
}

function valueSlider(p, id, x, y, w, h, v01, text, onChange, step) {
  const c = p.ctx;
  iconButton(p, id + '-', x + 46, y + h / 2, 44, 'minus', () => onChange(clamp(v01 - step, 0, 1)));
  slider(p, id, x + 130, y, w - 420, h, v01, onChange);
  iconButton(p, id + '+', x + w - 214, y + h / 2, 44, 'plus', () => onChange(clamp(v01 + step, 0, 1)));
  c.textAlign = 'right'; c.fillStyle = C.text; c.font = `700 32px ${FONT}`;
  c.fillText(text, x + w, y + h / 2);
}

const TABS = [['video', 'Видео'], ['picture', 'Картинка'], ['play', 'Воспроизведение']];
const signed = (v, digits = 0) => (v > 0.005 ? '+' : v < -0.005 ? '−' : '') + Math.abs(v).toFixed(digits);

function drawSettings(p) {
  const c = p.ctx, W = p.W;
  p.begin();
  sheetHeader(p, 'Настройки', () => {
    segmented(p, 'tab', 410, 40, W - 410 - 170, 88, TABS, ui.tab, (k) => { ui.tab = k; ui.redraw(); });
  });
  const LX = 64, CX = 430, CW = W - CX - 64, RH = 92, STEP = 120;
  let y = 170;
  const label = (t) => { c.fillStyle = C.muted; c.font = `600 24px ${FONT}`; spaced(c, t.toUpperCase(), LX, y + RH / 2, 24); };
  const note = (t) => { c.textAlign = 'left'; c.fillStyle = C.muted; c.font = `500 26px ${FONT}`; c.fillText(t, LX, y + 30); };

  if (ui.tab === 'video') {
    label('Проекция');
    segmented(p, 'proj', CX, y, CW, RH, PROJ.map((k) => [k, PROJ_NAME[k]]), state.projection, (k) => setFormat({ projection: k }));
    y += STEP;
    label('3D-режим');
    segmented(p, 'stereo', CX, y, CW, RH, STEREO.map((k) => [k, STEREO_LONG[k]]), state.stereo, (k) => setFormat({ stereo: k }));
    y += STEP;
    label('Глаза');
    segmented(p, 'swap', CX, y, CW, RH, [['n', 'Левый | Правый'], ['s', 'Поменять местами']], state.swap ? 's' : 'n', (k) => setFormat({ swap: k === 's' }));
    y += STEP;
    label('Зум');
    valueSlider(p, 'zoom', CX, y, CW, RH, (state.zoom + 1) / 2, fmtZoom(state.zoom), (v) => { setZoom(v * 2 - 1); saveFormat(); }, 0.05);
    y += STEP;
    label('Высота');
    valueSlider(p, 'height', CX, y, CW, RH, (state.height + 1.5) / 3, signed(state.height * 100) + ' см',
      (v) => { setHeight(v * 3 - 1.5); saveFormat(); }, 0.1 / 3);
    y += STEP;
    label('Режим');
    segmented(p, 'view', CX, y, CW, RH, [['3d', '3D'], ['mono', '2D Mono (180°)'], ['2d', '2D экран']], state.view, (k) => setFormat({ view: k }));
    y += STEP;
    label('Угол fisheye');
    segmented(p, 'fov', CX, y, CW, RH, [[180, '180°'], [190, '190°'], [200, '200°'], [220, '220°']], fisheyeFov(), (k) => {
      state.fisheyeFov = k; prefs.fisheyeFov = k; savePrefs(); saveFormat(); rebuildMedia();
      if (state.projection !== 'fisheye') ui.toastMsg('Применяется к видео в проекции Fisheye');
    });
    y += STEP + 10;
    textButton(p, 'savedef', 64, y, 820, 92, 'Сделать форматом по умолчанию', () => {
      Object.assign(prefs, { projection: state.projection, stereo: state.stereo, swap: state.swap, zoom: state.zoom });
      savePrefs(); syncPrefsUI();
      ui.toastMsg('Сохранено как формат по умолчанию');
    }, true);
    textButton(p, 'reset', 908, y, W - 908 - 64, 92, 'Сброс: 180° SBS', () => {
      setFormat({ projection: '180', stereo: 'sbs', swap: false, view: '3d', fisheyeFov: null });
      state.height = 0; setZoom(0); tilt = 0; if (renderer?.xr?.isPresenting) applyWorldRotation(); saveFormat();
    });
  } else if (ui.tab === 'picture') {
    const pc = prefs.picture;
    label('Яркость');
    valueSlider(p, 'pb', CX, y, CW, RH, (pc.b + 1) / 2, signed(pc.b * 100), (v) => setPicture('b', v * 2 - 1), 0.05);
    y += STEP;
    label('Контраст');
    valueSlider(p, 'pc', CX, y, CW, RH, (pc.c + 1) / 2, signed(pc.c * 100), (v) => setPicture('c', v * 2 - 1), 0.05);
    y += STEP;
    label('Насыщенность');
    valueSlider(p, 'ps', CX, y, CW, RH, (pc.s + 1) / 2, signed(pc.s * 100), (v) => setPicture('s', v * 2 - 1), 0.05);
    y += STEP;
    label('Теплота');
    valueSlider(p, 'pt', CX, y, CW, RH, ((pc.t || 0) + 1) / 2, signed((pc.t || 0) * 100), (v) => setPicture('t', v * 2 - 1), 0.05);
    y += STEP;
    label('Резкость');
    valueSlider(p, 'psh', CX, y, CW, RH, pc.sh || 0, Math.round((pc.sh || 0) * 100) + '%', (v) => setPicture('sh', v), 0.1);
    y += STEP + 10;
    textButton(p, 'picreset', 64, y, 600, 92, 'Сбросить картинку', () => {
      PIC_KEYS.forEach((k) => setPicture(k, 0));
    }, true);
    y += STEP + 10;
    note('Яркость, теплота и «меньше контраста» работают в чётком режиме (XR-слой).');
    y += 44;
    note(bigVideo() ? 'Насыщенность, резкость и «больше контраста» на 6K/8K не применяются (иначе мигает).'
      : 'Насыщенность, резкость и «больше контраста» включают совместимый режим.');
  } else {
    label('Скорость');
    segmented(p, 'speed', CX, y, CW, RH, SPEEDS.map((v) => [v, v + '×']), prefs.speed || 1, (k) => { setSpeed(k); ui.toastMsg('Скорость ' + k + '×'); });
    y += STEP;
    label('Громкость');
    valueSlider(p, 'vol', CX, y, CW, RH, video.volume, Math.round(video.volume * 100) + '%', (v) => setVolume(v), 0.1);
    y += STEP;
    label('Качество');
    segmented(p, 'q', CX, y, CW, RH, QUALITY_KEYS.map((k) => [k, QUALITY[k].name]), prefs.quality, (k) => {
      prefs.quality = k; savePrefs(); rebuildMedia(); syncPrefsUI();
      ui.toastMsg('Чёткость рендера изменится при следующем входе в VR');
    });
    y += STEP;
    label('Вывод видео');
    segmented(p, 'out', CX, y, CW, RH, [['layer', 'Чёткий (XR-слой)'], ['gl', 'Совместимый']], prefs.layers !== false ? 'layer' : 'gl', (k) => {
      prefs.layers = k === 'layer'; savePrefs(); updateMediaLayer();
      ui.toastMsg(prefs.layers ? (mediaLayer ? 'Чёткий режим включён' : 'XR-слой недоступен для этого формата/настроек') : 'Совместимый режим');
    });
    y += STEP;
    label('Сглаживание');
    segmented(p, 'aa', CX, y, CW, RH, [['on', 'Без ряби (мягче)'], ['off', 'Выключено (резче)']], prefs.aa !== false ? 'on' : 'off', (k) => {
      prefs.aa = k === 'on'; savePrefs(); applyPicture();
      ui.toastMsg(mediaLayer ? 'Сглаживание работает в режиме «Совместимый»' : prefs.aa ? 'Сглаживание включено' : 'Сглаживание выключено');
    });
    y += STEP;
    label('После видео');
    segmented(p, 'endmode', CX, y, CW, RH, END_MODES, prefs.endMode || 'next', (k) => {
      prefs.endMode = k; prefs.autoNext = k === 'next'; savePrefs();
    });
    y += STEP;
    label('Шаг перемотки');
    segmented(p, 'seekstep', CX, y, CW, RH, SEEK_STEPS.map((v) => [v, v + ' с']), seekStep(), (k) => {
      prefs.seekStep = k; savePrefs(); ui.main.draw();
    });
    y += STEP + 20;
    note('Наклон видео — правый стик вверх/вниз, сброс — нажать правый стик.');
  }
  p.end();
}

function drawFolderIcon(c, cx, cy, s) {
  c.fillStyle = C.accent;
  rr(c, cx - s, cy - s * 0.55, s * 0.9, s * 0.3, s * 0.08); c.fill();
  rr(c, cx - s, cy - s * 0.4, s * 2, s * 1.2, s * 0.12); c.fill();
}

// VR-библиотека в стиле сайта на ПК: шапка (логотип, вкладки), заголовок папки, постеры 2:3 с подписью снизу
const LIB_TABS = [['root', 'Мой диск'], ['shared', 'Доступные мне'], ['recent', 'Недавние']];
const LIB_COLS = 6, LIB_ROWS = 2, LIB_PER = LIB_COLS * LIB_ROWS;
function drawCover(c, img, x, y, w, h) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
  c.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function posterBadge(c, x, y, text, folderIcon) {
  c.font = `700 18px ${FONT}`;
  const tw = c.measureText(text).width + text.length * 3 + (folderIcon ? 30 : 0);
  rr(c, x, y, tw + 22, 34, 5); c.fillStyle = 'rgba(15,13,11,0.78)'; c.fill();
  if (folderIcon) drawFolderIcon(c, x + 22, y + 18, 8);
  c.fillStyle = C.text; spaced(c, text, x + 11 + (folderIcon ? 28 : 0), y + 18, 14);
}
function drawLibrary(p) {
  const c = p.ctx, W = p.W, H = p.H;
  p.regions = [];
  c.clearRect(0, 0, W, H);
  c.textBaseline = 'middle';
  rr(c, 4, 4, W - 8, H - 8, 24);
  c.fillStyle = 'rgba(15,13,11,0.97)'; c.fill();
  c.strokeStyle = C.line; c.lineWidth = 3; c.stroke();

  // ── шапка как на сайте: ● LiquidoVR | вкладки | закрыть ──
  c.beginPath(); c.arc(72, 64, 30, 0, Math.PI * 2); c.fillStyle = 'rgba(255,181,71,0.15)'; c.fill();
  c.beginPath(); c.arc(72, 64, 21, 0, Math.PI * 2); c.fillStyle = C.accent; c.fill();
  c.textAlign = 'left'; c.fillStyle = C.text; c.font = `800 40px ${DISPLAY}`;
  c.fillText('LiquidoVR', 114, 66);
  let tx = 420;
  for (const [src, label] of LIB_TABS) {
    const active = nav.source === src && (src !== 'root' || nav.stack.length <= 1);
    const id = 'tab:' + src, hov = p.hover === id;
    c.font = `${active ? 600 : 500} 28px ${FONT}`;
    const w = c.measureText(label).width;
    c.fillStyle = active || hov ? C.text : C.muted; c.textAlign = 'left';
    c.fillText(label, tx, 64);
    if (active) { c.fillStyle = C.accent; c.fillRect(tx, 98, w, 4); }
    p.region(id, tx - 14, 20, w + 28, 90, () => { ui.libPage = 0; openSource(src); ui.redraw(); });
    tx += w + 56;
  }
  iconButton(p, 'close', W - 82, 64, 38, 'close', () => { ui.sheet = null; ui.setVisible(true); });
  c.fillStyle = C.line; c.fillRect(4, 126, W - 8, 2);

  // ── подзаголовок: ← название папки · число видео ──
  const kind = (f) => f.shortcutDetails?.targetMimeType || f.mimeType || '';
  const items = nav.items.filter((f) => kind(f) === FOLDER || isVideoFile(f));
  const title = nav.stack.length ? nav.stack[nav.stack.length - 1].name
    : ({ shared: 'Доступные мне', recent: 'Недавние видео', search: 'Поиск: ' + nav.query }[nav.source] || 'Мой диск');
  let hx = 64;
  if (nav.stack.length > 1) {
    iconButton(p, 'up', 92, 186, 30, 'back', () => { nav.stack = nav.stack.slice(0, -1); ui.libPage = 0; loadList(true); });
    hx = 140;
  }
  const nVid = items.filter(isVideoFile).length;
  const countTxt = nVid ? `${nVid}${nav.pageToken ? '+' : ''} видео` : '';
  c.font = `600 24px ${FONT}`;
  const cw = countTxt ? c.measureText(countTxt).width : 0;
  c.textAlign = 'left'; c.fillStyle = C.text; c.font = `700 44px ${DISPLAY}`;
  c.fillText(ellipsize(c, title, W - hx - cw - 120), hx, 188);
  if (countTxt) { c.textAlign = 'right'; c.fillStyle = C.muted; c.font = `600 24px ${FONT}`; c.fillText(countTxt, W - 64, 190); }

  // ── сетка постеров 2:3 ──
  const GX = 28, GY = 18, PEEK = 16;
  const tw = (W - 128 - GX * (LIB_COLS - 1)) / LIB_COLS, th = tw * 1.5, rowH = PEEK + th + 74;
  const pages = Math.max(1, Math.ceil(items.length / LIB_PER));
  ui.libPage = clamp(ui.libPage, 0, pages - 1);
  const pageItems = items.slice(ui.libPage * LIB_PER, ui.libPage * LIB_PER + LIB_PER);
  if (!items.length) {
    c.textAlign = 'center'; c.fillStyle = C.muted; c.font = `600 32px ${FONT}`;
    c.fillText(nav.loading ? 'Загрузка…' : (account ? 'Здесь нет видео' : 'Google Диск не подключён'), W / 2, 600);
  }
  pageItems.forEach((f, i) => {
    const x = 64 + (i % LIB_COLS) * (tw + GX), y0 = 236 + Math.floor(i / LIB_COLS) * (rowH + GY), y = y0 + PEEK;
    const id = 'lib:' + f.id, hov = p.hover === id, isCur = f.id === current?.id;
    const isFolder = kind(f) === FOLDER;
    if (isFolder) {           // два листа «стопкой» за постером
      c.lineWidth = 2;
      rr(c, x + tw * 0.13, y0 - (hov ? 4 : 0), tw * 0.74, 34, 8); c.fillStyle = '#2b241d'; c.fill();
      c.strokeStyle = hov ? 'rgba(255,181,71,0.6)' : '#4a3f33'; c.stroke();
      rr(c, x + tw * 0.065, y0 + 8 - (hov ? 2 : 0), tw * 0.87, 34, 8); c.fillStyle = '#3a3026'; c.fill();
      c.strokeStyle = hov ? 'rgba(255,181,71,0.6)' : '#5a4c3d'; c.stroke();
    }
    c.save();
    rr(c, x, y, tw, th, 12); c.clip();
    const bg = c.createLinearGradient(x, y, x + tw * 0.3, y + th);
    bg.addColorStop(0, isFolder ? '#3a2a1b' : '#2b2119'); bg.addColorStop(1, '#15110d');
    c.fillStyle = bg; c.fillRect(x, y, tw, th);
    let meta = '';
    if (isFolder) {
      const fi = vrFolder(f);
      if (fi.img && fi.img.ok) drawCover(c, fi.img, x, y, tw, th);
      else drawFolderIcon(c, x + tw / 2, y + th / 2, 34);
      meta = 'Папка' + (fi.txt ? ' · ' + fi.txt.toLowerCase() : '');
      const g = c.createLinearGradient(0, y + th * 0.45, 0, y + th);
      g.addColorStop(0, 'rgba(15,13,11,0)'); g.addColorStop(1, 'rgba(15,13,11,0.88)');
      c.fillStyle = g; c.fillRect(x, y, tw, th);
      posterBadge(c, x + 12, y + 12, 'ПАПКА', true);
      if (fi.txt) {
        c.fillStyle = C.accent; c.fillRect(x + 14, y + th - 26, 22, 3);
        c.textAlign = 'left'; c.fillStyle = C.text; c.font = `600 19px ${FONT}`;
        spaced(c, fi.txt.toUpperCase(), x + 46, y + th - 24, 14);
      }
    } else {
      const img = vrThumb(f);
      if (img && img.ok) drawCover(c, img, x, y, tw, th);
      else drawIcon(c, 'play', x + tw / 2, y + th / 2, 56, 'rgba(244,236,225,0.2)');
      const g = c.createLinearGradient(0, y + th * 0.6, 0, y + th);
      g.addColorStop(0, 'rgba(15,13,11,0)'); g.addColorStop(1, 'rgba(15,13,11,0.5)');
      c.fillStyle = g; c.fillRect(x, y, tw, th);
      posterBadge(c, x + 12, y + 12, formatLabel(fileFormat(f)).toUpperCase(), false);
      const d = (f.videoMediaMetadata?.durationMillis || 0) / 1000;
      const pos = LS.get('liquido.pos.' + f.id, 0);
      if (pos > 0 && d) { c.fillStyle = C.accent; c.fillRect(x, y + th - 5, tw * clamp(pos / d, 0.02, 1), 5); }
      meta = [d ? fmtTime(d) : '', fmtBytes(f.size)].filter(Boolean).join(' · ');
      if (hov) {               // янтарная кнопка ▶ при наведении — как на сайте
        c.beginPath(); c.arc(x + tw / 2, y + th / 2, 40, 0, Math.PI * 2); c.fillStyle = C.accent; c.fill();
        drawIcon(c, 'play', x + tw / 2 + 3, y + th / 2, 44, C.onAccent);
      }
    }
    c.restore();
    rr(c, x, y, tw, th, 12); c.lineWidth = 2; c.strokeStyle = C.line; c.stroke();
    if (hov || isCur) { rr(c, x - 7, y - 7, tw + 14, th + 14, 16); c.lineWidth = 4; c.strokeStyle = C.accent; c.stroke(); }
    c.textAlign = 'left'; c.fillStyle = isCur ? C.accent : C.text; c.font = `700 25px ${DISPLAY}`;
    c.fillText(ellipsize(c, f.name.replace(/\.[a-z0-9]{2,4}$/i, ''), tw), x, y + th + 30);
    c.fillStyle = C.muted; c.font = `500 19px ${FONT}`;
    c.fillText(ellipsize(c, meta, tw), x, y + th + 58);
    p.region(id, x - 7, y0 - 7, tw + 14, rowH, () => {
      if (isFolder) { nav.stack.push({ id: f.shortcutDetails?.targetId || f.id, name: f.name }); ui.libPage = 0; loadList(true); ui.redraw(); }
      else { ui.sheet = null; ui.setVisible(true); openItem(f); }
    });
  });

  // ── страницы ──
  const py = H - 52;
  if (ui.libPage > 0) iconButton(p, 'pgprev', W / 2 - 170, py, 30, 'back', () => { ui.libPage--; ui.redraw(); });
  if (pages > 1 || nav.pageToken) {
    c.textAlign = 'center'; c.fillStyle = C.muted; c.font = `600 26px ${FONT}`;
    c.fillText(`${ui.libPage + 1} / ${pages}`, W / 2, py);
  }
  if (ui.libPage < pages - 1) iconButton(p, 'pgnext', W / 2 + 170, py, 30, 'next', () => { ui.libPage++; ui.redraw(); });
  else if (nav.pageToken) textButton(p, 'more', W / 2 + 130, py - 32, 300, 64, 'Показать ещё', () => loadList(false));
  p.end();
}

function drawPair(p) {
  const c = p.ctx, W = p.W;
  const st = ui.pair || {};
  const mode = st.mode || 'pin';
  p.begin();
  sheetHeader(p, 'Подключение к ПК');
  c.textAlign = 'left'; c.fillStyle = C.muted; c.font = `600 32px ${FONT}`;
  c.fillText(st.st?.host ? 'Компьютер найден: ' + st.st.host : 'Компьютер с LiquidoVR не найден в сети', 64, 170);
  c.fillText(mode === 'pin' ? 'Введите PIN из окна «Запустить.cmd» на ПК' : 'Введите адрес ПК (показан в окне «Запустить.cmd»)', 64, 220);

  // поле ввода
  const val = mode === 'pin' ? (st.pin || '') : (st.ip || '');
  rr(c, 64, 260, 700, 110, 16); c.fillStyle = C.card; c.fill();
  c.strokeStyle = C.accent; c.lineWidth = 3; c.stroke();
  c.textAlign = 'center'; c.fillStyle = C.text; c.font = `700 60px ${FONT}`;
  c.fillText(mode === 'pin' ? (val.padEnd(6, '·').split('').join(' ')) : (val || '192.168.…'), 64 + 350, 318);
  if (st.error) { c.textAlign = 'left'; c.fillStyle = C.warn; c.font = `700 30px ${FONT}`; c.fillText(st.error, 64, 420); }
  if (st.busy) { c.textAlign = 'left'; c.fillStyle = C.accent; c.font = `700 30px ${FONT}`; c.fillText('Подключаюсь…', 64, 420); }

  // кнопки действий слева
  const setVal = (v) => { if (mode === 'pin') st.pin = v; else st.ip = v; ui.redraw(); };
  textButton(p, 'pairgo', 64, 480, 700, 100, mode === 'pin' ? 'Привязать шлем' : 'Подключиться по адресу', () => {
    if (st.busy) return;
    if (mode === 'pin') { if ((st.pin || '').length >= 4) pairWith(st.pin, st.ip || ''); }
    else { st.mode = 'pin'; ui.redraw(); }
  }, true);
  textButton(p, 'pairfind', 64, 610, 700, 100, 'Искать ПК снова', async () => {
    st.error = ''; st.busy = true; ui.redraw();
    try { await fetch(PC_BASE + '__liquido/discover', { cache: 'no-store' }); } catch { /* ignore */ }
    st.busy = false;
    if (await checkAccount()) { openSource('root'); ui.openLibrary(true); }
  });
  textButton(p, 'pairmode', 64, 740, 700, 100, mode === 'pin' ? 'Ввести адрес ПК вручную' : 'Назад к PIN', () => {
    st.mode = mode === 'pin' ? 'ip' : 'pin'; ui.redraw();
  });

  // цифровая клавиатура справа
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', mode === 'ip' ? '.' : '', '0', '⌫'];
  const kx = 880, ky = 260, kw = 200, kh = 170, gap = 20;
  keys.forEach((k, i) => {
    if (!k) return;
    const x = kx + (i % 3) * (kw + gap), y = ky + Math.floor(i / 3) * (kh + gap);
    textButton(p, 'key' + i, x, y, kw, kh, k, () => {
      if (k === '⌫') setVal(val.slice(0, -1));
      else if (mode === 'pin' ? val.length < 6 : val.length < 15) setVal(val + k);
    });
  });
  p.end();
}

// превью папки в VR-библиотеке: кадр из видео папки + число видео
const vrFolderInfo = new Map();
function vrFolder(f) {
  const id = f.shortcutDetails?.targetId || f.id;
  if (vrFolderInfo.has(id)) return vrFolderInfo.get(id);
  const info = { img: null, txt: '' };
  vrFolderInfo.set(id, info);
  folderPreview(id, f.name).then(async (pv) => {
    info.txt = folderCountText(pv);
    const src = await folderImageUrl(pv);
    if (src && src.startsWith('blob:')) {
      const img = new Image();
      img.ok = false;
      img.onload = () => { img.ok = true; ui?.redraw(); };
      img.src = src;
      info.img = img;
    } else if (pv.v) info.img = vrThumb(pv.v);
    ui?.redraw();
  }).catch(() => vrFolderInfo.delete(id));
  return info;
}

// превью для VR-библиотеки: только свои (same-origin), иначе canvas станет «грязным» для WebGL
const vrThumbs = new Map();
function vrThumb(f) {
  if (vrThumbs.has(f.id)) return vrThumbs.get(f.id);
  const img = new Image();
  img.crossOrigin = 'anonymous'; // превью с ПК рисуется в VR-панель — нужен CORS, иначе WebGL откажется
  img.ok = false;
  img.onload = () => { img.ok = true; ui?.redraw(); };
  img.src = ownThumbUrl(f);
  vrThumbs.set(f.id, img);
  return img;
}

function drawToast(p, text, warn) {
  const c = p.ctx;
  c.clearRect(0, 0, p.W, p.H);
  rr(c, 4, 4, p.W - 8, p.H - 8, 20);
  c.fillStyle = C.bg; c.fill();
  c.strokeStyle = warn ? 'rgba(255,216,150,0.5)' : C.line; c.lineWidth = 3; c.stroke();
  c.fillStyle = warn ? C.warn : C.text; c.font = `600 40px ${FONT}`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(ellipsize(c, text, p.W - 80), p.W / 2, p.H / 2 + 1);
  p.end();
}

class VRUI {
  constructor(parent) {
    this.main = new CanvasPanel(TICKET.W, TICKET.H, 1.45);   // лента-«билет» под экраном
    this.main.draw = () => drawMain(this.main);
    this.main.mesh.position.set(0, -0.48, -1.15);
    this.main.mesh.rotation.x = -0.42;
    this.settings = new CanvasPanel(1600, 1180, 1.2);
    this.settings.draw = () => drawSettings(this.settings);
    this.library = new CanvasPanel(1600, 1180, 1.2);
    this.library.draw = () => drawLibrary(this.library);
    this.pairPanel = new CanvasPanel(1600, 1180, 1.2);
    this.pairPanel.draw = () => drawPair(this.pairPanel);
    this.pair = { mode: 'pin', pin: '', ip: '' };
    for (const s of [this.settings, this.library, this.pairPanel]) {
      s.mesh.position.set(0, 0.16, -1.4);
      s.mesh.rotation.x = -0.1;
    }
    this.toast = new CanvasPanel(1100, 130, 0.62);
    this.toast.mesh.position.set(0, -0.2, -1.2);
    this.toast.mesh.renderOrder = 1002;
    // все панели — в одной группе: при появлении меню она поворачивается туда, куда смотрит зритель
    this.root = new THREE.Group();
    this.root.add(this.main.mesh, this.settings.mesh, this.library.mesh, this.pairPanel.mesh, this.toast.mesh);
    parent.add(this.root);
    this.visible = false;
    this.sheet = null; // 'settings' | 'library' | null
    this.tab = 'video';
    this.libPage = 0;
    this.toastUntil = 0;
    this.lastActivity = now();
    this.setVisible(false);
    this.toast.mesh.visible = false;
  }
  get settingsOpen() { return this.sheet === 'settings'; }
  // Меню появляется перед глазами (как в PLAY'A): если зритель отвернулся больше чем на ~35°,
  // панели переезжают в направление взгляда. Мелкие повороты головы меню не двигают.
  faceUser() {
    if (!renderer?.xr?.isPresenting) return;
    const q = new THREE.Quaternion();
    renderer.xr.getCamera().getWorldQuaternion(q);
    const wq = world.getWorldQuaternion(new THREE.Quaternion()).invert();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).applyQuaternion(wq);
    if (Math.hypot(dir.x, dir.z) < 0.2) return;            // смотрит прямо вверх/вниз — не крутим
    const yaw = Math.atan2(-dir.x, -dir.z);
    let d = yaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 0.6) this.root.rotation.y = yaw;
    this.root.position.set(headLocal.x, 0, headLocal.z);
  }
  resetPlacement() { this.root.rotation.set(0, 0, 0); this.root.position.set(0, 0, 0); }
  setVisible(v) {
    if (v && !this.visible) this.faceUser();
    this.visible = v;
    this.main.mesh.visible = v;
    this.settings.mesh.visible = v && this.sheet === 'settings';
    this.library.mesh.visible = v && this.sheet === 'library';
    this.pairPanel.mesh.visible = v && this.sheet === 'pair';
    if (v) { this.lastActivity = now(); this.redraw(); }
  }
  toggle() { this.setVisible(!this.visible); }
  openSheet(name, open) {
    const want = open ?? this.sheet !== name;
    if (want) this.sheet = name;
    else if (this.sheet === name) this.sheet = null;
    this.setVisible(this.visible || !!this.sheet);
  }
  openSettings(open) { this.openSheet('settings', open); }
  openLibrary(open) {
    if ((open ?? this.sheet !== 'library') && current) {
      const list = nav.items.filter((f) => (f.shortcutDetails?.targetMimeType || f.mimeType) === FOLDER || isVideoFile(f));
      const i = list.findIndex((f) => f.id === current.id);
      if (i >= 0) this.libPage = Math.floor(i / LIB_PER);
    }
    this.openSheet('library', open);
  }
  interactive() { return [this.main, this.settings, this.library, this.pairPanel]; }
  panels() { return this.interactive().filter((p) => p.mesh.visible); }
  redraw() { for (const p of this.panels()) p.draw(); }
  toastMsg(text, warn = false, ms) {
    if (!renderer?.xr?.isPresenting) return;
    const key = text + '|' + warn;
    if (!(this.toast.mesh.visible && this.toastKey === key)) drawToast(this.toast, text, warn);   // без лишней перезаливки текстуры
    this.toastKey = key;
    this.toast.mesh.visible = true;
    this.toastUntil = now() + (ms || (warn ? 5000 : 1300));
  }
  tick(t, hovering) {
    if (this.toast.mesh.visible && t > this.toastUntil) this.toast.mesh.visible = false;
    if (hovering) this.lastActivity = t;
    if (this.visible && !video.paused && !this.sheet && t - this.lastActivity > 6000) {
      this.setVisible(false); // автоскрытие во время просмотра
    } else if (this.visible && t - this.main.lastDraw > 250) {
      // перерисовываем (и заново отправляем текстуру в GPU) только если что-то изменилось:
      // постоянная перезаливка больших canvas-текстур давала рывки кадров
      const dur = video.duration || 0;
      const buf = video.buffered.length ? Math.round(video.buffered.end(video.buffered.length - 1)) : 0;
      const mk = [Math.floor(video.currentTime), video.paused, buf, video.videoWidth, !!mediaLayer].join('|');
      if (mk !== this.mainKey) { this.mainKey = mk; this.main.draw(); } else this.main.lastDraw = t;
      if (this.settings.mesh.visible) {
        const sk = [video.volume.toFixed(2), state.zoom.toFixed(2), state.height, prefs.speed, dur > 0].join('|');
        if (sk !== this.settingsKey) { this.settingsKey = sk; this.settings.draw(); }
      }
    }
  }
}

// ───────────────────────── ввод: лучи, курок, стики ─────────────────────────
const raycaster = new THREE.Raycaster();
let lastInput = 0;            // время последнего нажатия/движения стиков
const RAY_TIMEOUT = 15000;
const raysOn = () => ui.visible && now() - lastInput < RAY_TIMEOUT;
const tmpM = new THREE.Matrix4();

function pulse(c, intensity = 0.25, ms = 18) {
  try { c.userData.source?.gamepad?.hapticActuators?.[0]?.pulse(intensity, ms); } catch { /* ignore */ }
}

function onSelectStart(c) {
  const h = c.userData.hit;
  const wasOn = raysOn();
  lastInput = now();
  ui.lastActivity = now();
  if (!wasOn) { ui.setVisible(true); return; }   // первый курок только показывает панель и лучи
  if (ui.visible && h) {
    if (h.region) {
      h.region.onPress(h.fx);
      if (h.region.drag) c.userData.drag = { panel: h.panel, region: h.region };
      pulse(c, 0.5, 30);
      ui.redraw();
    }
  } else {
    ui.toggle();
  }
}

function updatePointers() {
  let hovering = false;
  const hovers = new Map();
  for (const c of controllers) {
    const ud = c.userData;
    ud.hit = null;
    let len = 4;
    const on = raysOn();
    ud.ray.visible = on;
    if (c.visible && on) {
      tmpM.identity().extractRotation(c.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
      const hit = raycaster.intersectObjects(ui.panels().map((p) => p.mesh), false)[0];
      if (hit) {
        len = hit.distance;
        const p = hit.object.userData.panel;
        ud.hit = p.hitAt(hit.uv);
        ud.uv = hit.uv;
        hovering = true;
        if (ud.hit.region) hovers.set(p, ud.hit.region.id);
        ud.dot.visible = true;
        ud.dot.position.copy(hit.point);
        ud.dot.quaternion.copy(hit.object.getWorldQuaternion(new THREE.Quaternion()));
        if (ud.drag && ud.drag.panel === p) ud.drag.region.onPress(p.fxFor(ud.drag.region, hit.uv));
      } else ud.dot.visible = false;
    } else ud.dot.visible = false;
    const hid = ud.hit?.region?.id || null;
    if (hid && hid !== ud.hoverId) pulse(c, 0.15, 12);
    ud.hoverId = hid;
    ud.ray.scale.z = len;
  }
  for (const p of ui.interactive()) {
    const hv = hovers.get(p) || null;
    if (hv !== p.hover) { p.hover = hv; if (p.mesh.visible) p.draw(); }
  }
  return hovering;
}

const prevButtons = {};
let seekHold = 0;
let zoomHold = 0, zoomMoved = false;
const controllerFor = (src) => controllers.find((c) => c.userData.source === src) || controllers[0];
function handleGamepads(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const hand = src.handedness;
    const prev = prevButtons[hand] || [];
    const pressed = (i) => gp.buttons[i]?.pressed && !prev[i];
    const ax = gp.axes[2] ?? 0, ay = gp.axes[3] ?? 0;
    if (hand === 'right') {
      // стик отпущен: сбрасываем «паузу на нуле» и запоминаем зум для этого видео
      if (!(Math.abs(ax) > 0.15 && Math.abs(ax) >= Math.abs(ay))) {
        zoomHold = 0;
        if (zoomMoved) { zoomMoved = false; saveFormat(); }
      }
      // правый стик влево/вправо — зум
      if (Math.abs(ax) > 0.15 && Math.abs(ax) >= Math.abs(ay)) {
        // вправо — приблизить, влево — отдалить; скорость плавно растёт с отклонением стика
        const step = Math.sign(ax) * ((Math.abs(ax) - 0.15) / 0.85) * dt * 0.9;
        let z = state.zoom + step;
        if (state.zoom !== 0 && Math.sign(z) !== Math.sign(state.zoom)) {
          z = 0; zoomHold = 0.35;                 // проходя обычный размер, на миг останавливаемся на 0
          pulse(controllerFor(src), 0.4, 25);
        } else if (state.zoom === 0 && zoomHold > 0) {
          zoomHold -= dt; z = 0;                  // держите стик дальше — зум продолжит меняться
        }
        if (z !== state.zoom) { setZoom(z, false); zoomMoved = true; }
      } else if (Math.abs(ay) > 0.2) {
        tilt = clamp(tilt + ay * dt * 0.9, -1.3, 1.3); // вверх/вниз — наклон камеры
        applyWorldRotation();
      }
      if (pressed(4)) togglePlay();                       // A
      if (pressed(5)) ui.toggle();                        // B
      if (pressed(3)) { setZoom(prefs.zoom); tilt = 0; applyWorldRotation(); } // нажатие правого стика
      if (prev[0] === undefined) { /* first frame */ }
    } else if (hand === 'left') {
      // левый стик: ↔ перемотка, ↕ громкость
      if (Math.abs(ax) > 0.7 && Math.abs(ax) > Math.abs(ay)) {
        seekHold -= dt;
        if (seekHold <= 0) {
          seekBy(ax > 0 ? seekStep() : -seekStep());
          ui.toastMsg((ax > 0 ? '+' : '−') + seekStep() + ' с  →  ' + fmtTime(video.currentTime));
          seekHold = 0.35;
        }
      } else seekHold = 0;
      if (Math.abs(ay) > 0.3 && Math.abs(ay) > Math.abs(ax)) {
        setVolume(video.volume - ay * dt * 0.6);
        ui.toastMsg('Громкость ' + Math.round(video.volume * 100) + '%');
      }
      if (pressed(4)) ui.openSettings();                  // X — настройки
      if (pressed(5)) togglePlay();                       // Y
      if (pressed(3)) recenter(); // нажатие левого стика
    }
    if (gp.buttons.some((b, i) => b.pressed && !prev[i])) { ui.lastActivity = now(); lastInput = now(); }
    if (Math.abs(ax) > 0.3 || Math.abs(ay) > 0.3) lastInput = now();
    prevButtons[hand] = gp.buttons.map((b) => b.pressed);
  }
}

const clock = new THREE.Clock();
function renderFrame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (renderer.xr.isPresenting) {
    if (recenterFrames > 0 && --recenterFrames === 0) recenter();
    handleGamepads(dt);
    followHead();
    const hovering = updatePointers();
    ui.tick(now(), hovering);
  } else {
    if (nativeOn) return;               // видео показывает сам браузер — 3D-сцену не рисуем
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  renderer.render(scene, camera);
}

// ───────────────────────── воспроизведение ─────────────────────────
async function playFile(f) {
  const here = nav.items.filter(isVideoFile);
  if (here.some((x) => x.id === f.id)) playQueue = here;   // запомнили папку, из которой смотрим
  await ensureSW();
  await getToken();
  await sendAuthToSW();
  current = f;
  const fmt = fileFormat(f);
  if (!LS.get('liquido.fmt.' + f.id, null) && !fmt.marked && !fmt.guessed) {
    stageMsg('Определяю формат видео…');
    ui?.toastMsg('Определяю формат видео…');
    const meta = await probeFormat(f);
    if (meta.projection) fmt.projection = meta.projection;
    if (meta.stereo) fmt.stereo = meta.stereo;
  }
  Object.assign(state, { projection: fmt.projection, stereo: fmt.stereo, swap: fmt.swap, zoom: fmt.zoom ?? prefs.zoom, height: fmt.height || 0, view: fmt.view || '3d', fisheyeFov: fmt.fisheyeFov || null });
  showPlayer();
  $('#nowTitle').textContent = f.name;
  currentSrc = 'stream/' + encodeURIComponent(f.id) + '?size=' + (f.size || 0) + '&mime=' + encodeURIComponent(guessMime(f));
  startVideo(currentSrc, LS.get('liquido.pos.' + f.id, 0));
}

function startVideo(src, resumeAt) {
  initScene();
  stageMsg('Загрузка потока…');
  video.volume = prefs.volume;
  layerRetries = 0;
  video.src = src;
  video.defaultPlaybackRate = prefs.speed || 1;
  video.playbackRate = prefs.speed || 1;
  video.load();
  video.dataset.resume = resumeAt || 0;
  rebuildMedia();
  syncControls();
  renderer.setAnimationLoop(renderFrame);
  // старт — после предзагрузки (см. loadedmetadata → prebufferThenPlay)
}

function savePosition() {
  if (!current || !isFinite(video.duration) || String(current.id).startsWith('demo:')) return;
  const t = video.currentTime;
  if (t > 10 && t < video.duration - 15) {
    LS.set('liquido.pos.' + current.id, t);
    // для героя «Продолжить»: что смотрели последним (позиция — в liquido.pos.<id>)
    const { id, name, size, mimeType, thumbnailLink, videoMediaMetadata } = current;
    LS.set('liquido.last', { f: { id, name, size, mimeType, thumbnailLink, videoMediaMetadata } });
  } else LS.del('liquido.pos.' + current.id);
  saveFormat();
}

video.addEventListener('loadedmetadata', () => {
  if (videoTex) videoTex.dispose();
  videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.minFilter = THREE.LinearFilter;
  videoTex.magFilter = THREE.LinearFilter;
  videoTex.generateMipmaps = false;
  mipOn = null;
  rebuildMedia();
  const r = Number(video.dataset.resume) || 0;
  if (r > 0 && r < video.duration - 5) {
    video.currentTime = r;
    stageMsg('Продолжаем с ' + fmtTime(r));
    ui?.toastMsg('Продолжаем с ' + fmtTime(r), false, 2500);
  } else stageMsg('');
  video.dataset.resume = 0;
  prebufferThenPlay(15, 20000);        // накопить ~15 с видео перед стартом
  setTimeout(() => { if (!video.paused) stageMsg(''); }, 2500);
});
// «Загрузка…» в шлеме: без неё в VR видео просто замирает. Короткие паузы (<0,7 с) не показываем.
let bufTimer = 0, bufShown = false;
function bufferingOn() {
  stageMsg('Буферизация…');
  clearTimeout(bufTimer);
  bufTimer = setTimeout(() => {
    if (video.paused || video.readyState >= 3) return;
    bufShown = true;
    // без надписи в шлеме (по просьбе) — только на странице ПК
  }, 700);
}
function bufferingOff() {
  clearTimeout(bufTimer);
  stageMsg('');
  if (bufShown && ui) { ui.toast.mesh.visible = false; ui.toastUntil = 0; }
  bufShown = false;
}
video.addEventListener('waiting', bufferingOn);
video.addEventListener('seeking', () => {
  if (!video.paused || pbActive) { seekWasPlaying = true; if (!video.paused) bufferingOn(); }
});
video.addEventListener('seeked', () => {
  if (seekWasPlaying) { seekWasPlaying = false; prebufferThenPlay(8, 12000); }   // после перемотки — ~8 с запаса
});

// ── Предзагрузка: перед стартом и после перемотки ждём, пока в буфере наберётся запас видео,
// и только потом запускаем. Иначе на неровном интернете кадры не успевают приходить — рывки и мигание.
let pbToken = 0, pbActive = false, seekWasPlaying = false;
function bufferedAhead() {
  const t = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= t + 0.3 && video.buffered.end(i) > t) return video.buffered.end(i) - t;
  }
  return 0;
}
async function prebufferThenPlay(targetSec, maxWaitMs) {
  const my = ++pbToken;
  pbActive = true;
  if (!video.paused) video.pause();
  const t0 = now();
  while (my === pbToken) {
    const left = isFinite(video.duration) ? video.duration - video.currentTime - 0.5 : Infinity;
    if (video.readyState >= 3 && bufferedAhead() >= Math.min(targetSec, left)) break;
    if (now() - t0 > maxWaitMs) break;               // медленная сеть — не ждём бесконечно
    await new Promise((r) => setTimeout(r, 150));
  }
  if (my !== pbToken) return;                         // пользователь нажал паузу/пуск сам
  pbActive = false;
  video.play().catch(() => stageMsg('Нажмите ▶ для запуска'));
}
for (const ev of ['playing', 'canplay', 'pause', 'emptied', 'ended']) video.addEventListener(ev, bufferingOff);
video.addEventListener('play', syncControls);
video.addEventListener('pause', () => { syncControls(); savePosition(); });
video.addEventListener('timeupdate', () => {
  syncTime();
  if (now() - lastPosSave > 5000) { lastPosSave = now(); savePosition(); }
});
video.addEventListener('ended', () => {
  if (current) LS.del('liquido.pos.' + current.id);
  const list = playlist();
  const i = list.findIndex((f) => f.id === current?.id);
  const mode = prefs.endMode || 'next';
  if (mode === 'repeat') {                       // повторить это видео
    video.currentTime = 0;
    video.play().catch(() => {});
    ui?.toastMsg('Повтор', false, 1500);
  } else if (mode === 'shuffle' && list.length > 1) {   // случайное другое видео из этой папки
    let j = Math.floor(Math.random() * (list.length - 1));
    if (j >= i && i >= 0) j++;
    ui?.toastMsg('Случайное: ' + list[j].name, false, 2500);
    playFile(list[j]).catch((e) => { banner(e.message); ui?.toastMsg(e.message, true); });
  } else if (mode === 'next' && i >= 0 && list[i + 1]) {
    ui?.toastMsg('Следующее: ' + list[i + 1].name, false, 2500);
    playSibling(1);
  } else ui?.setVisible(true);
});
video.addEventListener('error', () => {
  if (!video.getAttribute('src')) return;
  const code = video.error?.code;
  const text = code === 4
    ? 'Браузер не смог открыть видео: неподдерживаемый формат/кодек или нет доступа к файлу.\nQuest Browser обычно играет MP4/MKV/WebM с H.264, H.265 (HEVC), VP9, AV1.'
    : code === 2 ? 'Сетевая ошибка при загрузке потока.' : 'Ошибка воспроизведения (код ' + code + ').';
  stageMsg(text);
  ui?.toastMsg(text.split('\n')[0], true);
});

// ───────────────────────── 2D-интерфейс ─────────────────────────
function showPlayer() {
  $('#viewBrowser').hidden = true;
  $('#viewPlayer').hidden = false;
  window.scrollTo(0, 0);
}
function showBrowser() {
  if (renderer?.xr?.isPresenting) renderer.xr.getSession().end();
  savePosition();
  video.pause();
  if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
  renderer?.setAnimationLoop(null);
  current = null;
  updateNativeMode();
  $('#viewPlayer').hidden = true;
  $('#viewBrowser').hidden = false;
  stageMsg('');
  renderHero();
}

function paintRange(el) {
  const min = Number(el.min) || 0, max = Number(el.max) || 100;
  el.style.setProperty('--fill', ((el.value - min) / (max - min)) * 100 + '%');
}

function buildSegmented(el, options, onPick) {
  el.replaceChildren();
  for (const [k, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.k = k;
    b.textContent = label;
    b.onclick = () => onPick(k);
    el.append(b);
  }
}
function setSegmented(el, value) { el.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === value)); }

let seeking = false;
function syncTime() {
  $('#cTimeCur').textContent = fmtTime(video.currentTime);
  $('#cTime').textContent = fmtTime(video.duration);
  if (!seeking && isFinite(video.duration) && video.duration > 0) {
    $('#cSeek').value = Math.round((video.currentTime / video.duration) * 1000);
    paintRange($('#cSeek'));
  }
}
function syncZoomUI() {
  $('#cZoom').value = Math.round(state.zoom * 100);
  $('#cZoomVal').textContent = fmtZoom(state.zoom);
  paintRange($('#cZoom'));
}
function syncControls() {
  $('#cPlay').innerHTML = video.paused ? ICONS.play : ICONS.pause;
  setSegmented($('#segProj'), state.projection);
  setSegmented($('#segStereo'), state.stereo);
  setSegmented($('#segQuality'), prefs.quality);
  $('#nowFmt').textContent = 'Сеанс · ' + formatLine(state, current?.videoMediaMetadata || { width: video.videoWidth });
  $('#cSwap').checked = state.swap;
  $('#cVol').value = Math.round(video.volume * 100);
  paintRange($('#cVol'));
  syncZoomUI();
  syncTime();
  ui?.redraw();
}

function syncPrefsUI() {
  setSegmented($('#prefProj'), prefs.projection);
  setSegmented($('#prefStereo'), prefs.stereo);
  setSegmented($('#prefQuality'), prefs.quality);
  $('#prefZoom').value = Math.round(prefs.zoom * 100);
  $('#prefZoomVal').textContent = fmtZoom(prefs.zoom);
  paintRange($('#prefZoom'));
  $('#prefSwap').checked = prefs.swap;
  $('#prefAutoVR').checked = prefs.autoVR;
}

function enterVR() {
  if (!xrSupported) {
    banner('VR доступен в браузере Meta Quest (адрес http://localhost:8080).');
    return Promise.resolve(false);
  }
  initScene();
  if (renderer.xr.isPresenting) return Promise.resolve(true);
  // В чётком режиме (XR-слой) видео выводит сам шлем, а WebGL рисует только интерфейс.
  // Огромный буфер ×1.5 при этом только нагружает GPU: пропуски кадров → рывки и «двоение» (репроекция).
  const q = QUALITY[prefs.quality].scale;
  // меньше нагрузка на GPU шлема: пропущенные кадры дают мигание. Видео в XR-слое от этого не теряет чёткость.
  renderer.xr.setFramebufferScaleFactor(prefs.layers !== false ? 1.0 : Math.min(q, 1.2));
  // requestSession вызывается синхронно внутри жеста пользователя
  return navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'layers'] })
    .then(async (session) => {
      await renderer.xr.setSession(session);
      renderer.setAnimationLoop(renderFrame);
      return true;
    })
    .catch((e) => { banner('Не удалось войти в VR: ' + e.message); return false; });
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#btnInstall').hidden = false;
});
window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; });

function bindUI() {
  $('#btnLogin').onclick = async () => { if (await checkAccount()) openSource('root'); };
  $('#btnInstall').onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('#btnInstall').hidden = true;
  };
  $$('.tabs button').forEach((b) => { b.onclick = () => openSource(b.dataset.src); });
  $('#linkForm').onsubmit = (e) => { e.preventDefault(); openLink($('#linkInput').value); };
  $('#searchForm').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) return;
    if (/drive\.google\.com|docs\.google\.com/.test(q)) { openLink(q); return; }  // вставили ссылку Диска
    setActiveTab(null);
    nav.source = 'search'; nav.query = q; nav.stack = [];
    loadList(true);
  };
  $('#showAll').onchange = () => loadList(true);
  $('#btnMore').onclick = () => loadList(false);
  $('#btnBack').onclick = showBrowser;
  $('#btnFull').onclick = toggleFullscreen;
  $('#cFull').onclick = toggleFullscreen;
  $('#cMute').onclick = () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) setVolume(0.5); };
  $('#cVolT').oninput = (e) => { video.muted = false; setVolume(e.target.value / 100); };
  $('#stage').addEventListener('mousemove', wakeControls);
  syncFullBtn(); syncMute();
  $('#btnVR').onclick = () => { if (renderer?.xr?.isPresenting) renderer.xr.getSession().end(); else enterVR(); };
  $('#cPlay').onclick = togglePlay;
  $('#cBack').onclick = () => seekBy(-seekStep());
  $('#cFwd').onclick = () => seekBy(seekStep());
  $('#cCenter').onclick = recenter;
  $('#cSeek').addEventListener('input', (e) => { seeking = true; paintRange(e.target); });
  $('#cSeek').addEventListener('change', () => {
    seeking = false;
    if (isFinite(video.duration)) video.currentTime = ($('#cSeek').value / 1000) * video.duration;
  });
  buildSegmented($('#segProj'), PROJ.map((k) => [k, PROJ_NAME[k]]), (k) => setFormat({ projection: k }));
  buildSegmented($('#segStereo'), STEREO.map((k) => [k, STEREO_NAME[k]]), (k) => setFormat({ stereo: k }));
  buildSegmented($('#segQuality'), QUALITY_KEYS.map((k) => [k, QUALITY[k].name]), (k) => {
    prefs.quality = k; savePrefs(); syncPrefsUI(); syncControls(); rebuildMedia();
  });
  $('#cSwap').onchange = (e) => setFormat({ swap: e.target.checked });
  $('#cZoom').oninput = (e) => { setZoom(e.target.value / 100); saveFormat(); };
  $('#cVol').oninput = (e) => setVolume(e.target.value / 100);

  // диалог настроек
  buildSegmented($('#prefProj'), PROJ.map((k) => [k, PROJ_NAME[k]]), (k) => { prefs.projection = k; savePrefs(); syncPrefsUI(); });
  buildSegmented($('#prefStereo'), STEREO.map((k) => [k, STEREO_LONG[k]]), (k) => { prefs.stereo = k; savePrefs(); syncPrefsUI(); });
  buildSegmented($('#prefQuality'), QUALITY_KEYS.map((k) => [k, QUALITY[k].name]), (k) => { prefs.quality = k; savePrefs(); syncPrefsUI(); rebuildMedia(); });
  $('#prefZoom').oninput = (e) => { prefs.zoom = e.target.value / 100; savePrefs(); syncPrefsUI(); };
  $('#prefSwap').onchange = (e) => { prefs.swap = e.target.checked; savePrefs(); };
  $('#prefAutoVR').onchange = (e) => { prefs.autoVR = e.target.checked; savePrefs(); };
  $('#btnPrefs').onclick = () => { syncPrefsUI(); $('#dlgPrefs').showModal(); };
  $('#dlgPrefs').addEventListener('close', () => {
    if ($('#dlgPrefs').returnValue === 'reset') { prefs = { ...DEFAULT_PREFS }; savePrefs(); syncPrefsUI(); }
    if (!$('#viewBrowser').hidden && account) loadList(true); // обновить метки форматов
  });

  document.addEventListener('keydown', (e) => {
    if ($('#viewPlayer').hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    // горячие клавиши как в PLAY'A
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'KeyF') { e.preventDefault(); toggleFullscreen(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); seekBy(-seekStep()); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); seekBy(seekStep()); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); setVolume(video.volume + 0.05); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); setVolume(video.volume - 0.05); }
    else if (e.code === 'KeyM') video.muted = !video.muted;
    else if (e.code === 'PageDown') playSibling(1);
    else if (e.code === 'PageUp') playSibling(-1);
    else if (e.code === 'KeyR' && e.shiftKey) recenter();
    else if (e.code === 'KeyA') setZoom(state.zoom - 0.05);
    else if (e.code === 'KeyD') setZoom(state.zoom + 0.05);
  });
  window.addEventListener('beforeunload', savePosition);
  // в приложении на Quest «выход» кнопкой Meta не всегда даёт beforeunload — сохраняем при сворачивании
  window.addEventListener('pagehide', savePosition);
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });
  $$('input[type=range]').forEach(paintRange);
}

async function init() {
  bindUI();
  updateAuthUI();
  syncPrefsUI();
  renderHero();
  // отладка на ПК: ?debug — доступ к VR-панелям из консоли (отрисовка без шлема)
  if (new URLSearchParams(location.search).has('debug')) {
    window.__liquido = { get ui() { return ui; }, state, setFormat, setZoom, initScene, fontsReady, coverUrl, folderPreview, get scene() { return scene; } };
  }
  if (!window.isSecureContext) {
    banner('Откройте плеер по адресу http://localhost:8080 или через приложение LiquidoVR. По IP-адресу VR и поток работать не будут.');
  }
  try {
    xrSupported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr');
  } catch { xrSupported = false; }
  renderHero();
  // В приложении LiquidoVR (Quest) сразу входим в VR и открываем библиотеку:
  // запуск по иконке считается действием пользователя для requestSession.
  if (IS_APP && xrSupported && !new URLSearchParams(location.search).get('demo')) {
    enterVR().then((ok) => { if (ok && !ui.sheet) ui.openLibrary(true); });
  }
  if (!xrSupported) $('#btnVR').title = 'VR доступен в браузере Meta Quest';

  if ('serviceWorker' in navigator && window.isSecureContext) {
    try { swReg = await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW:', e.message); }
  }

  // Отладка без Google: ?demo=<url видео> — проигрывает файл напрямую
  const demo = new URLSearchParams(location.search).get('demo');
  if (demo) {
    current = { id: 'demo:' + demo, name: decodeURIComponent(demo.split('/').pop()) };
    Object.assign(state, detectFormat(current.name), { zoom: prefs.zoom });
    showPlayer();
    $('#nowTitle').textContent = current.name + ' (демо)';
    currentSrc = demo;
    startVideo(demo, 0);
    window.__liquido = { ui, state, setFormat, setZoom, setPitch: (v) => { pitch = v; } }; // отладка
    return;
  }

  if (await checkAccount()) openSource('root');
  else loadList(true);
}

init();
