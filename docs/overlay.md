# HTML overlay

Status: **O6 One runtime and O8 Mod Manager passed in game.** O1 to O6b have all passed; the O4 scene threshold is still open (see the O4 result). Node mods run in the host beside overlay apps, both use the `rednode` package, and `api` calls any game function, typed. Next: REDagent, then O7 Display. To build an app today, see the [Overlay apps](overlay-apps.md) guide. The proof of concept passed in game, alone and side by side with CET and 10 other RED4ext plugins (2026-10-11). See [Test results](#test-results) and [the plan](#plan-for-the-real-version).

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
| Frame rate | **Good.** No visible drop with the panel streaming at 60 fps at 4K |
| Cursor | **Fixed.** Drawn by the plugin, visible and with no lag |
| Text caret | **Fixed.** The text box shows its focus border and a blinking caret |
| REDnode and CET overlays drawn together | **Passed.** Both visible at once |
| Input routing | **Passed.** Input went to whichever overlay was active, and not to the game |
| Stability | No flicker, stutter or crash reported. No errors in the REDnode, RED4ext, redscript or CET logs. CET logged its own D3D12 and window hooks as successful |

Observation: CET windows can be dragged. The REDnode panel cannot, because the proof of concept has one fixed panel. Window management belongs in the real version.

## Risks and open questions

| Risk | Status |
|---|---|
| Coexisting with CET, which also hooks `Present` and the window procedure | Worked in run 2. REDnode patches the vtable entry and chains to whatever was there, so CET's code hook still runs |
| Mouse position while the game hides and locks the cursor | Handled by summing raw mouse movement into a virtual cursor. Worked in run 1 |
| Blocking game input | Worked in runs 1 and 2, with and without CET |
| Memory | Electron adds a few hundred MB. Not measured yet |
| Frame pacing | Uploading a frame costs GPU time on the present path. Only done when the page repaints |
| Upscalers and frame generation | Unverified. The overlay is drawn on the final back buffer, after them |
| Scene detection threshold | `SceneTier >= 4` counts as a scene. Unverified; test on a fresh playthrough (see the O4 result) |

## Decision after the test

| Result | Next step |
|---|---|
| All four steps work, no stutter | Plan the real version: shared GPU textures, multiple apps and windows, an app manifest, and folding the host into the Tier 2 runtime |
| Drawing works, input does not | Look at how CET blocks input, the deferred CET analysis |
| Drawing does not work | Fall back to the game's own ink UI, driven by the same bridge |

The result was the first row.

## Plan for the real version

Status: **draft for review.** Phases are numbered O1 to O9 so they do not clash with the project phases P0 to P4. Each phase ends with an in-game test, like the proof of concept.

### Goal

Overlay apps that can look like part of the game: borderless, any shape, transparent where the app is transparent, either interactive windows or HUD widgets that never take input. They are written as web pages and use the same `rednode` API as Node mods.

### Window model

The plugin owns window placement, so moving a window never waits on Chromium. The host owns rendering, one off-screen page per window.

| Property | Values | Notes |
|---|---|---|
| `kind` | `window` or `hud` | A `hud` window is drawn but never focused and never takes input |
| `frame` | `none` (default) | REDnode draws nothing but the page. A title bar with close and drag comes from the UI kit's `<rn-window>`, not from the plugin |
| `size` | page pixels | Scaled with the screen height, like the proof of concept. Later also with the game's UI scale |
| `anchor` | `center`, `top-left` and so on, plus an offset | Lets HUD widgets sit at a screen edge at any resolution and aspect ratio |
| `draggable` | yes or no | Drag handles are marked in the page's HTML, for example `data-rednode-drag` |
| `hideWith` | game UI states | For example `menu`, `photo-mode`, `scene`. The plugin hides the window while that state is on |

Rules that make borderless windows behave:

| Rule | Why |
|---|---|
| **Click-through on transparent pixels.** A click where the page's alpha is zero goes to the window below, or to the game | A borderless window's invisible rectangle must not block anything |
| **Focus follows the click.** Only the focused window gets keyboard input. Clicking the game area gives input back to the game | Matches CET and desktop behavior |
| **Positions are saved** per app | Windows come back where the player left them |

### Phases

| Phase | Builds | In-game test proves |
|---|---|---|
| **O1 Windows** | Several windows, each with its own texture and placement. Drag handles, focus, z-order, click-through on transparent pixels, saved positions. Drag runs in the plugin, at the game's frame rate | Two demo windows can be dragged, overlapped and focused. Clicks pass through transparent parts |
| **O2 UI kit** | `@rednode/ui`: web components with the `rednode` and `game` themes, keyboard and gamepad navigation, UI sounds through the game. See [UI kit](#ui-kit) | A titled window with widgets, and a borderless native-style button, both built from markup only |
| **O3 Apps** | App folders with a `rednode-app.json` manifest (id, name, entry page, kind, size, anchor). The host loads every app it finds. A launcher app, built with the UI kit, opens and closes the others. **Player install:** the host packaged as a standalone app and started by the plugin (see [Player install](#player-install)) | A packaged build copied into the game folder starts on its own with the game, and a third-party style app in its own folder loads without changing the host |
| **O4 HUD widgets** | The `hud` kind, anchors, and `hideWith`, driven by game UI state events from the bridge. Research which game state shows menus, photo mode and scenes | A HUD widget sits at a screen edge, never takes input, and hides in menus and photo mode |
| **O5 Performance** | Shared GPU textures: Chromium renders to a D3D11 texture that the plugin opens in D3D12, so no pixel copy through the pipe. Updates only for changed regions. Measure memory and GPU cost | Several animated windows at 4K with no visible frame drop. Numbers recorded |
| **O6 One runtime** | The overlay host becomes the Tier 2 runtime: Node mods and overlay apps in one process, one `rednode` package for both. Bridge methods grow from the two demo calls into the real API, generated from the game API data. Node mods get the UI builder | A Node mod and an overlay app use the same API call and get the same answer. A Node mod opens a window without writing HTML |
| **O7 Display** | HDR brightness calibration against the game's own HUD, DLSS frame generation, resolution and window-mode changes, ultrawide | The overlay looks right and stays stable across display modes |
| **O8 Mod Manager** | A built-in Mod Manager app with a table of every package, search, paging and bulk actions. **Pin to launcher** keeps the launcher short; **Pin to HUD** decides which windows stay on screen during gameplay. See [O8 Mod Manager: plan](#o8-mod-manager-plan) | With dozens of packages, the launcher lists only the pinned ones, and any package is found, switched and inspected in the Mod Manager |
| **O9 Debugger** | Chromium DevTools for any overlay app, from an **Inspect** button: first in a desktop window, then, if a prototype works, inside the overlay as a built-in Debugger app. Node mods debugged through Node's inspector, attachable from VS Code and REDcode. See [O9 Debugger: plan](#o9-debugger-plan) | An app's page is inspected and a breakpoint hit while the game runs; a Node mod stops at a breakpoint set in VS Code |
| **O10 Layers** | A tool layer above packages' windows for REDnode's own windows and packages the player lets stay on top; solo mode, in which one package hides every other package's windows. Asked for by EDGEbuilder ([#10](https://github.com/Edgemodders/REDnode/issues/10), [#7](https://github.com/Edgemodders/REDnode/issues/7)). See [O10 Layers](#o10-layers-built) | A full-screen package cannot cover the launcher or the Test timer, and its solo mode hides everything else until it ends |
| **O11 Spaces** | Named sets of windows, like virtual desktops: the player switches the space and only its windows show; tool windows and windows set to "all spaces" show in every space. Title-bar actions with overflow. See [O11 Spaces: plan](#o11-spaces-plan) | A player with many HUD widgets keeps them in two or three spaces and switches between them without switching packages on and off |
| **O12 Console** | A built-in console, like Cyber Engine Tweaks' Lua console, for free-form JavaScript with the whole `rednode` package ready. See [O12 Console: plan](#o12-console-plan) | A player types `await tweakdb.get("Items.money.price")` and gets the answer, then calls a method on a game object from the line before |

### O1 Windows: test

Built 2026-10-11, REDnode 0.4.0. Window logic is covered by 19 unit tests in `native/tests/windows_test.cpp`, run by `tools/build-native.ps1`. The host was tested against a mock of the plugin. Two apps open: the demo (1024 x 640, title bar is its drag handle) and **Signal** (a round 320 x 320 widget with a transparent middle and a yellow drag tab).

1. Start the host (`npm run overlay`) and the game. Both windows appear at the main menu.
2. **F10** for interactive mode. Drag the demo by its title bar and Signal by its yellow tab. They should follow the cursor with no lag.
3. Overlap them. Click one: it comes to the front, and the other one's title dims.
4. Put Signal over the demo. Click inside Signal's transparent middle: the click should reach the demo underneath, for example its **Click me** button.
5. Click **Ping** on Signal: it shows the game frame.
6. Click empty screen, away from both windows: interactive mode ends and the game gets input back.
7. Quit the game and the host, start both again: the windows come back where you left them.

**Result, 2026-10-11: passed.** Modded profile with CET, 3840 x 2160 SDR. Every step worked: dragging, front-to-back order and focus, click-through on Signal's transparent middle, Ping, leaving interactive mode by clicking empty screen, and saved positions across a restart of the game and the host. No errors in the logs.

### O2 UI kit: test

Built 2026-10-11, REDnode 0.5.0. The kit is [`packages/ui`](https://github.com/Edgemodders/REDnode/tree/main/packages/ui): 12 components as markup, two themes, keyboard navigation, and UI sounds through the new bridge call `audio.play`. Both test apps were checked against a mock of the plugin. Gamepad navigation is left for later, because the game also reads the controller.

The host now opens two apps: **Kit**, a titled window with every widget, and **Native**, a borderless game-style button at the lower right.

1. Start the host and the game. Kit and the red **Open stash** button appear.
2. **F10**. In Kit, try each tab: press buttons, flip toggles, drag the slider, type a call sign and press Enter, pick list and menu items. Hover **Hover me** for a tooltip.
3. Flip **Game theme** in Kit's title bar: the window switches to the game look.
4. Use the keyboard: Tab between widgets, arrows in the list and menu, Enter to choose.
5. Click **Open stash**, pick an item: a game-style notification appears. Drag the button by its striped grip.
6. Kit's **Sound** tab: pick a name and press **Play**. Note which names make a sound; the names are unverified.

**Result, 2026-10-11: passed.** Modded profile with CET, 3840 x 2160 SDR. All widgets, both themes, keyboard use, the native-style button and its notifications worked. Game UI sounds played through `audio.play`, so `AudioSystem.Play` with no entity works for overlay sounds. No errors in the logs.

### O3 Apps: test

Built 2026-10-11, REDnode 0.6.0. Apps are folders with a `rednode-app.json` manifest. The **launcher**, built into the host, lists them and opens or closes them. The host is packaged as `REDnode-overlay.exe` and the plugin starts it with the game, in a job object so it never outlives the game. Tested against a mock of the plugin: app discovery, anchors, the launcher, opening an app from it, saved choices, the log file and the single-instance lock. Window anchoring has 5 new unit tests.

This is the player path: no `npm run overlay`.

1. Close any host you started by hand. In the game folder, REDnode now has `host/` (the packaged host) and `apps/` (Kit, Native, Demo, Signal).
2. Launch the game normally. Do not start anything else. At the main menu: Kit, the **Open stash** button, and a small **REDNODE · 2/4** tab at the lower left appear on their own.
3. **F10**, then click the **REDNODE** tab. The launcher lists the four apps with their versions and descriptions.
4. Switch **Signal** and **Demo** on: they open. Switch **Kit** off: it closes.
5. Quit the game through the menu. The host closes with it: `REDnode-overlay.exe` is no longer in Task Manager.
6. Launch the game again. The apps you left on are on, and the ones you switched off stay off.

Logs: the host writes `red4ext/logs/rednode-overlay.log` in the game folder.

**Result, 2026-10-11: passed.** Modded profile with CET. The game started the packaged host by itself (the plugin logged `started the host`); the host found the 5 apps and opened the defaults. The launcher opened Signal and Demo and closed Kit, and the choices were saved. The host closed with the game. The user confirmed the saved choices on the next launch.

### O4 HUD widgets: test

Built 2026-10-11, REDnode 0.7.0. Apps can be `"kind": "hud"`: drawn, but never focused and never in the way of a click. `"hideWith"` hides any window while the game shows a menu, photo mode, a scene or the main menu. The plugin reads those states on the game thread a few times a second and hides windows itself, so there is no delay through the host. Apps also get a `ui-state` event. 4 new unit tests cover HUD input and hiding.

| State | Read from |
|---|---|
| `menu` | The `UI_System` blackboard, `IsInMenu` |
| `photo-mode` | `PhotoModeSystem.IsPhotoModeActive()` |
| `scene` | The player's `PlayerStateMachine` blackboard, `SceneTier` 4 or higher. The threshold is **unverified**: this test calibrates it |
| `main-menu` | No player: the main menu and loading screens |

Two new apps open: **Coords HUD**, a strip at the top of the screen with V's position, and **Game state**, which shows what the plugin reads.

1. Launch the game. At the main menu, Coords HUD is **not** shown (hidden with `main-menu`); Game state shows *Main menu / loading: yes*.
2. Load a save. Coords HUD appears at the top and its numbers change as you walk.
3. **F10**, then click on the Coords HUD: the click goes through it (here, to empty screen, which ends interactive mode).
4. Open the inventory or map, then the pause menu: Coords HUD hides, Game state shows *Menu open: yes*.
5. Enter photo mode: Coords HUD hides.
6. Talk to an NPC, and if you can, trigger a cutscene. Note the **scene tier** Game state shows in each, and whether Coords HUD hid when you think it should have.
7. **F10** to hidden mode: everything hides, HUD included.

**Result, 2026-10-11: passed, with one open item.** Modded profile with CET. The HUD was hidden at the main menu, showed in gameplay with live coordinates, let clicks through, and hid with the inventory, map, pause menu and photo mode. It stayed visible while talking to NPCs, as intended: conversations are normal play, with the dialogue choices shown in the world. Hidden mode hid everything.

**Open: the `scene` threshold.** A conversation with an NPC is scene tier 2, so the threshold must be above 2, and at 4 the HUD correctly stays up in conversations. No cutscene could be triggered in this save, so whether cutscenes are tier 4 or 5, and what tier 3 is, is still unverified. Test it on a fresh playthrough, where the opening has several scenes: watch the scene tier in the Game state app and check that the HUD hides in cutscenes but not in normal conversations.

### O5 Performance: test

Built 2026-10-11, REDnode 0.8.0. Three changes, each measurable in the new **Perf** app:

| Change | What it does | Checked before the game |
|---|---|---|
| Measurement | The plugin times its own CPU work and its GPU work (timestamp queries) on every game frame, and counts the game's frame rate. The host adds its memory and CPU use. Reported once a second as a `perf` event | Builds; the Perf app shows the numbers |
| Changed areas | On the CPU path only the changed rectangle of a window is sent and uploaded | 5 unit tests; with normal apps the mock saw 20% less data. Animated apps change almost everything, so the saving is small for them |
| GPU sharing | Chromium renders into a shared GPU texture; the plugin copies it on the GPU, with no pixels through the pipe. Click-through reads each window's alpha back from the GPU up to 5 times a second. On any failure the host falls back to the CPU path | Electron 44 streamed shared textures at about 56 fps on this machine; against the mock, handles flowed and were released, and the fallback switched paths. The GPU copy itself is **untested until the game runs it** |

The launcher has a **GPU sharing** switch at the bottom to compare the two paths. The host's memory is about 60 to 100 MB per open window, because every window is its own Chromium process: 786 MB with 6 windows in the mock run.

1. Launch the game. The **Perf** window is at the top right. It should say *Render path: GPU sharing*, with *GPU-shared frames* counting up.
2. Check that every window looks right: no garbage, flicker, tearing or stale frames. Switch **Signal** on in the launcher: its ring should animate smoothly.
3. In interactive mode, click through Signal's transparent middle: click-through must still work on the GPU path.
4. Switch **Stress** on. Note the game's frame rate, the overlay's CPU and GPU times, and the host's memory and CPU.
5. Switch **GPU sharing** off at the bottom of the launcher. The windows reopen on the CPU path. Note the same numbers with Stress still on.
6. Switch GPU sharing back on and Stress off.

Logs: the plugin logs `GPU sharing failed` if it had to give up, and the host logs `Released ... shared frame(s) the game did not answer` if frames were not acknowledged.

**Result, 2026-10-12: passed.** Modded profile with CET, 3840 x 2160 SDR, REDnode 0.8.0. GPU sharing ran the whole session without falling back. All windows looked right, click-through worked through Signal's transparent middle on the GPU path, and the GPU sharing switch reopened every window on the other path and back. The host logged a perf line every 5 seconds; these are the 30-second stretches with Stress open:

| With Stress open | GPU sharing | CPU path |
|---|---|---|
| Game frame rate (gameplay) | 29 to 31 fps | 29 to 31 fps |
| Overlay CPU time per game frame | about 1.0 ms (worst 1.7 to 2.5) | about 1.0 ms (worst 1.2 to 1.6) |
| Overlay GPU time per game frame | 0.06 to 0.10 ms | 0.03 ms |
| Pixels uploaded in the game | 0 MB/s | 55 MB/s |
| Sent through the pipe | 0 MB/s | 110 MB/s |
| Host memory | about 910 MB | about 1,080 MB |
| Host CPU | 1% | 2% |

| Finding | Notes |
|---|---|
| GPU sharing removes the pixel traffic | 110 MB/s through the pipe and 55 MB/s of uploads go to zero, and the host uses about 170 MB less memory. This is what lets many animated apps run together |
| The overlay's GPU cost is tiny | Under 0.1 ms per frame on both paths |
| No visible effect on the game's frame rate | The game ran at about 30 fps in gameplay on both paths, which is too slow to show a cost of about 1 ms. Measure again in a lighter scene |
| Overlay CPU time in gameplay | About 0.7 to 1.0 ms per game frame even without Stress, against about 0.15 ms at the main menu. 3% of a frame at 30 fps, about 14% at 144 fps. A likely cause is opening every shared texture handle again each frame. To fix in O6 and check in its test |
| Unanswered shared frames at startup and while hidden | The plugin skips its work before Present is hooked and in hidden mode, so the host's one-second release frees those textures. The plugin could acknowledge them at once. To fix in O6 and check in its test |
| Focus bug found and fixed | Clicking the window that had focus before leaving interactive mode did not refocus it (seen with Signal). Fixed in `2b94a6b` with two unit tests, confirmed in the retest |

O1 to O4 make the feature usable. O5 makes it cheap. O6 joins it to the rest of REDnode. O7 hardens it.

Order agreed on 2026-10-12: [REDagent](https://github.com/Edgemodders/REDagent) (first named REDclaude), an in-game assistant powered by Claude, built as a REDnode package, comes right after O6. O7 follows it.

### O6 One runtime: plan

Agreed 2026-10-12. Node mods and overlay apps run in the same host, use the same `rednode` package and get the same answers. This also covers most of P2 (the pipe bridge and the Node SDK), and builds what [REDagent](https://github.com/Edgemodders/REDagent) needs: live game queries, mod logs and hot reload. O6 has two test gates, O6a and O6b.

**O6a Runtime**

| Piece | How |
|---|---|
| Node mods in the host | A Node mod runs in an Electron `utilityProcess`: full Node and npm, outside the game and outside the host's main process |
| Process per mod, or a shared group | By default each mod gets its own process. The player can put mods in a shared group to save memory: one process, each mod in its own worker thread. A mod author can require its own process with `"isolation": "process"` |
| Manifest | `rednode-app.json` gets `"main"` for Node code, beside `"entry"` for HTML. A package can have both |
| One `rednode` package | The same `game` API in both places. Mods `import { game } from "rednode"`. Apps import it from `rednode://sdk/index.js`, through an import map so the import line is the same |
| Events | `game.on` covers the events the plugin already sees: session attach (main menu and save load) and UI state. Events from hooked game functions stay in P2 |
| UI builder | `ui.window({ title, children: [ui.button("Apply", onClick)] })` from a Node mod. The host renders it with the UI kit; clicks and changes go back to the mod |
| Mod logs | `console.log` from a mod goes to `red4ext/logs/rednode-mods.log`, tagged with the mod id. The launcher shows a mod's errors |
| Hot reload | When a mod's files change, the host restarts that mod and reopens its windows. Always on for developers, a launcher switch for players |
| Launcher | Lists mods beside apps: on and off, the shared-process switch, the state (running, crashed, not responding) and a restart button |
| O5 follow-ups | Acknowledge shared frames at once while a window is not drawn. Split the overlay CPU time into its parts (the GPU fence wait, opening shared handles, the rest) and reuse opened shared textures |

**O6b Game API**

| Piece | How |
|---|---|
| One generic call | `rtti.call` calls any global function, static function or method by name, after checking the arguments against the game's type data, on the game thread between frames |
| Values | bool, numbers, CName, String, enums by name, TweakDBID, structs, arrays and Vector4 convert to and from JSON. Other types give an error that names the type |
| Object references | Game objects come back as `{ $ref, $type }`. The plugin holds them weakly; all are cleared on each session attach |
| Generated types | TypeScript types generated from `gameapi/2.31/rtti.json` (15,830 classes, about 52,000 functions), so calls are typed. Size and editor speed measured first |
| Hand-written calls | `player.position` and `audio.play` become thin wrappers over `rtti.call` |

| Risk | Note |
|---|---|
| Calling any game function | Type checks catch wrong types, not wrong values. A blocklist of dangerous functions may be needed |
| Object lifetime | Weak references, cleared on each session attach (unverified that this is enough) |
| Generated types size | Measured before deciding how to split them |
| Memory per mod | Measured in the O6a test, for a process per mod and for a shared group |

### O6a Runtime: test

Built 2026-10-12: plugin 0.9.0, host 0.2.0, `rednode` 0.1.0. Tested against a stand-in for the game (a mock of the plugin's pipe), packaged and unpackaged:

| Checked against the mock | Result |
|---|---|
| Hello mod's builder window and the Coords HUD app | Both show the same position from `game.player.position()` |
| A button in a mod window | Reaches the mod; `game.audio.play` reaches the bridge |
| `game.on("PlayerPuppet.OnGameAttached")` and `game.onState` | Arrive in both mods |
| Throw, hang, exit | Stop only the crash mod, in its own process and in the shared group. A hang shows NOT RESPONDING after 10 s; Restart ends it |
| Killing the shared process | All three mods show CRASHED, their windows close, and they restart 2 s later |
| Hot reload | Saving `mod.mjs` restarts the mod with the new code in about a second |
| Memory (host log, `Mod processes:`) | About 80 MB per own process; three mods in the shared process about 92 MB |
| Mod log app | New lines arrive live; a crash shows in red with only the mod's own stack lines; **Errors only** and **Copy** put the crash on the clipboard |

New in the plugin: shared frames are given back at once when nothing draws them, opened textures are reused, and the perf line splits the overlay CPU time into **GPU wait** (waiting for the frame from three frames ago) and **opening** (opening shared textures).

In the game, do these in order, with a 30-second pause after each, timed on a phone stopwatch:

1. Start the game and load a save. Stand still in gameplay for **60 seconds**. **Hello mod** sits at the right edge, the **Coords HUD** at the top: both show the same X, Y and Z, and change together when you walk.
2. **F10** for interactive mode. In Hello mod, press **Play sound**: a sound plays. Switch **Follow** off: the position stops changing. Switch it on again. Drag Hello mod by its title.
3. Open the launcher (the REDNODE tab, bottom left). Hello mod and Ticker mod show **RUNNING · own process** and their memory; Crash mod is off. Switch **Hot reload** on. Then either tell me "edit" in chat and I change Hello mod's file in the game folder, or open `red4ext\plugins\REDnode\apps\hello-mod\mod.mjs` in Notepad and change `first version` to anything, then save. Within a few seconds, Hello mod's window comes back with the new text.
4. In the launcher, switch **Mod log** on. It opens at the bottom right with every line the mods printed so far. Then switch **Crash mod** on. Its window opens at the left. Press **Throw an error**: its window closes, the launcher shows **CRASHED**, the Mod log shows the error in red, and Hello mod keeps updating. Press **Restart** in the launcher.
5. In the Mod log, switch **Errors only** on and press **Copy**. Paste it into this chat: it should be the crash and the line in `mod.mjs` that threw. Switch **Errors only** off.
6. In Crash mod, press **Hang forever**. Hello mod keeps updating. After about 10 seconds the launcher shows **NOT RESPONDING**. Press **Restart**.
7. Switch **Shared process** on for all three mods. Each restarts; the launcher then shows **shared process (3 mods)** and one memory figure.
8. In Crash mod, press **Kill the process**. All three mods show **CRASHED** and their windows close; about 2 seconds later all three are running again.
9. Press **F10** until the overlay is hidden. Wait 30 seconds. Press **F10** to come back to passive.
10. Open the inventory for 30 seconds: the Coords HUD hides, Hello mod and the Mod log stay. Close it.
11. Load a save. Hello mod's **Saves loaded** count goes up by one.
12. Quit the game.

After the test, switch **Shared process** off again if you want each mod in its own process.

What I read from the logs afterwards: `rednode-overlay.log` (the perf lines with GPU wait and texture reuse, and the `Mod processes:` memory lines every 10 seconds) and `rednode-mods.log` (everything the mods printed, and their crashes).

**Result, 2026-10-12: passed.** Modded profile with CET, 3840 x 2160 SDR, plugin 0.9.0, host 0.2.0, GPU sharing on. All 12 steps worked: the same position in Hello mod and the Coords HUD, the sound button, hot reload (the edited mod was back within a second), the Mod log with **Copy** (the pasted crash was the message plus `mod.mjs:16:13`), throw, hang and Restart, the shared process, and its automatic restart 2 seconds after Kill.

| Measured (host log) | Result |
|---|---|
| Overlay CPU time per game frame, gameplay | **0.11 to 0.15 ms**, down from 0.7 to 1.0 ms in O5. GPU wait 0.00 ms; opening textures 0.00 to 0.05 ms |
| Shared textures | Opened 0 per second once windows are up, reused 35 to 64 per second. Opening every texture again each frame was the O5 cost |
| Worst single frame | 21 to 25 ms when a window opens or closes (save load, hot reload, a mod window). Otherwise under 1.5 ms |
| Mod process, own | 97 to 102 MB at the start; about 135 MB after a reload |
| Three mods in the shared process | 151 to 155 MB, against about 370 MB in three own processes |

| Finding | Notes |
|---|---|
| The overlay's CPU cost is solved | Reusing opened shared textures cut it about sevenfold. Waiting for the GPU was never the cause |
| Cursor sometimes disappeared in interactive mode | New in this test. The plugin log shows interactive mode ending by itself, then F10 presses. Likely cause: with GPU sharing the click-through map is read back at most 5 times a second, and only when a frame arrives. A window that stops repainting right after it opens keeps the map of a half-drawn first frame, so a click on it falls through to empty screen and ends interactive mode. **Fixed:** the plugin now reads back the newest frame once the 5-a-second limit allows, even if no new frame comes. To check in the next test |
| Frames still waiting a second while hidden | 1 to 4 per switch to hidden. Frames already copied in the last three game frames were only acknowledged when drawing resumed. **Fixed:** they are given back as soon as the GPU is done with them. To check in the next test |
| Ticker mod stopped once | Not a bug: the tester switched it off, on and off again in the launcher around 18:34:28. Stops were not logged then, so it looked silent. The mod log now records every move, start and stop. A related race, found while looking, is closed |
| A hitch when a window opens or closes | The plugin waits for the GPU to finish before it replaces or frees a window's texture. A follow-up for O7: release textures through the frame ring instead |
| Log times were UTC | Now local time, like the player's clock |
| Windows hidden with the game's UI lose their texture | A page that does not repaint by itself could stay invisible after a menu closes. The host now repaints every window when the game's UI state changes. Not seen in the test: Coords repaints every half second |


### O6b Game API: test

Built 2026-10-12: plugin 0.10.0, host 0.3.0, `rednode` 0.2.0. Checked against a stand-in for the game: the SDK's calls, references and releases (11 checks), and the two samples, which agreed on the values and showed a change made through `GiveItem` in both. The plugin side, where the calls really happen, is new in this test. JSON parsing has 17 unit tests.

| Piece | What it does |
|---|---|
| `rtti.call`, `rtti.get`, `rtti.release` in the plugin | Call any game function by name, read a property, drop references. Arguments are checked against the game's types first; a crash inside the call fails the call |
| `api` in the `rednode` package | The same calls as typed JavaScript: `api.GetPlayer(...)`, `api.GameInstance.GetStatsSystem(...)`, `player.GetEntityID()` |
| Generated types | `tools/gameapi/types.mjs` turns `gameapi/2.31/rtti.json` into 9 MB of TypeScript: 15,830 classes, 1,524 enums, 802 global functions. It builds in under a second, type-checks in under two, and has no errors even with `skipLibCheck` off. Not committed: the package build generates it |
| `game` helpers | `player.position`, `audio.play`, and the new `player.getHealth` and `player.setHealth` are built on `api` now |
| **Vitals** app | A HUD widget under the Coords HUD: V's health, level and money, read through `api` from a web page |
| **Game API mod** | The same three values from Node, plus **Give 100 eddies**, **Wrong argument type** and **Use the player from before** |
| Theme selector | The launcher's **Theme**: REDnode, Game red, or the new Yellow, with solid yellow title bars. Every window that uses the UI kit follows it at once, unless the app chose its own theme |

In the game, do these in order, with a 30-second pause after each:

1. Start the game and load a save. **Vitals** sits under the Coords HUD and shows **HP**, **LVL** and **€$**. The **Game API mod** window at the left shows the same three values. Hello mod and Coords still show V's position, now through the generic API.
2. Compare with the game: HP with the health bar, then open the character screen for the level and the inventory for the money (Vitals hides while a menu is open). Close the menu.
3. **F10** for interactive mode. In the Game API mod, press **Give 100 eddies**. Both money values go up by 100, and the game may show its own money notification.
4. Press **Wrong argument type**. The mod shows "Refused, as it should be:" and the reason. Nothing happens in the game.
5. Press **Use the player from before**. It shows "Still valid" and V's position.
6. In Hello mod, press **Play sound**: the sound now goes through the generic API.
7. **Themes.** In the launcher, at the bottom, press **Yellow**: every window's title bar turns solid yellow at once. Press **Game red**: the windows turn red. The Coords HUD, Vitals and Native button stay red in every theme, because they choose the game theme themselves. Pick the one you like; it is saved.
8. **Cursor check, carried over from O6a:** open the **Mod log** and switch **Crash mod** on in the launcher. As soon as Crash mod's window appears, click inside it a few times on its text and between its buttons, without pressing a button. The cursor should stay, and interactive mode should not end.
9. Switch Crash mod off again. Press **F10** until the overlay is hidden, wait 30 seconds, then **F10** back to passive.
10. Get hurt a little, for example a fall: HP drops in both Vitals and the mod.
11. Load a different save. Then press **Use the player from before** in the Game API mod: it should now say "that game object no longer exists". The values update for the new save.
12. Quit the game.

What I read afterwards: `rednode-mods.log` (the mod's calls and errors), the plugin log (any `rtti.call` crash lines), and `rednode-overlay.log` (no "Released ... shared frame(s)" lines while hidden, and no interactive mode ending by itself).

**Result, 2026-10-12: passed**, after two fixes in the first run. Modded profile with CET, 3840 x 2160 SDR, plugin 0.10.0, host 0.3.0, GPU sharing on. All 12 steps worked: Vitals and the Game API mod showed the same health, level and money as the game; **Give 100 eddies** added 100 to both, twice; the wrong argument was refused with "argument 1 (objID, gameStatsObjectID): gameStatsObjectID needs an object of its properties"; the player reference was still valid in the same save and "no longer exists" after loading another; sounds played through the generic API; the three themes switched live; and the plugin logged no crash inside a game call.

| Finding | Notes |
|---|---|
| `GetPlayer` returned null through the generic API | A `GameInstance` argument built from the type data has no game in it. **Fixed:** the plugin fills it in with the running game (`37ade5d`). See the [ScriptGameInstance note](game/t/ScriptGameInstance.html) |
| The launcher and Coords did not show until repainted | Frames that arrive before Present is hooked are given back undrawn, and a page that does not repaint never showed. **Fixed:** once it starts drawing, the plugin asks the host to repaint every window (`37ade5d`) |
| The sample's "player from before" was already invalid | It kept a reference polled during the load, just before the plugin dropped every reference. **Fixed** in the sample by hot reload, with the game running (`00fdc6d`): take references after `PlayerPuppet.OnGameAttached` |
| O6a's cursor fix holds | Clicking around Crash mod's window right after it opened kept interactive mode. Mode changed only on purpose (F10, Esc, clicks on empty screen) |
| O6a's hidden-mode fix holds | No shared frame waited for the host's sweep while hidden, including 23 seconds at 16:25. The few left fall in loading screens and at game exit, when the game stops presenting |
| Overlay CPU time | 0.11 to 0.15 ms per game frame in gameplay with every app open, as in O6a |
| Not tested in game | `game.player.setHealth` (`RequestSettingStatPoolValue`), out parameters, and `rtti.get`. **Unverified** |

O6 One runtime is done: Node mods run beside overlay apps, both use the `rednode` package, and `api` reaches any game function. Next: [REDagent](https://github.com/Edgemodders/REDagent), then O7 Display.

### O8 Mod Manager: plan

Agreed with the user on 2026-10-13, to come after REDagent's C4 test and before C5 or C6. The launcher's single list works for a handful of packages; with dozens it is overwhelmed, and REDagent makes new packages easily. REDdeck, the pre-launch mod manager for game mods (archives), stays separate: the Mod Manager manages REDnode packages, in the game.

| Piece | What it does |
|---|---|
| The Mod Manager app | Built into REDnode, like the Mod log, and always pinned: the first entry in the launcher, never hidden |
| The table | One row per package. Columns: pin, name, kind (app, Node mod, HUD widget), status (running, crashed, off), memory, own or shared process, version, author. Click a header to sort |
| Finding a package | A search box (name, id, author, description) and filters (kind, on or off, errors). About 20 rows a page, with paging |
| Details | The selected package: description, permissions with their **Allowed** switches, the last log lines, **Restart**, **Shared process**, **Show** for a closed window, hot reload. Launcher rows can shrink to a name and a switch |
| Bulk actions | Select several: on or off, into or out of the shared process |
| **Pin to launcher** | Only pinned packages show in the launcher. The packages installed when O8 ships start pinned; new ones start unpinned, and the launcher shows a "2 new" link to the Mod Manager. A crashed package shows in the launcher even when it is not pinned, so an error never hides. Saved in the host's settings as "in launcher" (in the code, "pinned" already means a built-in that cannot be switched off) |
| **Pin to HUD** | Whether a package's windows stay on screen during gameplay (passive mode), or show only while the player interacts (F10). Today every window shows in passive mode. HUD widgets always stay. To decide with the user: the default for new packages (recommended: off, so new windows do not clutter gameplay) and whether existing packages start pinned (recommended: yes, nothing changes for them). Needs a small plugin change: the plugin skips unpinned windows in passive mode |
| For agents | The kernel MCP server's `apps` tool gains the pins, so REDagent can pin a package it made |

No new game API is needed: the host already has the package list, status and memory the launcher shows.

Decided with the user on 2026-10-13: packages installed when O8 first runs keep both pins (nothing changes for them); packages found later start with neither.

### O9 Debugger: plan

Agreed with the user on 2026-10-13, to come after REDagent's C5 test. Apps are Chromium pages in the overlay host, so Chromium's own DevTools already exist for them; Node mods run in Node and need its inspector.

| Step | What it builds | Notes |
|---|---|---|
| 1. Inspect in a desktop window | An **Inspect** button in the Mod Manager's details (and the MCP `apps` tool's details) opens the real DevTools for that app's page: elements, console, network, sources, breakpoints. A mod's builder window can be inspected the same way | One Electron call (`webContents.openDevTools({ mode: 'detach' })`). The window is a normal desktop window: a second monitor, or Alt+Tab |
| Debug icon on title bars | With **Developer mode** on (a launcher switch, off by default so players never see it), every window built with the UI kit's `rn-window`, and every mod window, shows a debug icon beside its close button. It opens the debugger for that window's app: the in-overlay Debugger once step 2 works, the desktop DevTools until then | Asked for by the user on 2026-10-13. The icon goes through the same path as **Inspect**, so there is one way to open the debugger |
| 2. DevTools inside the overlay | A built-in **Debugger** app: the same DevTools drawn in the game as an overlay window, dragged and resized like any app | DevTools is itself a page; Electron can send an app's DevTools into another window's page (`setDevToolsWebContents`), which the host renders off screen like any app. **Unverified** with off-screen rendering: a prototype first. If it fails, step 1 stays and a light Console app (live console output and errors per app, and a line to run JavaScript in a chosen app or mod) takes its place |
| 3. Node mods | A **Debug** switch per mod: the host starts its mod process with Node's inspector on a local port and shows the address to attach to from VS Code or REDcode, with breakpoints in the mod's own files | The shared process stops every mod in it at a breakpoint, so a debugged mod runs in its own process. Fits with REDagent C6 (REDcode) |
| For agents | The kernel MCP server gains an app's console messages and errors, so REDagent can read them | |

### O8 Mod Manager: built

| Piece | Where |
|---|---|
| Mod Manager | `packages/overlay/manager/`, a built-in app (`modmanager`). A table of every package, 14 rows a page: pins (L, H), name with a NEW badge, kind, status, memory, version, author. Search (name, id, author, description), kind and state filters (on, off, errors, new), sorting by any column, a details panel (switches, permissions, Show for closed windows, last error, last lines), and bulk actions on ticked rows. Its own close button closes it |
| Pins | The host keeps `inLauncher`, `onHud` and `seen` per package in `settings.json`. The first start seeds every package already installed with both pins (`pinsSeeded`). `rednode:apps:pin` and `rednode:apps:seen` for the launcher and the Mod Manager; the MCP `apps` tool gains `pin-launcher`, `unpin-launcher`, `pin-hud` and `unpin-hud` |
| Launcher | Lists the Mod Manager first, then packages pinned to it, and any crashed package. A line above the list says how many more are in the Mod Manager and how many are new, with **Open** |
| Plugin 0.14.0 | `window.open` takes `onHud`, and `window.hud` changes it. A window not on the HUD is left out of the drawn windows in passive mode. The host repaints every window when the mode changes, so one that appears has a frame |

Tested in the mock game with 35 dummy packages: the first start seeded the 46 packages then installed with both pins; 5 added later showed as new and unpinned, and the launcher said "5 more in the Mod Manager · 5 new". Opening the Mod Manager cleared "new" in the launcher. The New filter listed the five; pinning one to the launcher listed it there. Search found the Hello mod, and its Pin to HUD switch sent `window.hud` to the plugin. The plugin's hiding rule has unit tests.

### O8 Mod Manager: test

Use the **Test timer**: Start, then Mark after each step.

1. Close the game. Deploy REDnode. Start the game and load a save. Every package you had is still in the launcher, and the Hello mod still shows during gameplay. Mark.
2. F10, open the launcher: **Mod Manager** is first. Switch it on. Mark.
3. In the Mod Manager: sort by a column, search "hello", try the filters, and page through with **Next**. Mark.
4. Select the Hello mod. Switch **Pin to HUD** off, press F10 until passive: the Hello mod window disappears; F10 to interactive: it is back. Pin it again. Mark.
5. Unpin something from the launcher in the table (**L**): it leaves the launcher, which now says "1 more in the Mod Manager". Pin it back. Mark.
6. Tick two or three rows and use a bulk action, such as **Off** then **On**. Mark.
7. Ask REDagent to make a small new app. When it appears, the launcher says "1 new"; open the Mod Manager and find it with the **New** filter. Mark.
8. Close the Mod Manager with its close button: the launcher shows it off. Quit the game.

**Result, 2026-10-13: passed.** Plugin 0.14.0, 3840 x 2160. Everything installed before kept both pins. The Mod Manager opened from the launcher; sorting, search, filters and paging worked. The Hello mod, unpinned from the HUD, left the screen in passive mode and came back in interactive mode, twice; Coords left the launcher and came back. REDagent made a new app ("clock"): the launcher counted it as new, the New filter found it, and it was pinned to the launcher. The Test timer marked steps 1 to 7.

| Finding | Notes |
|---|---|
| The cursor flickered or disappeared more often | The player switched to the desktop (Alt+Tab) often during this test. The plugin draws its own cursor in interactive mode, moved by the game's raw mouse input. Two likely causes, **unverified**: raw input that arrives while the desktop is in front moved the overlay's cursor, and the click that brings the game back counted as a click on empty screen, which leaves interactive mode (one switch from interactive straight to passive at 06:22:59 fits). **Changed in plugin 0.14.1:** input that arrives while another window is in front is ignored, buttons are ignored for 300 ms after the game comes back to the front, and the plugin logs "Overlay: the game left the front" and "came back to the front". **Confirmed in the C5 test (2026-10-13):** about 25 switches to the desktop and back in interactive mode, and the overlay stayed interactive every time |

### O9 Debugger: built

REDnode 0.16.0. Every step of the plan works in the mock game; the in-overlay DevTools is no longer unverified there, but still needs the in-game test.

| Piece | Where |
|---|---|
| Window debugger | The host gives an app's page (or a mod's builder window) its DevTools: in the game, a built-in window whose own page becomes that DevTools (`setDevToolsWebContents`, then `openDevTools({ mode: 'detach' })`), with a REDnode title bar the host adds (drag area and close); on the desktop, DevTools' own window, opened without taking focus. A first try put DevTools in a `webview` inside a page, as Electron's example does: off screen it painted once and took no input |
| Mod Manager | Details: **Window debugger** (In the game, On the desktop) for a package with a window; for a Node mod, the **Debug (Node inspector)** switch, then the inspector's address with **Copy**, and **Node debugger** (In the game, On the desktop). **Shared process** waits while Debug is on |
| Node mods | Debug on restarts the mod alone in its own process (`debug:<id>`); its worker opens Node's inspector itself (`inspector.open(0, '127.0.0.1')`), so a debugger attaches to the mod's own thread. Opening the inspector for the whole process (`--inspect`) attached to the runner's main thread: Chromium's DevTools does not show Node worker threads |
| Node debugger | Chromium's DevTools for Node (`devtools://devtools/bundled/js_app.html?ws=...`) in an overlay window with the same title bar. `preload.js` hides the "internal" context Node adds when it loads an ES module, so the console starts in the mod's context. After a restart (new address) the in-game debugger reopens by itself, and it closes when Debug goes off |
| Stopping a debugged mod | Node cannot end a worker while a debugger is attached to it (`terminate()` and even `process.exit` hang; found in testing), so a debugged mod stops by ending its process |
| Developer mode | A launcher switch, saved in settings, off by default. On, every `rn-window` shows a debug button next to close (`no-debug` hides it). It opens the Node debugger for a mod window whose mod runs with Debug on, otherwise the window debugger |
| For agents | The MCP `window_console` tool: the last 200 console messages and uncaught errors of a window, by level |
| From 0.15.1, to check in game | 64 windows instead of 16 (the World test window that stayed hidden), and the perf log's game-call timing |

Tested in the mock game: the window debugger in the game and on the desktop (Elements and Styles live; the Console evaluated in the page; the close button); Developer mode put the debug button on the Hello mod window, and it opened the window debugger; Debug on restarted the Hello mod with an inspector, the Node debugger showed the mod's own `console.log` lines, and its console answered `require('node:worker_threads').threadId` with 1 (the mod's worker); **Restart** with the debugger attached stopped and started the mod, and the debugger reconnected; Debug off closed it and the mod went back to a normal process; `window_console` returned a warning typed into the page's console. Breakpoints were not tried in the mock. **Unverified** in the game.

### O9 Debugger: test

Use the **Test timer**: Start, then Mark after each step.

1. Close the game. Deploy REDnode. Start the game and load a save. Switch the **World test** on in the Mod Manager: its window shows straight away (64 windows). Mark.
2. F10. In the Mod Manager, select **Coords** (or any app with a window). **Window debugger: In the game**. A debugger window opens with Elements. Click **Console**, type `document.title` and Enter. Close the debugger with its ✕. Mark.
3. Same, **On the desktop**: a DevTools window opens on the desktop without taking the game's focus. Alt+Tab to it, look, close it, and come back. Mark.
4. In the launcher, switch **Developer mode** on. Every window's title bar shows a bug button next to close. Click it on the Mod Manager or the launcher window: its debugger opens. Close it. Mark.
5. In the Mod Manager, select the **Hello mod** and switch **Debug (Node inspector)** on. The mod restarts and an address appears. **Node debugger: In the game**. Click **Play sound** in the Hello mod window: the line "Sound button pressed 1 time(s)" appears in the debugger's Console. Mark.
6. In the Node debugger, **Sources**, Ctrl+P, type `mod.mjs`, Enter. Click the line number of `presses += 1;` (line 28) to set a breakpoint. Click **Play sound**: the debugger stops on that line and no sound plays. Press the Resume button (or F8): the sound plays. Click the line number again to remove the breakpoint. Mark.
7. **Restart** the Hello mod in the Mod Manager: the Node debugger reopens on its own. Then switch Debug off: the debugger closes and the mod keeps working. Mark.
8. Switch Developer mode off: the bug buttons go. Quit the game.

Afterwards I read the logs: the debugger lines, and the perf lines with game calls.

**Result, 2026-10-13: passed.** REDnode 0.16.0, 3840 x 2160. Every step worked, and the Test timer marked steps 1 to 7.

| Check | What the logs show |
|---|---|
| 64 windows | The World test window opened at start beside every other app; no window was refused |
| Window debugger | Coords' debugger opened in the game and on the desktop; the bug buttons opened two more, each closed with its ✕ |
| Node debugger | Debug on restarted the Hello mod in its own process with an inspector. The Console showed its "Sound button pressed" lines. The breakpoint on line 28 held the third press for about 30 seconds, until Resume |
| Restart and Debug off | Restart reopened the debugger on the new address within the same second; Debug off closed it and moved the Hello mod back to the shared process |
| Game-call timing (0.15.1) | About 34 game calls a second, costing 0.5 to 0.9 ms a game frame (worst 4.4 ms; 16 ms while a save loaded). The game ran between 30 and 65 fps throughout, unrelated to the calls, so game calls do not explain W1's frame-rate drop. **Unverified** what does |

| Finding | Change |
|---|---|
| The debugger's title bar stayed in the REDnode theme while the player had picked Yellow | REDnode 0.16.1: the host draws it in the player's theme and changes it with the theme |
| Asked for by the user: rename the themes | REDnode 0.16.1: "Game red" is now **HUD red** (`hud`) and "Yellow" is **EDGE** (`edge`). The old names `game` and `yellow` still work in pages and in saved settings |

### O10 Layers: built

Agreed with the user on 2026-10-14, before the TweakDB API: EDGEbuilder's full-screen Edit mode covered the Test timer, so its Mark could not be pressed ([#10](https://github.com/Edgemodders/REDnode/issues/10)), and it needs the other packages' windows out of the way while placing objects ([#7](https://github.com/Edgemodders/REDnode/issues/7)). The user chose the recommended answers: built-ins plus packages the player allows for the tool layer, and a permission for solo mode. REDnode 0.18.0.

| Piece | Where |
|---|---|
| Tool layer | Plugin: each window has a layer; the window list keeps packages' windows before tool windows, so tool windows are drawn above them and hit-tested first, and a click brings a window only to the front of its own layer. `window.open` takes `"layer":"tool"`, and `window.layer` changes it. Host: the launcher, Mod log, Mod Manager and debuggers are tools; so is any package granted the new `front` permission ("staying above other packages' windows"), such as the Test timer. Granting or withdrawing it moves the package's windows at once |
| Solo mode | `ui.solo(true)` / `ui.solo(false)` and `ui.onSolo(handler)` in the `rednode` package, for Node mods and pages, behind the new `solo` permission. While on, the host sends `window.hidden` for every other package's window and HUD widget (tool windows stay), and new windows open hidden. It ends when the package turns it off, stops or crashes, another package takes it, the player withdraws the permission, or the player presses **End** beside the launcher tab, which shows "SOLO" and the package's name |
| Plugin | Hidden windows are neither drawn nor hit-tested; hiding one drops its focus, hover and drag. Unit tests: a tool window stays above a package window opened after it and gets the input over it, a click raises a package window only within its layer, `window.layer` moves a window to the front of the tool layer, a hidden window is not drawn and takes no input |
| Samples | `apps/layers-test`: a full-screen page with a 4% tint that takes the mouse, with Solo on and Solo off. `apps/timer` asks for `front` |

Tested in the mock game: the launcher, Mod Manager and Test timer (with `front` allowed) opened as tools, the Layers test and the Hello mod as package windows. **Solo on** hid the Hello mod's window and not the Test timer; the page heard the change; the launcher tab showed "SOLO Layers test" with **End**, which ended it. Hit testing above a full-screen page is covered by the plugin's unit tests; the mock game does not hit-test. **Unverified** in the game.

### O10 Layers: test

Use the **Test timer**: Start, then Mark after each step.

1. Close the game. Deploy REDnode. Start the game and load a save. Mark.
2. F10. In the Mod Manager, select the **Test timer** and allow **staying above other packages' windows**. Select **Layers test**, allow **solo mode**, and switch it on: a faint tint covers the screen. Mark (the timer is clickable above the tint).
3. Click the tint, then click the launcher tab, the Mod Manager and the Test timer: each still takes the click, above the tint. Open the Hello mod: the tint stays above it once the tint is clicked, but the timer and launcher stay on top. Mark.
4. In the Layers test window, press **Solo on**: the Hello mod and any HUD widget (Coords, Vitals) disappear; the launcher tab shows "SOLO Layers test". Mark.
5. Press **End** beside the launcher tab: everything comes back, and the Layers test says "Solo: off". Press **Solo on** again, then switch the Layers test off in the Mod Manager: everything comes back. Mark.
6. Checks from 0.17.1: the Mod Manager's Packaging test lists ArchiveXL as "not installed" if its DLL is gone (#9); the World test's **Spawn box** shows the level-design kit's orange box (#6). Mark.
7. Quit the game.

**Result, 2026-10-14: passed.** REDnode 0.18.0. Every step worked, with the Test timer's Mark pressed above the Layers test's full-screen tint (steps 2 to 6 marked). The tool layer kept the launcher tab, the Mod Manager and the Test timer clickable above the tint; Solo on hid the other packages' windows and HUD widgets, and End and switching the package off both brought them back. The World test spawned and removed its box from base-game assets only, in about 200 ms, with its entity events.

| Finding | Change |
|---|---|
| A Node mod's window closed with its close button came back at the next start of the game. Closing an app's own page saved "off", but a mod opens its windows again at every start | REDnode 0.18.1: the host keeps the player's closed mod windows in its settings (`closedWindows`). A mod that opens such a window gets it closed, as if the player had just closed it, and the launcher and Mod Manager offer **Show**, which takes it off the list. Switching the mod off and on again shows its windows again |
| The World test's box spawned black. The level-design kit's `box_1_1_1_snappoints_orange.mesh` has one appearance whose only material is an untextured editor material (`metal_base.remt`), read through REDbridge | REDnode 0.18.1: the World test spawns `cardboard_box_a_closed.mesh`, a base-game box with textured multilayered materials |
| ArchiveXL showed as installed | Correct: the player had deployed it again, so its DLL was back. The #9 rule (a plugin folder without a DLL is not installed) was checked against the folder while the DLL was missing |

### O11 Spaces: plan

Proposed by the user on 2026-10-14, after O10: HUD apps will crowd the screen, and today the only way to thin them is to switch packages off and on in the Mod Manager. Order decided with the user on 2026-10-14: after O10's test and the TweakDB API. Built in REDnode 0.21.0: see [O11 Spaces: built](#o11-spaces-built).

Called **spaces**, not layers: "layer" already means the z-order (the tool layer above packages' windows, O10).

| Piece | Plan |
|---|---|
| Spaces | Named by the player; one, "Main", to begin with. A window belongs to one space or to all of them. Tool windows show in every space. Kept per window (a package with several windows places each), keyed like saved positions |
| Switching | On the launcher tab: `REDNODE · 4/20  ▾ Main`, a list of spaces with **New space**. A hotkey to cycle spaces (to choose: such as F10 then 1 to 9). Gamepad later |
| Moving a window | From its title bar (see below), and a Space column in the Mod Manager for moving many at once |
| No cost until used | Until the player makes a second space, nothing new shows: no switcher, no title-bar control |
| Mechanics | The host hides the other spaces' windows with `window.hidden`, as solo mode does (O10). Solo wins over the space. Windows in other spaces could pause rendering, which a switched-off package cannot do without losing its state |
| Pin to HUD | Pin to HUD decides gameplay versus interactive mode; a space decides which set shows at all. They combine. To decide: keep both, or make Pin to HUD a per-space setting |

**The title-bar controls** (decided below). A window's title bar has close, and the debug button in Developer mode. Spaces add "move to space", and more may follow (reset position, roll up). Two shapes, to try as mockups before choosing:

| Shape | For | Against |
|---|---|---|
| A few icons, like a desktop window's minimize, maximize and close | One click for what is used often | More than three or four clutter every window |
| One menu button holding the actions | One small button, however many actions | Two clicks for frequent actions, and an action with its own choices (which space) becomes a menu inside a menu |

Rules either way, agreed in principle with the user: no cascading menus; at most a few icons on a title bar; a frequent action stays one click. A middle way to mock up too: a direct icon only for the frequent action (the space icon opens the list of spaces, one level), with rarer actions in a menu.

**Decided with the user on 2026-10-14, after interactive mockups of the three shapes (A every action an icon, B icons with overflow, C one menu): B, an icon row with overflow.** Close and up to three action icons, flowing right to left: close on the far right, the most used action next to it. A window with more than three actions gets a **⋯** button on the far left, holding the rest, each with its icon and its name. So a title bar shows at most five buttons (⋯, three actions, close), and ⋯ only appears when there are more than three actions. To revisit if it does not work well in practice.

| Question | Proposal |
|---|---|
| Which actions get the icon slots | Close always, rightmost. The others by a fixed priority, highest nearest close (in the mockup: move to space, roll up, pin to HUD, reset position, debug). An action that is not available (debug outside Developer mode, spaces with only one space) takes no slot, so most windows show close and little else |
| An action with choices in the overflow (move to space) | The ⋯ list swaps to the choices, with a back row, instead of opening a second menu beside it: one level on screen at a time |
| Width on small windows | Five buttons at 22 px with their gaps take about 140 px of the title bar; the title shortens with an ellipsis on narrow windows |

### O11 Spaces: built

REDnode 0.21.0. Decided with the user on 2026-10-14 besides the title bar: Pin to HUD stays as it is beside spaces (a space picks which windows show at all; Pin to HUD which of them stay during gameplay), and Ctrl+1 to 9 switches spaces while the overlay is open.

| Piece | Where |
|---|---|
| Spaces | The host keeps `settings.spaces`: the names, the current one, and the space of each window (by its id) or of a whole package (by the package's id; a window's own choice wins). A window with no space yet joins the current one when it first opens, so nothing moves for a player who never makes a second space. Tool windows show in every space. A space hides windows with the plugin's `window.hidden` (O10); solo mode wins over the space while it lasts |
| Launcher | A **Space** row in its settings: the current space, **New**, **Rename**, **Delete** (with a name field, since overlay pages have no dialogs). Deleting a space moves its windows to the first space. Once there is a second space, the tab shows **▾ name**, a list of the spaces with their Ctrl+number |
| Ctrl+1 to 9 | The host catches Ctrl+number before the page, switches space, and drops the digit the key would type |
| Title bar (UI kit `rn-window`) | Close and up to three action icons, right to left, most used next to close: move to space (with a second space), roll up, pin to HUD, reset position (after a window was moved), debug (Developer mode). More than three: ⋯ on the far left holds the rest; an action with choices swaps the ⋯ list for its choices with **‹ Back**. The menu floats over the page, so a short window does not cut it off. The overlay-window actions (space, pin, reset) show only on a page's only `rn-window`. `no-space`, `no-rollup` and `no-debug` hide one action for a window. The old debug button is now the debug action |
| Mod Manager | A **Space** column, shown once there is a second space, and **Main / ... / All** buttons in a package's details to move the whole package |

Tested in the mock game: **New** made "Combat" and switched to it, which hid the Hello mod (in Main); Ctrl+1 brought Main back and the Hello mod with it. Its title bar showed the space icon next to close; the list held Main (current), Combat and All spaces; picking Combat hid it, and Ctrl+2 showed it again. With Developer mode on and a saved position, five actions made the title bar show ⋯, pin, roll up, space and close, and ⋯ held Reset position and Debug. The Mod Manager showed the Space column (Combat) and the space buttons. **Unverified** in the game.

### O11 Spaces: test

Use the **Test timer**: Start, then Mark after each step.

1. Close the game. Deploy REDnode. Start the game and load a save. Mark.
2. F10. In the launcher's settings, **Space**: press **New**, type `Combat` and Enter. The tab shows **▾ Combat**, and every package window and HUD widget goes away; the launcher, Mod Manager and Test timer stay. Mark.
3. Ctrl+1: Main comes back with everything in it. Ctrl+2: Combat again. Then Ctrl+1. Mark.
4. On the Hello mod's title bar, the space icon is next to close: choose **Combat**. The Hello mod goes; Ctrl+2 shows it; Ctrl+1. Mark.
5. In the Mod Manager, the **Space** column shows each package's space. Select Coords and press **All**: it shows in Main and in Combat. Mark.
6. On a window, try roll up and the pin (Pin to HUD) on its title bar. Drag it, then use **Reset position**. Switch Developer mode on: ⋯ appears on the far left with the actions past three. Mark.
7. In the launcher, **Rename** Combat to `Driving`, then **Delete** it: its windows come back to Main. Mark.
8. Quit the game.

**Result, 2026-10-14: passed.** REDnode 0.21.0. Every step worked, marked 1 to 7, with no page errors. The host log shows each one: Combat made and switched to; Ctrl+1 and Ctrl+2 switching back and forth; the Hello mod moved to Combat from its title bar; Coords put in every space from the Mod Manager, back to Main and to every space again; the Mod Manager pinned to the HUD and its position reset from title bars; Combat renamed to Driving, then deleted, its windows moved to Main. The title-bar shape (close, three action icons, ⋯ past three) is to be revisited only if it does not work well in practice.

### O12 Console: plan

Proposed by the user on 2026-10-15: Cyber Engine Tweaks has a console where players type Lua; REDnode has none. Not scheduled; its place in the order is to be agreed.

**Why not the debugger's console (O9).** It is a tool for fixing one package: it needs Developer mode, a Node mod restarts with its Debug switch on, the code runs inside that package with its own variables, and it is Chromium's DevTools, dense and desktop-styled. The console is the game's command line: one key away for any player, one shared scratch context with every part of REDnode ready, in the HUD style.

| Piece | Plan |
|---|---|
| The window | A built-in tool (it stays above packages' windows, O10): an input line, the output above it, history with the up and down arrows, multi-line input with Shift+Enter, Clear. Opened from the launcher and with a key in the overlay (to choose; CET uses the key under Esc) |
| Where code runs | A built-in Node mod of its own, so a crash or an endless loop stops only the console: each line runs in one shared context, with top-level `await`, and variables kept between lines. `game`, `api`, `tweakdb`, `world`, `ui`, `agent` and the rest of the `rednode` package are in scope without imports |
| Results | Values printed readably: numbers, strings and objects folded and unfolded; game objects as their type and reference, so the next line can call them (`$1.GetDisplayName()`); errors in red with the line. `console.log` from the line shows in the output |
| Help | Completion from REDnode's generated game types (the same types `api` uses): global functions, a class's static functions, an object's methods once its type is known. The game API reference one key away for the word under the cursor |
| Undo | TweakDB changes made from the console go through the undo journal like any package's (T2), and are undone when the console's mod stops, or with a **Revert my changes** button |
| For agents | The kernel MCP server could offer the same evaluation (an `eval` tool), behind the player's OK, since it can change the game. To decide |

Questions to settle first: the key that opens it, whether players who never turned on Developer mode get it (CET gives its console to everyone), and whether scripts can be saved and run again (a "snippets" list) in the first version.

### Pointer lock: built

Asked for by EDGEbuilder ([#11](https://github.com/Edgemodders/REDnode/issues/11)) for its editor camera, which turns while the right mouse button is held: the cursor must stay put and the mouse keep turning the view. REDnode 0.22.0.

| Piece | Where |
|---|---|
| Plugin | `pointer.lock` and `pointer.unlock` for a window. Only the window in use may take it (the focused one, or the one a button is held on) in interactive mode. While locked, the cursor stays where the lock began and is not drawn, and the mouse's raw movement goes to that window as `mouseMove` with `dx` and `dy`; buttons and the wheel still reach it. Esc ends the lock (and goes no further, as in a browser); so do leaving interactive mode, the window closing or being hidden, and another window taking the lock. The plugin reports each start and end, with why, as `pointer-lock`. The middle mouse button now reaches pages too. Unit tests for each rule |
| Host and page | Pages use the web's own Pointer Lock API: `requestPointerLock()`, `document.exitPointerLock()`, `document.pointerLockElement`, `pointerlockchange` and `pointerlockerror`. Chromium drawn off screen cannot hold a real cursor, so `preload.js` puts in its own versions, which ask the plugin. Chromium also drops `movementX` and `movementY` from injected moves (found in testing), so the host sends the raw movement as a message and the page's code dispatches `pointermove` and `mousemove` on the locked element, with the movement in `movementX` and `movementY` |
| Sample | `apps/pointer-test`: hold the right button on its pad to turn a camera; it shows the yaw and pitch |

Tested in the mock game: a right-button press on the pad locked the pointer, five moves of 40 by -20 turned the camera by 30 degrees of yaw and 15 of pitch (0.15 degrees per unit), and letting go ended the lock ("the page let go"). **Unverified** in the game: the plugin's held and hidden cursor and its raw movement.

### Pointer lock: test

Use the **Test timer**: Start, then Mark after each step.

1. Close the game. Deploy REDnode. Start the game and load a save. Mark.
2. F10. In the Mod Manager, switch on **Pointer lock test**. Hold the right mouse button on its pad and move the mouse: the cursor goes and stays where you pressed, Yaw and Pitch change smoothly, and they keep changing however far you move. Let go: the cursor is back where you pressed. Mark.
3. Hold the right button again and press Esc while holding it: the lock ends and the cursor comes back, and the overlay stays interactive. Mark.
4. Hold the right button and press F10: the lock ends with interactive mode. Mark.
5. Quit the game.

### UI kit

UI is written as markup, not built by hand in code. Two layers keep it optional:

| Layer | What it is | Required? |
|---|---|---|
| Window API, in `rednode` | Open, place, show and hide windows (`kind`, `size`, `anchor`, drag handles, `hideWith`), plus the game bridge | Used by every app |
| UI kit, `@rednode/ui` | Ready-made widgets as web components, with two themes | Optional. Apps can use their own HTML or any web framework |

Web components (custom elements like `<rn-button>`) work in plain HTML, React, Vue or anything else. Their styles are sealed in Shadow DOM, so app CSS cannot break them, and themes are CSS custom properties.

```html
<!-- A titled REDnode window with widgets in it (kind: window) -->
<rn-window title="Weather control" draggable>
  <rn-toggle label="Freeze time"></rn-toggle>
  <rn-slider label="Rain" min="0" max="100"></rn-slider>
  <rn-button>Apply</rn-button>
</rn-window>

<!-- A borderless button that looks like part of the game (kind: hud or window) -->
<body style="background: transparent">
  <rn-button theme="hud" sound="ui_click">Open stash</rn-button>
</body>
```

| Item | Plan |
|---|---|
| First widgets | `rn-window`, `rn-panel`, `rn-button`, `rn-toggle`, `rn-slider`, `rn-input`, `rn-list`, `rn-tabs`, `rn-menu`, `rn-progress`, `rn-tooltip`, `rn-notification` |
| Theme `rednode` | The REDnode HUD house style, as in the demo app |
| Theme `game` | A look-alike of the game's own UI, rebuilt in CSS. No CDPR textures or fonts are copied |
| Built in | Keyboard and gamepad navigation, focus that works with click-through and the F10 modes, UI sounds played through the game's audio by the bridge |

Every REDnode kernel reaches the same widgets, because only the overlay host can render a page:

| Who | How they make UI |
|---|---|
| Overlay app (HTML and JavaScript) | Uses the components in its markup |
| Tier 2 Node mod | A builder that produces the same components, for example `rednode.ui.window({ title, children: [button('Apply')] })`. No HTML needed. Arrives in O6 |
| Tier 1 and declarative rules | Ask through the bridge for a ready-made piece of UI, such as a notification. The host renders it with the kit |

### Player install

Running `npm run overlay` by hand is the developer setup. Players should install from Nexus Mods or with Vortex and have it work, like CET. Planned for O3:

| Piece | How |
|---|---|
| Packaged host | Build the Electron host into a standalone app with its own Node, with `@electron/packager`. No Node, npm or repo needed. Ships inside the REDnode mod as `red4ext/plugins/REDnode/host/`. **320 MB unpacked** with Electron 44: the executable alone is 235 MB. The zipped size is not measured yet |
| Auto-start | The plugin starts the host when the game starts. The host exits when the pipe closes, so it never outlives the game |
| Apps as separate mods | Overlay apps, and later Tier 2 Node mods, install into a REDnode apps folder, each with its manifest. On Nexus they list REDnode as a requirement, like CET mods list CET |
| Player settings | Enabled apps, the hotkey (F10 today) and similar, held by the launcher app |

The player's path then is: install RED4ext and REDnode, add any REDnode apps, launch the game.

| Risk | Note |
|---|---|
| Antivirus | A game plugin that starts a program may cause false alarms. Code signing helps. Unverified |
| Size | 320 MB unpacked is large for a mod. Nexus allows it; a shared runtime for all REDnode apps keeps it to one copy |
| Vortex | The archive layout must let Vortex deploy REDnode as a normal mod |

### Looking like the game

| Topic | Approach | Status |
|---|---|---|
| Visual effects | CSS and WebGL in the page: glow, scanlines, glitch, chromatic aberration | Standard web techniques |
| Fonts | The game's fonts cannot be shipped with REDnode. Use close open-source fonts, or load fonts from the player's own install at runtime | Loading from the install is unverified, and needs a licensing check |
| Colors | Match the game's palette. In HDR, match the game HUD's brightness (O7) | |
| Sound | Play UI sounds through the game's audio system with a bridge call, so they mix with the game | Unverified |

### Known limits and research items

| Item | Notes |
|---|---|
| Always on top | REDnode draws after the game finishes the frame, so its windows sit above everything, including game menus. Drawing under a game menu would need a hook inside the game's own UI rendering. Research item, not planned |
| Game input while a window is focused | The game is paused for input while an interactive window has focus. This is intended, the same as CET |
| World-space UI | Labels attached to 3D objects would need the camera through the bridge each frame and would draw over everything. Research item |
| Steam Deck and Proton | Untested. D3D12 runs through vkd3d-proton there |

