# REDnode overlay host

Status: **phase O5, performance.** The proof of concept and O1 to O4 work in game, including the player install. O5 adds GPU sharing, changed-area updates and performance measurement. The design, the plan and the test results are in [docs/overlay.md](../../docs/overlay.md).

The host is an Electron app. It renders each overlay window off-screen, streams the frames to the REDnode plugin in the game, replays the game's mouse and keyboard input into the right page, and gives apps a `window.rednode` API for talking to the game. The plugin owns window placement, focus and dragging, so they keep up with the game's frame rate.

```powershell
npm run overlay                          # from the repo root: off-screen, connects to the game
npm run overlay:window                   # the apps in normal desktop windows, without the game
npm run overlay -- --apps=demo,signal    # open exactly these apps this time
npm run overlay -- --render=cpu          # force the CPU path instead of GPU sharing
npm run overlay:package                  # package the host for players (see below)
```

Setup, including the Electron download, is in [docs/dev-setup.md](../../docs/dev-setup.md), section 10.

## Files

| File | What it does |
|---|---|
| [main.js](main.js) | The host: app discovery, off-screen windows, the pipe to the game, frame streaming, input replay, the bridge |
| [preload.js](preload.js) | Defines `window.rednode` for apps |
| [start.js](start.js) | Starts Electron with a clean environment (developer runs only) |
| [launcher/](launcher/) | The built-in launcher: a REDNODE tab that lists apps and opens or closes them |
| [apps/kit/](apps/kit/) | Every UI kit widget in one titled window, built from markup. Opens by default |
| [apps/native/](apps/native/) | A borderless, game-style button and menu. Opens by default |
| [apps/demo/](apps/demo/) | The proof-of-concept demo, written by hand without the kit |
| [apps/signal/](apps/signal/) | A small round widget: a borderless window with a transparent middle |
| [apps/coords/](apps/coords/) | A real HUD widget: V's position at the top of the screen, hidden in menus, photo mode and scenes |
| [apps/state/](apps/state/) | Shows the game state REDnode reads for `hideWith` |
| [apps/perf/](apps/perf/) | What the overlay costs: game frame rate, overlay CPU and GPU time, uploads, host memory and CPU |
| [apps/stress/](apps/stress/) | Worst case: a large window that redraws every pixel every frame |

## Apps and manifests

Every folder in the apps folder with a `rednode-app.json` is an app. In the repo the apps folder is [apps/](apps/); for players it is `red4ext/plugins/REDnode/apps/` in the game folder.

```json
{
  "id": "native",
  "name": "Native button",
  "version": "0.1.0",
  "author": "CyberbuildsAI",
  "description": "A borderless, game-style button and menu.",
  "entry": "index.html",
  "kind": "window",
  "width": 440,
  "height": 380,
  "anchor": "bottom-right",
  "x": -40,
  "y": -100,
  "open": true
}
```

| Field | Meaning |
|---|---|
| `id` | Unique, lowercase letters, digits, `-` and `_`. Saved positions and settings use it |
| `name`, `version`, `author`, `description` | Shown in the launcher |
| `entry` | The page to load, relative to the folder |
| `width`, `height` | Window size in page pixels, 1 to 4096 |
| `anchor` | `top-left` (default), `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom` or `bottom-right` |
| `x`, `y` | Offset from the anchor in reference pixels (1080p). `bottom-right` with x -40 is 40 px from the right edge |
| `kind` | `window` (default) or `hud`: drawn, but never takes input or focus, and cannot be dragged |
| `hideWith` | Game states that hide the window: `menu`, `photo-mode`, `scene`, `main-menu` |
| `open` | Whether the app starts open, until the player changes it in the launcher |

A window the player has dragged keeps its saved position instead of the anchor. The launcher remembers which apps are on. Both are kept in the host's user data folder, `%APPDATA%\@rednode\overlay`.

## Render paths

| Path | How frames reach the game | When |
|---|---|---|
| `gpu` (default) | Chromium renders into a shared GPU texture. The host sends its handle; the plugin copies it on the GPU and answers `frame-done`, and the host releases the texture | Normal |
| `cpu` | The host sends the changed rectangle as BGRA pixels; the plugin uploads it | If GPU sharing fails, or when chosen |

If the plugin reports `shared-failed`, the host switches to `cpu` by itself for that session. The launcher's **GPU sharing** switch saves the choice; `--render=gpu|cpu` overrides it for one run.

