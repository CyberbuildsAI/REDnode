# REDnode overlay host

Status: **phase O6 done.** O1 to O6 work in game: the player install, GPU sharing, Node mods beside overlay apps, and the generic game API (`rtti.call`, and `api` in the `rednode` package). The design, the plan and the test results are in [docs/overlay.md](../../docs/overlay.md).

The host is an Electron app. It renders each overlay window off-screen, streams the frames to the REDnode plugin in the game, replays the game's mouse and keyboard input into the right page, and runs Node mods in mod processes. Apps and mods reach the game through the same `rednode` package. The plugin owns window placement, focus and dragging, so they keep up with the game's frame rate.

```powershell
npm run overlay                          # from the repo root: off-screen, connects to the game
npm run overlay:window                   # the apps in normal desktop windows, without the game
npm run overlay -- --apps=demo,signal    # open exactly these apps this time
npm run overlay -- --render=cpu          # force the CPU path instead of GPU sharing
npm run overlay -- --hot-reload=off      # don't restart mods and reload apps when their files change
npm run overlay -- --data-dir=<folder>   # keep settings somewhere else, for tests
npm run overlay -- --mcp=off             # no kernel MCP server (on by default for developers)
npm run overlay -- --apps-dir="a;b"      # several apps folders, for example another repo's packages
npm run overlay:package                  # package the host for players (see below)
```

Setup, including the Electron download, is in [docs/dev-setup.md](../../docs/dev-setup.md), section 10. Node mods import the `rednode` package from `packages/rednode/dist`, so build it once with `npm run build --workspace rednode`.

## Files

| File | What it does |
|---|---|
| [main.js](main.js) | The host: package discovery, off-screen windows, the pipe to the game, frame streaming, input replay, the bridge, game state, hot reload |
| [mods.js](mods.js) | Node mods: mod processes, the shared group, status, logs |
| [mcp.js](mcp.js) | The kernel MCP server: REDnode's tools for AI agents such as Claude Code, on `127.0.0.1:41820`. See [docs/mcp.md](../../docs/mcp.md) |
| [gameapi-lookup.js](gameapi-lookup.js) | Game type and function lookup for the MCP server, from the generated game API types and REDnode's notes |
| [runtime/runner.js](runtime/runner.js) | A mod process (Electron `utilityProcess`). Runs each of its mods on a worker thread and watches for hangs |
| [runtime/worker.js](runtime/worker.js) | Starts one mod on its thread: maps `import "rednode"` to the SDK and carries its calls to the host |
| [builder/](builder/) | The page that shows windows built by Node mods with `ui.window` |
| [preload.js](preload.js) | Defines `window.rednode` for apps |
| [start.js](start.js) | Starts Electron with a clean environment (developer runs only) |
| [launcher/](launcher/) | The built-in launcher: a REDNODE tab that lists apps and mods, opens or closes them, shows each mod's state and memory, and sets the theme every window follows |
| [modlog/](modlog/) | The built-in Mod log: every line Node mods print, live, with a filter per mod, errors only, pause and Copy. Off by default; open it from the launcher |
| [apps/kit/](apps/kit/) | Every UI kit widget in one titled window, built from markup. Opens by default |
| [apps/native/](apps/native/) | A borderless, game-style button and menu. Opens by default |
| [apps/demo/](apps/demo/) | The proof-of-concept demo, written by hand without the kit |
| [apps/signal/](apps/signal/) | A small round widget: a borderless window with a transparent middle |
| [apps/coords/](apps/coords/) | A real HUD widget: V's position at the top of the screen, hidden in menus, photo mode and scenes |
| [apps/state/](apps/state/) | Shows the game state REDnode reads for `hideWith` |
| [apps/perf/](apps/perf/) | What the overlay costs: game frame rate, overlay CPU and GPU time, uploads, host memory and CPU |
| [apps/stress/](apps/stress/) | Worst case: a large window that redraws every pixel every frame |
| [apps/hello-mod/](apps/hello-mod/) | A Node mod with a window built by the ui builder: V's position, a sound button, a toggle |
| [apps/ticker-mod/](apps/ticker-mod/) | A Node mod with no window: logs V's position, game events and state changes |
| [apps/crash-mod/](apps/crash-mod/) | A Node mod that breaks on purpose in four ways, to test isolation. Off by default |
| [apps/vitals/](apps/vitals/) | A HUD widget with V's health, level and money, read through the generic game API from a web page |
| [apps/api-mod/](apps/api-mod/) | The same values from a Node mod, plus a change (100 eddies), a refused wrong argument and a stale reference |

## Apps, mods and manifests

Every folder in the apps folder with a `rednode-app.json` is a package: an overlay app (`entry`), a Node mod (`main`) or both. In the repo the apps folder is [apps/](apps/); for players it is `red4ext/plugins/REDnode/apps/` in the game folder.

