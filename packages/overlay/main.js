// REDnode overlay host. See docs/overlay.md and README.md.
//
// Finds overlay apps (folders with a rednode-app.json manifest), renders each
// open app off-screen with Chromium, and streams its frames to the REDnode
// plugin in the game over a named pipe. The plugin owns window placement,
// focus and dragging; the host replays the plugin's input into the right page.
// Apps call the game through window.rednode (preload.js).
//
// Developers:
//   npm run overlay                          # off-screen, streams to the game
//   npm run overlay -- --window              # normal desktop windows, without the game
//   npm run overlay -- --apps=demo,signal    # open exactly these apps this time
// Players: the plugin starts the packaged host with the game:
//   REDnode-overlay.exe --apps-dir=<plugin>\apps --parent-pid=<game> --log=<file>

'use strict';

const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// REDNODE_OVERLAY_PIPE lets tests use a private pipe instead of the game's.
const PIPE = process.env.REDNODE_OVERLAY_PIPE || '\\\\.\\pipe\\rednode-overlay';
const FPS = 60;
const TYPE_FRAME = 1;
const TYPE_JSON = 2;
const TYPE_RECT = 4; // only the changed part of a window
const TYPE_SHARED = 5; // a GPU texture handle instead of pixels
const VERSION = require('./package.json').version;

// ---------- command line ----------

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const windowed = process.argv.includes('--window');
const chosenApps = arg('apps')?.split(',').filter(Boolean) ?? null;
const parentPid = Number(arg('parent-pid')) || null;
const logFile = arg('log') ?? null;
// Render path: 'gpu' shares Chromium's textures with the game, 'cpu' copies pixels.
// --render overrides the setting saved by the launcher.
const renderArg = arg('render');

// Where apps are found: the launcher built into the host, then the apps folder.
// Packaged, the plugin passes the game's apps folder; in the repo it is ./apps.
const APP_ROOTS = [
  { dir: path.join(__dirname, 'launcher'), single: true, builtin: true },
  { dir: arg('apps-dir') ?? path.join(__dirname, 'apps') },
];
// The UI kit, served to every app as rednode://ui/rednode-ui.js.
const UI_DIR = app.isPackaged ? path.join(__dirname, 'ui') : path.join(__dirname, '..', 'ui', 'src');

// ---------- logging ----------

