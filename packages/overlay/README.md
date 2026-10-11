# REDnode overlay host

Status: **proof of concept.** It works in game (tested 2026-10-11 on 2.31). The design, the test and the open questions are in [docs/overlay.md](../../docs/overlay.md).

The host is an Electron app. It renders an overlay app off-screen, streams the frames to the REDnode plugin in the game, replays the game's mouse and keyboard input into the page, and gives the app a `window.rednode` API for talking to the game.

```powershell
npm run overlay          # from the repo root: off-screen, connects to the game
npm run overlay:window   # the app in a normal desktop window, without the game
```

Setup, including the Electron download, is in [docs/dev-setup.md](../../docs/dev-setup.md), section 10.

## Files

| File | What it does |
|---|---|
| [main.js](main.js) | The host: off-screen window, the pipe to the game, frame streaming, input replay, the bridge |
| [preload.js](preload.js) | Defines `window.rednode` for apps |
| [start.js](start.js) | Starts Electron with a clean environment |
| [apps/demo/](apps/demo/) | The demo app used in the in-game test. Start here to learn how an app is built |

## Writing an overlay app

An overlay app is a plain web page. Anything that works in Chrome works here.

| Rule | Why |
|---|---|
| Design for **1024 x 640** page pixels | The panel is that size. The game scales it with the screen height: 1:1 at 1080p, 2x at 4K |
| Leave the page **background transparent** | Transparent pixels show the game through. The demo draws its own panel with a semi-transparent background |
| **Don't draw a cursor** | The REDnode plugin draws it in the game, at the game's frame rate |
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
| `overlay` | `mode`: `passive`, `interactive` or `hidden` | The player presses F10 or Esc |
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
| **F10** | Cycles passive (drawn, input goes to the game), interactive (input goes to the app) and hidden |
| **Esc** | Leaves interactive mode |
