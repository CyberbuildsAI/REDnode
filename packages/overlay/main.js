// REDnode overlay host (proof of concept). See docs/overlay.md.
//
// Renders an overlay app off-screen with Chromium and streams its frames to the
// REDnode plugin in the game over a named pipe. Input from the game is replayed
// into the page. Apps call the game through window.rednode (preload.js).
//
//   npm run overlay            # off-screen, streams to the game
//   npm run overlay -- --window  # a normal window, to try an app without the game

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const net = require('node:net');
const path = require('node:path');

const PIPE = '\\\\.\\pipe\\rednode-overlay';
const WIDTH = 1024;
const HEIGHT = 640;
const FPS = 60;
const TYPE_FRAME = 1;
const TYPE_JSON = 2;

const windowed = process.argv.includes('--window');
const appPath = path.join(__dirname, 'apps', 'demo', 'index.html');

// Page pixels must match frame pixels, whatever the desktop scaling is.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

let win = null;
let socket = null;
let connected = false;
let mode = 'passive';

let writable = true;
let pendingFrame = null;
let frames = 0;
let bytes = 0;

const pending = new Map(); // request id -> { resolve, reject, timer }
let nextId = 1;

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

function toPage(message) {
  if (win && !win.isDestroyed()) win.webContents.send('rednode:event', message);
}

// ---------- pipe ----------

function writeMessage(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(type, 0);
  header.writeUInt32LE(payload.length, 4);
  return socket.write(Buffer.concat([header, payload]));
}

function sendFrame(image) {
  if (!connected) return;
  if (!writable) {
    pendingFrame = image; // keep only the newest frame while the pipe is busy
    return;
  }
  const { width, height } = image.getSize();
  const pixels = image.toBitmap(); // BGRA, premultiplied alpha
  const size = Buffer.alloc(8);
  size.writeUInt32LE(width, 0);
  size.writeUInt32LE(height, 4);
  writable = writeMessage(TYPE_FRAME, Buffer.concat([size, pixels]));
  frames += 1;
  bytes += pixels.length;
}

function sendJson(object) {
  if (connected) writeMessage(TYPE_JSON, Buffer.from(JSON.stringify(object), 'utf8'));
}

function connect() {
  let buffer = Buffer.alloc(0);
  socket = net.connect(PIPE);

  socket.on('connect', () => {
    connected = true;
    writable = true;
    log('Connected to the game');
    toPage({ event: 'link', connected: true });
    if (win) win.webContents.invalidate(); // send a full frame now
  });

  socket.on('drain', () => {
    writable = true;
    if (pendingFrame) {
      const image = pendingFrame;
      pendingFrame = null;
      sendFrame(image);
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
      toPage({ event: 'link', connected: false });
    }
    connected = false;
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
  const wc = win.webContents;
  switch (m.type) {
    case 'mouseMove':
      wc.sendInputEvent({ type: 'mouseMove', x: m.x, y: m.y });
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
  if (m.event === 'input') {
    onInput(m);
    return;
  }
  if (m.event === 'overlay' || m.event === 'hello') {
    mode = m.mode;
    // Chromium only draws the text caret and :focus styles in a focused page.
    // focusOnWebView focuses the page without taking OS focus from the game.
    if (mode === 'interactive') win.focusOnWebView();
    log(m.event === 'hello' ? `Game says hello (${m.plugin}), mode ${mode}` : `Mode ${mode}`);
  }
  toPage(m);
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

// ---------- window ----------

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: windowed, // never show the off-screen window: that would take OS focus from the game
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

  if (!windowed) {
    win.webContents.setFrameRate(FPS);
    win.webContents.on('paint', (_event, _dirty, image) => sendFrame(image));
    connect();
    setInterval(() => {
      if (frames) log(`${frames} frames, ${(bytes / 1048576).toFixed(1)} MB sent in the last 10 s`);
      frames = 0;
      bytes = 0;
    }, 10000);
  }

  win.loadFile(appPath);
  log(windowed ? 'Window mode: the app runs on the desktop, not in the game' : `Waiting for the game on ${PIPE}`);
});

app.on('window-all-closed', () => app.quit());