```json
{
  "id": "native",
  "name": "Native button",
  "version": "0.1.0",
  "author": "Edgemodders",
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
| `entry` | An overlay app: the page to load, relative to the folder |
| `main` | A Node mod: the file to run, relative to the folder. Use `.mjs` for `import` syntax |
| `isolation` | Node mods: `process` makes the mod always run in its own process, so the player cannot put it in the shared group. Use it for mods with native addons |
| `permissions` | Powers the package asks for, which the player allows in the launcher. Today `mcp`: the kernel MCP server's tools, through `kernel.mcp()` |
| `width`, `height` | Window size in page pixels, 1 to 4096. Needed with `entry` |
| `anchor` | `top-left` (default), `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom` or `bottom-right` |
| `x`, `y` | Offset from the anchor in reference pixels (1080p). `bottom-right` with x -40 is 40 px from the right edge |
| `kind` | `window` (default) or `hud`: drawn, but never takes input or focus, and cannot be dragged |
| `hideWith` | Game states that hide the window: `menu`, `photo-mode`, `scene`, `main-menu` |
| `open` | Whether the app is open, or the mod running, until the player changes it in the launcher |

A window the player has dragged keeps its saved position instead of the anchor. The launcher remembers which apps and mods are on, and which mods share a process. Both are kept in the host's user data folder, `%APPDATA%\@rednode\overlay`.

## Node mods

| What | How |
|---|---|
| Where a mod runs | A worker thread in a mod process, outside the game and outside the host's main process |
| Process per mod or shared | Each mod gets its own process by default (about 80 MB each, measured against the mock). The launcher's **Shared process** switch moves mods into one shared process (three mods in about 92 MB). A thrown error, an endless loop or `process.exit()` stops only that mod in both cases. A native crash or running out of memory ends the whole process: in the shared group, every mod in it. The host restarts a crashed process up to 3 times a minute |
| Hangs | A mod that does not answer for 10 seconds shows **NOT RESPONDING**. **Restart** stops it even inside an endless loop |
| Output | Everything a mod prints goes to `rednode-mods.log`, next to the host log, each line tagged with the mod id. The **Mod log** app shows it live in game, and its **Copy** button puts the lines shown on the clipboard. The launcher shows each mod's last lines and last error. Built-in apps (the launcher and Mod log) may use host-only calls; other apps cannot read mod output |
| Hot reload | When a package's files change, the host restarts the mod and reloads the app's page. On for developers; for players a launcher switch, off by default |
| The API | `import { game, ui } from "rednode"`. See the [Overlay apps guide](../../docs/overlay-apps.md#node-mods) |

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

Apps get the UI kit with `<script src="rednode://ui/rednode-ui.js"></script>`. See [packages/ui](../ui/). The `rednode` package is served as `rednode://sdk/index.js`; packaged, it and the mod runtime are in `host/resources/sdk/` and `host/resources/runtime/`.

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

New apps should use the `rednode` package instead, the same API Node mods use: see the [Overlay apps guide](../../docs/overlay-apps.md#talking-to-the-game). `window.rednode` stays, and the package is built on it.

```js
// Call a game method. Runs on the game thread between frames.
// Resolves with the result, or rejects with the game's error message.
const pos = await window.rednode.call('player.position');
console.log(pos.x, pos.y, pos.z);

// Listen to messages from the game. Returns a function that unsubscribes.
const stop = window.rednode.on((message) => {
  if (message.event === 'game') console.log(message.name, message.value);
});

// Connection and game state: { connected, mode, windowed, version, game }
const state = await window.rednode.state();
```

Bridge methods:

| Method | Result |
|---|---|
| `player.position` | `{ x, y, z }`: V's world position. Fails at the main menu, where there is no player |
| `audio.play` | `{ played }`: plays the game sound event `params.name` |
| `game.info` | `{ frame }`: the REDnode frame counter |
| `rtti.call` | `{ fn, class?, self?, args }`: any game function. Use `api` from the `rednode` package instead of calling it directly |
| `rtti.get` | `{ self, prop }`: a game object's property |
| `rtti.release` | `{ refs }`: drops object references, once for each time one was received |

Messages from the game:

| `event` | Fields | When |
|---|---|---|
| `link` | `connected` | The host connects to, or loses, the game |
| `hello` | `plugin`, `mode` | Right after connecting |
| `overlay` | `mode`: `passive`, `interactive` or `hidden` | The player presses F10 or Esc, or clicks empty screen |
| `focus` | `focused`: `true` or `false` | This window gained or lost keyboard focus. Use it to dim your title bar |
| `perf` | `game`: `fps`, `cpuMs`, `cpuMsMax`, `waitMs`, `openMs`, `gpuMs`, `gpuMsMax`, `uploadsPerSec`, `uploadMBps`, `sharedPerSec`, `opensPerSec`, `reusedPerSec`. `host`: `memoryMB`, `cpuPercent`, `processes`, `sentMBps`, `renderPath`, `windows` | Once a second |
| `state` | `state`: `connected`, `overlay`, `menu`, `photoMode`, `scene`, `mainMenu` | The link, the overlay mode or the game's UI state changed |
| `theme` | `theme`: `rednode`, `game` or `yellow` | The player picked another theme in the launcher. The UI kit applies it for you |
| `ui-state` | `menu`, `photoMode`, `scene`, `mainMenu` (booleans), `sceneTier` (number, -1 without a player) | The game's UI state changed |
| `game` | `name`, `value`, `frame` | A redscript event: today `PlayerPuppet.OnGameAttached`, at the main menu and on every save load |

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
| **Ctrl+V**, **Ctrl+C**, **Ctrl+X**, **Ctrl+A**, **Ctrl+Z** | Paste, copy, cut, select all and undo in the focused window, run by the host |
