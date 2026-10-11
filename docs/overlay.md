# HTML overlay

Status: **proof of concept passed.** All four steps work in game, alone and side by side with CET and 10 other RED4ext plugins (2026-10-11). See [Test results](#test-results). The next step is planning the real version.

REDnode overlay apps are small web apps (HTML, CSS and JavaScript) drawn on top of the game, like CET's ImGui windows. They talk to the game through the same `rednode` API as Node mods.

## Why HTML

| | CET + ImGui | REDnode HTML overlay |
|---|---|---|
| Language | Lua | JavaScript or TypeScript |
| UI model | Immediate mode: the UI is redrawn by code every frame | Retained: a normal web page, any web framework |
| Look | Developer tool | Anything CSS can do, including the REDnode HUD style |
| Where app code runs | Inside the game, on the game thread | Outside the game, in the overlay host |
| Game calls | Synchronous | Asynchronous, at least one frame per round trip |
| Tooling | CET console | Browser dev tools, hot reload, npm packages |

## Architecture

```
 Overlay host (Electron, out of process)            Game process (REDnode plugin)
 ┌──────────────────────────────────────┐          ┌───────────────────────────────────┐
 │ Node: rednode API, Tier 2 mods       │          │ Present hook: draw overlay quad   │
 │ Chromium, off-screen: renders apps   │ frames → │ Window hook: hotkey, mouse, keys  │
 │   to a BGRA image                    │ ← input  │ Game thread: run bridge requests  │
 │ Input injection into the page        │ requests→│   through RTTI                    │
 │ Bridge: window.rednode in each app   │ ←results │ Events from scripts (Tier 1 path) │
 └──────────────────────────────────────┘  events  └───────────────────────────────────┘
                    one named pipe: \\.\pipe\rednode-overlay
```

| Part | Where | Job |
|---|---|---|
| Overlay host | Out of process | An Electron app. Chromium renders each app off-screen. Node holds the bridge. Crashes here cannot take the game down |
| Compositor | In the game | Hooks `IDXGISwapChain::Present` through the swapchain's vtable and draws the latest frame as a textured quad, using the game's own D3D12 device and command queue from the RED4ext SDK (`GpuApi::GetDeviceData()`) |
| Input | In the game | Subclasses the game window. A hotkey toggles interactive mode. In that mode mouse and keyboard go to the overlay, not the game |
| Bridge | Both | JSON requests from apps run on the game thread, between frames, through RTTI calls. Results and game events go back the same way |

### Synchronous and asynchronous kernels

Chromium always runs page JavaScript in its own renderer process. So an overlay app can never be part of the game's synchronous path.

| Kernel | What an overlay app can do |
|---|---|
| Tier 2 (async) | Everything. Events in, commands and queries out, as promises |
| Tier 1 (sync) | Configure it: set interceptor parameters, toggle declarative rules. Changes apply from the next frame. The synchronous code itself stays native or declarative |

## Proof of concept

Goal: decide whether the approach is worth building out. Each step is a separate thing to check in game.

| Step | Proves | How to check |
|---|---|---|
| 1. Compositor | REDnode can draw over the game with the game's own D3D12 queue | A panel is visible in the main menu and in gameplay |
| 2. Live HTML | An Electron off-screen page reaches the game as frames | The demo app's clock ticks and its animation moves |
| 3. Input | Mouse and keyboard reach the page, and the game ignores them in interactive mode | F10, then click a button, type in a text box. The camera should not move |
| 4. Bridge | A page can call into the game and get an answer | "Read player position" shows V's coordinates, and they change after walking |

### Running the test

The overlay needs REDnode 0.3.0 in the game and the host running on the desktop. Setup is in [Dev setup](dev-setup.md), section 10.

1. Start the host in a terminal and leave it running: `npm run overlay`. It prints `Waiting for the game`.
2. Launch the game. At the main menu a panel appears in the middle of the screen. Without the host it is a dark placeholder with a yellow frame and a moving cyan line. That alone means step 1 works.
3. With the host running, the panel shows the demo app, and the terminal prints `Connected to the game`. The clock should tick (step 2).
4. Press **F10** for interactive mode. A yellow cursor appears in the panel. Click **Click me**, click the text box and type (step 3). Press **Esc** to give input back to the game.
5. Load a save. The events tile shows `PlayerPuppet.OnGameAttached`. In interactive mode, click **Read player position**, walk a few steps, and read it again (step 4).
6. Press **F10** twice more to hide the panel, and once more to show it again.
7. Quit to desktop through the menu.

Note what you see at each step, plus any stutter, flicker, wrong colors, or input that leaked to the game. The plugin's log lines start with `Overlay:` in `red4ext/logs/rednode-*.log`.

### Simplifications

Simplifications in the proof of concept, all to revisit if it goes further:

- **CPU frame copy.** Frames travel through the pipe as raw BGRA pixels and are uploaded each time the page repaints. The real version would share a GPU texture with Chromium.
- **One fixed panel** of 1024 x 640 pixels, scaled with the screen height. No window management.
- **One app**, loaded by the host at start.
- **The plugin draws the cursor** in its shader, from the position it tracks. Off-screen Chromium does not paint one, and a page-drawn cursor lags (see the test results).
- **HDR:** the shader converts for scRGB and PQ output, but the brightness level is a guess.

## Test results

### Run 1: 2026-10-11, clean setup

| Item | Value |
|---|---|
| Game | 2.31, Vortex `vanilla` profile: RED4ext, redscript and REDnode 0.3.0 only. No CET |
| Display | 3840 x 2160 swapchain, format 28 (`R8G8B8A8_UNORM`), SDR. The panel is drawn at 2x |
| Host | Electron 44.7.0, 30 frames a second |

| Step | Result |
|---|---|
| 1. Compositor | **Passed.** The panel was drawn at the main menu and in gameplay |
| 2. Live HTML | **Passed.** The clock ticked and the bar moved |
| 3. Input | **Passed**, with two usability issues below. Clicks and typing reached the page |
| 4. Bridge | **Passed.** `player.position` returned V's position. `OnGameAttached` events reached the page at the main menu and on load |
| F10 modes | **Passed.** Three full cycles of passive, interactive and hidden |
| Logs | No errors or warnings. redscript compiled cleanly |

| Issue | Cause | Fix (confirmed in run 2) |
|---|---|---|
| The cursor lagged | The page drew it. Each move went through the pipe, a Chromium repaint at 30 fps and a 2.6 MB frame back | The plugin draws the cursor in its shader. The host now runs at 60 fps |
| No text caret in the text box | Off-screen Chromium did not treat the page as focused. Typing still worked | The host calls `focusOnWebView()` in interactive mode. It focuses the page without taking OS focus from the game. `webContents.focus()` did not work, and showing the window would take OS focus |

### Run 2: 2026-10-11, with CET and other mods

| Item | Value |
|---|---|
| Game | 2.31, the user's modded profile: CET, redscript, REDnode 0.3.0 and 10 other RED4ext plugins (ArchiveXL, Codeware, TweakXL, audioware, Mod Settings and more) |
| Display | Same as run 1: 3840 x 2160, SDR |
| Host | Electron 44.7.0, 60 frames a second |

| Check | Result |
|---|---|
| All four steps | **Passed** |
| Cursor | **Fixed.** Drawn by the plugin, no lag |
| Text caret | **Fixed.** The text box shows its focus border and a blinking caret |
| REDnode and CET overlays drawn together | **Passed.** Both visible at once |
| Input routing | **Passed.** Input went to whichever overlay was active, and not to the game |
| Stability | No flicker, stutter or crash reported. No errors in the REDnode, RED4ext, redscript or CET logs. CET logged its own D3D12 and window hooks as successful |

Observation: CET windows can be dragged. The REDnode panel cannot, because the proof of concept has one fixed panel. Window management belongs in the real version.

## Risks and open questions

| Risk | Status |
|---|---|
| Coexisting with CET, which also hooks `Present` and the window procedure | Worked in run 2. REDnode patches the vtable entry and chains to whatever was there, so CET's code hook still runs |
| Blocking game input | Unverified. If the game polls raw input instead of reading window messages, keys and mouse may still reach the game in interactive mode |
| Mouse position while the game hides and locks the cursor | Handled by summing raw mouse movement into a virtual cursor. Worked in run 1 |
| Blocking game input | Worked in runs 1 and 2, with and without CET |
| Memory | Electron adds a few hundred MB. Unverified for this use |
| Frame pacing | Uploading a frame costs GPU time on the present path. Only done when the page repaints |
| Upscalers and frame generation | Unverified. The overlay is drawn on the final back buffer, after them |

## Decision after the test

| Result | Next step |
|---|---|
| All four steps work, no stutter | Plan the real version: shared GPU textures, multiple apps and windows, an app manifest, and folding the host into the Tier 2 runtime |
| Drawing works, input does not | Look at how CET blocks input, the deferred CET analysis |
| Drawing does not work | Fall back to the game's own ink UI, driven by the same bridge |