function log(...args) {
  const line = `${new Date().toISOString().slice(11, 19)} ${args.join(' ')}`;
  console.log(line);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${line}\n`);
    } catch {
      // the log is best effort
    }
  }
}

// ---------- one host at a time ----------

if (!app.requestSingleInstanceLock()) {
  log('Another REDnode overlay host is already running. Exiting.');
  app.exit(0);
  return; // CommonJS allows a top-level return: nothing below runs
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'rednode', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
// Page pixels must match frame pixels, whatever the desktop scaling is.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// ---------- state ----------

let socket = null;
let connected = false;
let mode = 'passive';
let writable = true;
// window id -> { image, dirty } waiting for the pipe: the newest image and the
// union of every area that changed since the last send.
const pendingFrames = new Map();
let frames = 0;
let bytes = 0;

const pending = new Map(); // request id -> { resolve, reject, timer }
let nextRequestId = 1;

/** Installed apps by id: { manifest, dir, builtin } */
const apps = new Map();
/** Open windows by window id: { id, app, win, dragRegions } */
const windows = new Map();
/** Frames sent per window since the last perf report. */
const windowStats = new Map();
let nextWindowId = 1;

// ---------- settings and saved positions (in the host's user data folder) ----------

const dataFile = (name) => path.join(app.getPath('userData'), name);
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8'));
  } catch {
    return fallback;
  }
}
const writers = new Map();
function writeJson(name, value) {
  clearTimeout(writers.get(name));
  writers.set(
    name,
    setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(dataFile(name)), { recursive: true });
        fs.writeFileSync(dataFile(name), JSON.stringify(value, null, 2));
      } catch (err) {
        log(`Could not save ${name}: ${err.message}`);
      }
    }, 300),
  );
}
let positions = {};
let settings = { apps: {} }; // apps: { [id]: { open: boolean } }, renderPath: 'gpu' | 'cpu'
let renderPath = 'gpu';

// GPU-shared frames the game has not finished with yet: frame id -> { texture, windowId, at }.
const sharedFrames = new Map();
let nextFrameId = 1;

// ---------- app discovery ----------

const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
// Game states a window can hide with (manifest hideWith). The plugin reads them from the game.
const HIDE_WITH = ['menu', 'photo-mode', 'scene', 'main-menu'];

function readManifest(dir) {
  const file = path.join(dir, 'rednode-app.json');
  if (!fs.existsSync(file)) return null;
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`);
  }
  const problems = [];
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(m.id)) problems.push('id must be lowercase letters, digits, - or _');
  if (typeof m.entry !== 'string' || !fs.existsSync(path.join(dir, m.entry))) problems.push(`entry "${m.entry}" not found`);
  for (const k of ['width', 'height']) {
    if (!Number.isInteger(m[k]) || m[k] < 1 || m[k] > 4096) problems.push(`${k} must be a whole number from 1 to 4096`);
  }
  if (m.anchor !== undefined && !ANCHORS.includes(m.anchor)) problems.push(`anchor must be one of ${ANCHORS.join(', ')}`);
  if (m.kind !== undefined && !['window', 'hud'].includes(m.kind)) problems.push('kind must be window or hud');
  if (m.hideWith !== undefined && (!Array.isArray(m.hideWith) || m.hideWith.some((h) => !HIDE_WITH.includes(h)))) {
    problems.push(`hideWith must be a list of ${HIDE_WITH.join(', ')}`);
  }
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return {
    id: m.id,
    name: typeof m.name === 'string' ? m.name : m.id,
    version: typeof m.version === 'string' ? m.version : '',
    author: typeof m.author === 'string' ? m.author : '',
    description: typeof m.description === 'string' ? m.description : '',
    entry: m.entry,
    kind: m.kind ?? 'window',
    width: m.width,
    height: m.height,
    anchor: m.anchor ?? 'top-left',
    x: Number(m.x) || 0,
    y: Number(m.y) || 0,
    hideWith: m.hideWith ?? [],
    open: m.open !== false,
  };
}

function discoverApps() {
  apps.clear();
  for (const root of APP_ROOTS) {
    const dirs = root.single
      ? [root.dir]
      : fs.existsSync(root.dir)
        ? fs.readdirSync(root.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root.dir, d.name))
        : [];
    for (const dir of dirs) {
      try {
        const manifest = readManifest(dir);
        if (!manifest) continue;
        if (apps.has(manifest.id)) {
          log(`Skipped ${dir}: app id "${manifest.id}" is already used by ${apps.get(manifest.id).dir}`);
          continue;
        }
        apps.set(manifest.id, { manifest, dir, builtin: !!root.builtin });
      } catch (err) {
        log(`Skipped an app: ${err.message}`);
      }
    }
  }
  log(`Found ${apps.size} app(s): ${[...apps.keys()].join(', ')}`);
}

function shouldOpen(entry) {
  if (entry.builtin) return true;
  if (chosenApps) return chosenApps.includes(entry.manifest.id);
  return settings.apps[entry.manifest.id]?.open ?? entry.manifest.open;
}

// ---------- messages to pages ----------

function toPage(w, message) {
  if (!w.win.isDestroyed()) w.win.webContents.send('rednode:event', message);
}
function toAllPages(message) {
  for (const w of windows.values()) toPage(w, message);
}
function windowFor(webContents) {
  for (const w of windows.values()) if (w.win.webContents === webContents) return w;
  return null;
}
function windowOfApp(appId) {
  for (const w of windows.values()) if (w.app.manifest.id === appId) return w;
  return null;
}

// ---------- pipe ----------

function writeMessage(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(type, 0);
  header.writeUInt32LE(payload.length, 4);
  return socket.write(Buffer.concat([header, payload]));
}

function sendJson(object) {
  if (connected) writeMessage(TYPE_JSON, Buffer.from(JSON.stringify(object), 'utf8'));
}

