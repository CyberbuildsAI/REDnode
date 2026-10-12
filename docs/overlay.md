# HTML overlay

Status: **O5 Performance passed in game.** O1 to O5 have all passed; the O4 scene threshold is still open (see the O4 result). Next: O6 One runtime. To build an app today, see the [Overlay apps](overlay-apps.md) guide. The proof of concept passed in game, alone and side by side with CET and 10 other RED4ext plugins (2026-10-11). See [Test results](#test-results) and [the plan](#plan-for-the-real-version).

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

Status: **draft for review.** Phases are numbered O1 to O7 so they do not clash with the project phases P0 to P4. Each phase ends with an in-game test, like the proof of concept.

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
| Overlay CPU time in gameplay | About 0.7 to 1.0 ms per game frame even without Stress, against about 0.15 ms at the main menu. 3% of a frame at 30 fps, about 14% at 144 fps. A likely cause is opening every shared texture handle again each frame. To trim later |
| Unanswered shared frames at startup and while hidden | The plugin skips its work before Present is hooked and in hidden mode, so the host's one-second release frees those textures. The plugin could acknowledge them at once. To fix later |
| Focus bug found and fixed | Clicking the window that had focus before leaving interactive mode did not refocus it (seen with Signal). Fixed in `2b94a6b` with two unit tests, confirmed in the retest |

O1 to O4 make the feature usable. O5 makes it cheap. O6 joins it to the rest of REDnode. O7 hardens it.

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
  <rn-button theme="game" sound="ui_click">Open stash</rn-button>
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