## Packaged host

`npm run overlay:package` builds `REDnode-overlay.exe` with its own Electron, and stages it with the example apps next to the plugin:

```
red4ext/plugins/REDnode/
  REDnode.dll
  host/REDnode-overlay.exe
  apps/<id>/rednode-app.json
```

The plugin starts the host when the game loads, as `REDnode-overlay.exe --apps-dir=<plugin>\apps --parent-pid=<game> --log=<game>\red4ext\logs\rednode-overlay.log`. It runs in a job object, so it ends with the game even after a crash, and it also exits when the game process is gone. Only one host runs at a time.

Apps get the UI kit with `<script src="rednode://ui/rednode-ui.js"></script>`. See [packages/ui](../ui/).

## Writing an overlay app

An overlay app is a plain web page. Anything that works in Chrome works here.

| Rule | Why |
|---|---|
| Design for your window's **fixed size** in page pixels | Set in `APPS` for now (the demo is 1024 x 640, Signal 320 x 320). The game scales windows with the screen height: 1:1 at 1080p, 2x at 4K |
| Leave the page **background transparent** | Transparent pixels show the game through. The demo draws its own panel with a semi-transparent background |
| **Don't draw a cursor** | The REDnode plugin draws it in the game, at the game's frame rate |
| Mark drag handles with **`data-rednode-drag`** | Pressing on such an element moves the window instead of clicking the page. The plugin does the dragging |
| **Transparent pixels click through** | A click where your page is fully transparent goes to the window behind, or to the game. Shape your window with transparency |
| Keep animation light | Every repaint is copied to the game. The host caps it at 60 frames a second |

### The `window.rednode` API

```js
// Call a game method. Runs on the game thread between frames.
// Resolves with the result, or rejects with the game's error message.
const pos = await window.rednode.call('player.position');
console.log(pos.x, pos.y, pos.z);

// Listen to messages from the game. Returns a function that unsubscribes.
const stop = window.rednode.on((message) => {
  if (message.event === 'game') console.log(message.name, message.value);
});

// Connection state: { connected, mode, windowed }
const state = await window.rednode.state();
```

Bridge methods in the proof of concept:

| Method | Result |
|---|---|
| `player.position` | `{ x, y, z }`: V's world position. Fails at the main menu, where there is no player |
| `game.info` | `{ frame }`: the REDnode frame counter |

Messages from the game:

| `event` | Fields | When |
|---|---|---|
| `link` | `connected` | The host connects to, or loses, the game |
| `hello` | `plugin`, `mode` | Right after connecting |
| `overlay` | `mode`: `passive`, `interactive` or `hidden` | The player presses F10 or Esc, or clicks empty screen |
| `focus` | `focused`: `true` or `false` | This window gained or lost keyboard focus. Use it to dim your title bar |
| `perf` | `game`: `fps`, `cpuMs`, `cpuMsMax`, `gpuMs`, `gpuMsMax`, `uploadsPerSec`, `uploadMBps`, `sharedPerSec`. `host`: `memoryMB`, `cpuPercent`, `processes`, `sentMBps`, `renderPath`, `windows` | Once a second |
| `ui-state` | `menu`, `photoMode`, `scene`, `mainMenu` (booleans), `sceneTier` (number, -1 without a player) | The game's UI state changed |
| `game` | `name`, `value`, `frame` | A redscript event, from the Tier 1 path (the P1 probe's `OnGameAttached`) |

### How the demo is built

[apps/demo/app.js](apps/demo/app.js) has one section per tile:

| Tile | Shows how to |
|---|---|
| 01 Compositor + live HTML | Animate with `requestAnimationFrame`. The clock proves frames reach the game |
| 02 Input | Use normal DOM events. Clicks and typing arrive as real browser events |
| 03 Bridge to the game | Call `window.rednode.call` and handle both the result and the error |
| 04 Events from the game | Subscribe with `window.rednode.on` and react to `link`, `overlay` and `game` messages |

The styling in [apps/demo/style.css](apps/demo/style.css) uses the REDnode HUD tokens from the docs site.

## In the game

| Key | Effect |
|---|---|
| **F10** | Cycles passive (drawn, input goes to the game), interactive (input goes to the windows) and hidden |
| **Esc**, or a click on empty screen | Leaves interactive mode |
| Drag a handle | Moves the window. Positions are saved in the host's user data folder |