function unionRect(a, b) {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

// Sends the changed part of a window's image. While the pipe is busy, changes
// are merged and only the newest image is kept.
function sendFrame(windowId, image, dirty) {
  if (!connected || !windows.has(windowId)) return;
  const size = image.getSize();
  const full = { x: 0, y: 0, width: size.width, height: size.height };
  const area = dirty && dirty.width > 0 && dirty.height > 0 ? dirty : full;
  if (!writable) {
    const queued = pendingFrames.get(windowId);
    pendingFrames.set(windowId, { image, dirty: unionRect(queued?.dirty, area) });
    return;
  }
  // Clip to the image, in whole pixels.
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const width = Math.min(size.width - x, Math.ceil(area.x + area.width) - x);
  const height = Math.min(size.height - y, Math.ceil(area.y + area.height) - y);
  if (width <= 0 || height <= 0) return;
  const isFull = width === size.width && height === size.height;
  const pixels = (isFull ? image : image.crop({ x, y, width, height })).toBitmap(); // BGRA, premultiplied
  const head = Buffer.alloc(28);
  [windowId, size.width, size.height, x, y, width, height].forEach((v, i) => head.writeUInt32LE(v, i * 4));
  writable = writeMessage(TYPE_RECT, Buffer.concat([head, pixels]));
  frames += 1;
  bytes += pixels.length;
  windowStats.get(windowId).frames += 1;
}

// Tells the plugin about a window. A saved position wins over the manifest's anchor.
function openInGame(w) {
  const m = w.app.manifest;
  const saved = positions[m.id];
  const place = saved ? { anchor: 'top-left', x: saved.x, y: saved.y } : { anchor: m.anchor, x: m.x, y: m.y };
  sendJson({
    cmd: 'window.open',
    window: w.id,
    ...place,
    width: m.width,
    height: m.height,
    kind: m.kind,
    hideWith: m.hideWith,
    draggable: m.kind !== 'hud',
  });
  sendJson({ cmd: 'window.drag', window: w.id, regions: w.dragRegions });
  w.win.webContents.invalidate(); // send a full frame now
}

function connect() {
  let buffer = Buffer.alloc(0);
  socket = net.connect(PIPE);

  socket.on('connect', () => {
    connected = true;
    writable = true;
    log('Connected to the game');
    sendJson({ cmd: 'host', pid: process.pid }); // lets the plugin open our texture handles
    for (const w of windows.values()) openInGame(w);
    toAllPages({ event: 'link', connected: true });
  });

  socket.on('drain', () => {
    writable = true;
    for (const [id, queued] of pendingFrames) {
      pendingFrames.delete(id);
      sendFrame(id, queued.image, queued.dirty);
      if (!writable) break;
    }
  });

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const type = buffer.readUInt32LE(0);
      const length = buffer.readUInt32LE(4);
      if (buffer.length < 8 + length) break;
      const payload = buffer.subarray(8, 8 + length);
      buffer = buffer.subarray(8 + length);
      if (type === TYPE_JSON) onGameMessage(JSON.parse(payload.toString('utf8')));
    }
  });

  socket.on('error', () => {}); // 'close' follows
  socket.on('close', () => {
    if (connected) {
      log('Disconnected from the game');
      toAllPages({ event: 'link', connected: false });
    }
    connected = false;
    pendingFrames.clear();
    releaseSharedFrames(() => true);
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Disconnected from the game'));
      pending.delete(id);
    }
    setTimeout(connect, 2000); // the game may not be running yet
  });
}

// ---------- messages from the game ----------

const KEYS = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Control', 18: 'Alt', 27: 'Escape', 32: 'Space',
  33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 46: 'Delete',
};
function keyName(vk) {
  if (KEYS[vk]) return KEYS[vk];
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
  return null;
}

