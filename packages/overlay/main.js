// REDnode overlay host. See docs/overlay.md and README.md.
//
// Renders each overlay window off-screen with Chromium and streams its frames
// to the REDnode plugin in the game over a named pipe. The plugin owns window
// placement, focus and dragging; the host replays the plugin's input into the
// right page. Apps call the game through window.rednode (preload.js).
//
//   npm run overlay              # off-screen, streams to the game
//   npm run overlay -- --window  # normal desktop windows, to try apps without the game

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// REDNODE_OVERLAY_PIPE lets tests use a private pipe instead of the game's.
const PIPE = process.env.REDNODE_OVERLAY_PIPE || '\\\\.\\pipe\\rednode-overlay';
const FPS = 60;
const TYPE_FRAME = 1;
const TYPE_JSON = 2;

// Windows to open. O3 replaces this list with app folders and manifests.
// Positions are in reference pixels (screen pixels at 1080p); x: null centers the window.
const APPS = [
  { id: 'demo', entry: 'apps/demo/index.html', width: 1024, height: 640, x: null, y: 220 },
  { id: 'signal', entry: 'apps/signal/index.html', width: 320, height: 320, x: 1480, y: 140 },
];

const windowed = process.argv.includes('--window');

// Page pixels must match frame pixels, whatever the desktop scaling is.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

let socket = null;
let connected = false;
let mode = 'passive';
let writable = true;
const pendingFrames = new Map(); // window id -> newest frame waiting for the pipe
let frames = 0;
let bytes = 0;

const pending = new Map(); // request id -> { resolve, reject, timer }
let nextId = 1;

/** @type {Map<number, { id: number, app: object, win: BrowserWindow, dragRegions: number[] }>} */
const windows = new Map();

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

// ---------- saved positions ----------

const positionsFile = () => path.join(app.getPath('userData'), 'window-positions.json');
let positions = {};
function loadPositions() {
  try {
    positions = JSON.parse(fs.readFileSync(positionsFile(), 'utf8'));
  } catch {
    positions = {};
  }
}
let saveTimer = null;
function savePosition(appId, x, y) {
  positions[appId] = { x, y };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(positionsFile()), { recursive: true });
      fs.writeFileSync(positionsFile(), JSON.stringify(positions, null, 2));
    } catch (err) {
      log('Could not save window positions:', err.message);
    }
  }, 500);
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

function sendFrame(windowId, image) {
  if (!connected) return;
  if (!writable) {
    pendingFrames.set(windowId, image); // keep only the newest frame per window while the pipe is busy
    return;
  }
  const { width, height } = image.getSize();
  const pixels = image.toBitmap(); // BGRA, premultiplied alpha
  const head = Buffer.alloc(12);
  head.writeUInt32LE(windowId, 0);
  head.writeUInt32LE(width, 4);
  head.writeUInt32LE(height, 8);
  writable = writeMessage(TYPE_FRAME, Buffer.concat([head, pixels]));
  frames += 1;
  bytes += pixels.length;
}

function openInGame(w) {
  const saved = positions[w.app.id];
  const x = saved?.x ?? w.app.x ?? Math.round((1920 - w.app.width) / 2);
  const y = saved?.y ?? w.app.y ?? Math.round((1080 - w.app.height) / 2);
  sendJson({ cmd: 'window.open', window: w.id, x, y, width: w.app.width, height: w.app.height, draggable: true });
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
    for (const w of windows.values()) openInGame(w);
    toAllPages({ event: 'link', connected: true });
  });

  socket.on('drain', () => {
    writable = true;
    for (const [id, image] of pendingFrames) {
      pendingFrames.delete(id);
      sendFrame(id, image);
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
      if (w) savePosition(w.app.id, m.x, m.y);
      return;
    }
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

// ---------- the bridge for apps ----------

ipcMain.handle('rednode:call', (_event, method, params) => {
  if (!connected) return Promise.reject(new Error('Not connected to the game'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The game did not answer within 5 seconds'));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    sendJson({ id, method, params });
  });
});

ipcMain.handle('rednode:state', () => ({ connected, mode, windowed }));

// Drag handles reported by preload.js: flat [x, y, w, h, ...] in page pixels.
ipcMain.on('rednode:drag-regions', (event, regions) => {
  const w = windowFor(event.sender);
  if (!w || !Array.isArray(regions)) return;
  w.dragRegions = regions.map((n) => Math.round(Number(n) || 0));
  sendJson({ cmd: 'window.drag', window: w.id, regions: w.dragRegions });
});

// ---------- windows ----------

function createWindow(appDef, index) {
  const win = new BrowserWindow({
    width: appDef.width,
    height: appDef.height,
    x: windowed ? 60 + index * 80 : undefined,
    y: windowed ? 60 + index * 80 : undefined,
    show: windowed, // never show an off-screen window: that would take OS focus from the game
    frame: windowed,
    transparent: !windowed,
    backgroundColor: windowed ? '#08090d' : '#00000000',
    useContentSize: true,
    webPreferences: {
      offscreen: !windowed,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const w = { id: index + 1, app: appDef, win, dragRegions: [] };
  windows.set(w.id, w);

  if (!windowed) {
    win.webContents.setFrameRate(FPS);
    win.webContents.on('paint', (_event, _dirty, image) => sendFrame(w.id, image));
  }
  win.loadFile(path.join(__dirname, appDef.entry));
}

app.whenReady().then(() => {
  loadPositions();
  APPS.forEach(createWindow);

  if (!windowed) {
    connect();
    setInterval(() => {
      if (frames) log(`${frames} frames, ${(bytes / 1048576).toFixed(1)} MB sent in the last 10 s`);
      frames = 0;
      bytes = 0;
    }, 10000);
  }
  log(windowed ? 'Window mode: apps run on the desktop, not in the game' : `Waiting for the game on ${PIPE}`);
});

app.on('window-all-closed', () => app.quit());