function onInput(m) {
  const w = windows.get(m.window);
  if (!w || w.win.isDestroyed()) return;
  const wc = w.win.webContents;
  switch (m.type) {
    case 'mouseMove':
    case 'mouseLeave':
      wc.sendInputEvent({ type: m.type, x: m.x, y: m.y });
      break;
    case 'mouseDown':
    case 'mouseUp':
      wc.sendInputEvent({ type: m.type, x: m.x, y: m.y, button: m.button, clickCount: 1 });
      break;
    case 'mouseWheel':
      wc.sendInputEvent({ type: 'mouseWheel', x: m.x, y: m.y, deltaX: 0, deltaY: m.delta });
      break;
    case 'keyDown':
    case 'keyUp': {
      const keyCode = keyName(m.vk);
      if (keyCode) wc.sendInputEvent({ type: m.type, keyCode });
      break;
    }
    case 'char':
      wc.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(m.code) });
      break;
    default:
      break;
  }
}

function onFocus(windowId) {
  for (const w of windows.values()) {
    const focused = w.id === windowId;
    // Chromium only draws the text caret and :focus styles in a focused page.
    // focusOnWebView focuses the page without taking OS focus from the game.
    if (focused) w.win.focusOnWebView();
    else w.win.blurWebView();
    toPage(w, { event: 'focus', focused });
  }
}

function onGameMessage(m) {
  if (m.id !== undefined) {
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.result);
    return;
  }
  switch (m.event) {
    case 'input':
      onInput(m);
      return;
    case 'focus':
      onFocus(m.window);
      return;
    case 'moved': {
      const w = windows.get(m.window);
      if (w) {
        positions[w.app.manifest.id] = { x: m.x, y: m.y };
        writeJson('window-positions.json', positions);
      }
      return;
    }
    case 'perf': {
      const host = hostPerf();
      toAllPages({ event: 'perf', game: m, host });
      logPerf(m, host);
      return;
    }
    case 'frame-done':
      for (const fid of m.frames ?? []) {
        const f = sharedFrames.get(fid);
        if (f) {
          f.texture.release();
          sharedFrames.delete(fid);
        }
      }
      return;
    case 'shared-failed':
      log(`The game could not use GPU sharing (${m.error}). Switching to the CPU path.`);
      setRenderPath('cpu', false);
      return;
    case 'hello':
    case 'overlay':
      mode = m.mode;
      log(m.event === 'hello' ? `Game says hello (${m.plugin}), mode ${mode}` : `Mode ${mode}`);
      if (mode !== 'interactive') onFocus(0);
      break;
    default:
      break;
  }
  toAllPages(m);
}

// ---------- GPU sharing ----------

// Sends a GPU texture handle instead of pixels. The texture stays ours until
// the game answers frame-done, or a second has passed.
function sendShared(windowId, texture) {
  const info = texture.textureInfo;
  const handle = info.handle?.ntHandle;
  if (!connected || !windows.has(windowId) || !handle) {
    texture.release();
    return;
  }
  const frameId = nextFrameId++;
  sharedFrames.set(frameId, { texture, windowId, at: Date.now() });
  const msg = Buffer.alloc(24);
  msg.writeUInt32LE(windowId, 0);
  msg.writeUInt32LE(info.codedSize.width, 4);
  msg.writeUInt32LE(info.codedSize.height, 8);
  msg.writeUInt32LE(frameId, 12);
  msg.writeBigUInt64LE(handle.readBigUInt64LE(0), 16);
  writable = writeMessage(TYPE_SHARED, msg);
  frames += 1;
  windowStats.get(windowId).frames += 1;
}

function releaseSharedFrames(test) {
  let n = 0;
  for (const [fid, f] of sharedFrames) {
    if (!test(f)) continue;
    f.texture.release();
    sharedFrames.delete(fid);
    n += 1;
  }
  return n;
}

// Switches between GPU sharing and the CPU path by reopening every window.
function setRenderPath(path, save = true) {
  if (renderPath === path) return;
  renderPath = path;
  if (save) {
    settings.renderPath = path;
    writeJson('settings.json', settings);
  }
  log(`Render path: ${path}`);
  const open = [...windows.values()].map((w) => w.app);
  for (const entry of open) closeApp(entry.manifest.id);
  releaseSharedFrames(() => true);
  for (const entry of open) openApp(entry);
  notifyLauncher();
}

// ---------- what the host costs ----------

// Writes a perf line to the log every 5 seconds, so a test run can be compared
// afterwards without reading numbers off the screen.
let perfLogAt = 0;
function logPerf(game, host) {
  if (Date.now() - perfLogAt < 5000) return;
  perfLogAt = Date.now();
  const open = [...windows.values()].map((w) => w.app.manifest.id);
  log(
    `Perf ${host.renderPath}${open.includes('stress') ? ' +stress' : ''}: game ${game.fps.toFixed(0)} fps; ` +
      `overlay CPU ${game.cpuMs.toFixed(2)} ms (worst ${game.cpuMsMax.toFixed(2)}), ` +
      `GPU ${game.gpuMs.toFixed(2)} ms (worst ${game.gpuMsMax.toFixed(2)}); ` +
      `uploads ${game.uploadMBps.toFixed(1)} MB/s, shared ${(game.sharedPerSec ?? 0).toFixed(0)}/s; ` +
      `host ${host.memoryMB} MB in ${host.processes} processes, CPU ${host.cpuPercent}%, sent ${host.sentMBps.toFixed(1)} MB/s`,
  );
}

let lastPerfAt = Date.now();
function takeBytes() {
  const b = bytes;
  bytes = 0;
  return b;
}
function hostPerf() {
  const now = Date.now();
  const seconds = Math.max(0.001, (now - lastPerfAt) / 1000);
  lastPerfAt = now;
  const metrics = app.getAppMetrics();
  const perWindow = [...windows.values()].map((w) => ({
    id: w.app.manifest.id,
    fps: Math.round((windowStats.get(w.id)?.frames ?? 0) / seconds),
  }));
  for (const s of windowStats.values()) s.frames = 0;
  return {
    memoryMB: Math.round(metrics.reduce((n, p) => n + (p.memory?.workingSetSize ?? 0), 0) / 1024),
    cpuPercent: Math.round(metrics.reduce((n, p) => n + (p.cpu?.percentCPUUsage ?? 0), 0)),
    processes: metrics.length,
    sentMBps: +(takeBytes() / 1048576 / seconds).toFixed(2),
    renderPath,
    sharedOutstanding: sharedFrames.size,
    windows: perWindow,
  };
}

// ---------- the bridge for apps ----------

ipcMain.handle('rednode:call', (_event, method, params) => {
  if (!connected) return Promise.reject(new Error('Not connected to the game'));
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The game did not answer within 5 seconds'));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    sendJson({ id, method, params });
  });
});

ipcMain.handle('rednode:state', () => ({ connected, mode, windowed, version: VERSION }));

// Drag handles reported by preload.js: flat [x, y, w, h, ...] in page pixels.
ipcMain.on('rednode:drag-regions', (event, regions) => {
  const w = windowFor(event.sender);
  if (!w || !Array.isArray(regions)) return;
  w.dragRegions = regions.map((n) => Math.round(Number(n) || 0));
  sendJson({ cmd: 'window.drag', window: w.id, regions: w.dragRegions });
});

// ---------- the launcher's app list (only the built-in launcher may use it) ----------

function fromLauncher(event) {
  const w = windowFor(event.sender);
  if (!w?.app.builtin) throw new Error('Only the REDnode launcher can manage apps');
}

function appList() {
  return [...apps.values()]
    .filter((a) => !a.builtin)
    .map(({ manifest: m }) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      author: m.author,
      description: m.description,
      kind: m.kind,
      open: !!windowOfApp(m.id),
    }));
}

ipcMain.handle('rednode:apps:list', (event) => {
  fromLauncher(event);
  return appList();
});

ipcMain.handle('rednode:apps:set-open', (event, id, open) => {
  fromLauncher(event);
  const entry = apps.get(id);
  if (!entry || entry.builtin) throw new Error(`No app "${id}"`);
  if (open) openApp(entry);
  else closeApp(id);
  settings.apps[id] = { open: !!open };
  writeJson('settings.json', settings);
  return appList();
});

ipcMain.handle('rednode:host:render-path', (event, path) => {
  fromLauncher(event);
  if (path === 'gpu' || path === 'cpu') setRenderPath(path);
  return renderPath;
});

function notifyLauncher() {
  for (const w of windows.values()) if (w.app.builtin) toPage(w, { event: 'apps' });
}

// ---------- windows ----------

function openApp(entry) {
  if (windowOfApp(entry.manifest.id)) return;
  const m = entry.manifest;
  const id = nextWindowId++;
  const win = new BrowserWindow({
    width: m.width,
    height: m.height,
    x: windowed ? 60 + windows.size * 80 : undefined,
    y: windowed ? 60 + windows.size * 80 : undefined,
    show: windowed, // never show an off-screen window: that would take OS focus from the game
    frame: windowed,
    transparent: !windowed,
    backgroundColor: windowed ? '#08090d' : '#00000000',
    useContentSize: true,
    title: m.name,
    webPreferences: {
      offscreen: windowed ? false : renderPath === 'gpu' ? { useSharedTexture: true } : true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const w = { id, app: entry, win, dragRegions: [] };
  windows.set(id, w);
  windowStats.set(id, { frames: 0 });

  if (!windowed) {
    win.webContents.setFrameRate(FPS);
    win.webContents.on('paint', (event, dirty, image) => {
      if (event.texture) sendShared(id, event.texture);
      else sendFrame(id, image, dirty);
    });
  }
  win.on('closed', () => {
    windows.delete(id);
    windowStats.delete(id);
  });
  win.loadFile(path.join(entry.dir, m.entry));
  if (connected) openInGame(w);
  log(`Opened ${m.id}`);
  notifyLauncher();
}

function closeApp(appId) {
  const w = windowOfApp(appId);
  if (!w) return;
  sendJson({ cmd: 'window.close', window: w.id });
  windows.delete(w.id);
  windowStats.delete(w.id);
  pendingFrames.delete(w.id);
  if (!w.win.isDestroyed()) w.win.destroy();
  log(`Closed ${appId}`);
  notifyLauncher();
}

// ---------- start ----------

app.whenReady().then(() => {
  protocol.handle('rednode', (request) => {
    const url = new URL(request.url);
    const file = path.join(UI_DIR, decodeURIComponent(url.pathname));
    if (url.host !== 'ui' || !file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file)) {
      return new Response('Not found', { status: 404 });
    }
    // Read directly rather than fetch a file:// URL: packaged, the kit is inside app.asar.
    const type = file.endsWith('.css') ? 'text/css' : 'text/javascript';
    return new Response(fs.readFileSync(file), { headers: { 'content-type': `${type}; charset=utf-8` } });
  });

  log(`REDnode overlay host ${VERSION}${app.isPackaged ? ' (packaged)' : ''}`);
  positions = readJson('window-positions.json', {});
  settings = { apps: {}, ...readJson('settings.json', {}) };
  renderPath = ['gpu', 'cpu'].includes(renderArg) ? renderArg : settings.renderPath === 'cpu' ? 'cpu' : 'gpu';
  log(`Render path: ${renderPath}`);
  // Never hold a shared texture long: Chromium has only a few.
  setInterval(() => {
    const n = releaseSharedFrames((f) => Date.now() - f.at > 1000);
    if (n) log(`Released ${n} shared frame(s) the game did not answer`);
  }, 500);
  discoverApps();
  for (const entry of apps.values()) if (shouldOpen(entry)) openApp(entry);

  if (!windowed) {
    connect();
    setInterval(() => {
      if (frames) log(`${frames} frames, ${(bytes / 1048576).toFixed(1)} MB sent in the last 10 s`);
      frames = 0;
    }, 10000);
  }

  // Started by the game: exit with it. The plugin also puts the host in a job
  // object, so Windows ends it if the game crashes.
  if (parentPid) {
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        log('The game has exited. Closing.');
        app.quit();
      }
    }, 1000);
  }
  log(windowed ? 'Window mode: apps run on the desktop, not in the game' : `Waiting for the game on ${PIPE}`);
});

app.on('window-all-closed', () => {
  if (windowed) app.quit();
});
