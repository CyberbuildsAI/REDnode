# Tests

Every test run on REDnode so far: how to run it again, what to expect, and what it showed. Each phase ends with a test in the game on the dev PC; new tests are added here when they are first run. The phase pages keep each test's full history and the reasons behind its changes; this page gathers them for running again.

Last updated 2026-10-16. REDagent's own tests (C2 to C5, the chat and authoring) are in [its repo](https://github.com/Edgemodders/REDagent); its C1, the kernel MCP server, is here.

## At a glance

| Test | Kind | Phase | Last run | Version | Result |
|---|---|---|---|---|---|
| [Unit tests](#unit-tests) | Automated | All | Every build | 0.24.2 | Pass |
| [Build and type check](#build-and-type-check) | Automated | All | Every build | 0.24.2 | Pass |
| [Mock game](#mock-game) | Automated, by hand | All | 2026-10-16 | 0.24.2 | Pass |
| [P1 probe](#p1-probe) | In the game | P1 | 2026-10-11 | 0.1.0 | Pass |
| [Overlay proof of concept](#overlay-proof-of-concept) | In the game | Overlay | 2026-10-11 | 0.3.0 | Pass |
| [O1 Windows](#o1-windows) | In the game | O1 | 2026-10-11 | 0.4.0 | Pass |
| [O2 UI kit](#o2-ui-kit) | In the game | O2 | 2026-10-11 | 0.5.0 | Pass |
| [O3 Apps](#o3-apps) | In the game | O3 | 2026-10-11 | 0.6.0 | Pass |
| [O4 HUD widgets](#o4-hud-widgets) | In the game | O4 | 2026-10-11 | 0.7.0 | Pass, one open item |
| [O5 Performance](#o5-performance) | In the game | O5 | 2026-10-12 | 0.8.0 | Pass |
| [O6a Runtime](#o6a-runtime) | In the game | O6a | 2026-10-12 | plugin 0.9.0 | Pass |
| [O6b Game API](#o6b-game-api) | In the game | O6b | 2026-10-12 | plugin 0.10.0 | Pass |
| [C1 Kernel MCP server](#c1-kernel-mcp-server) | In the game, with Claude Code | REDagent C1 | 2026-10-12 | host 0.4.0 | Pass |
| [O8 Mod Manager](#o8-mod-manager) | In the game | O8 | 2026-10-13 | plugin 0.14.0 | Pass |
| [W1 World API](#w1-world-api) | In the game | W1 | 2026-10-13 | 0.15.0 | Pass |
| [O9 Debugger](#o9-debugger) | In the game | O9 | 2026-10-13 | 0.16.0 | Pass |
| [W2 Packaging](#w2-packaging) | In the game | W2 | 2026-10-14 | 0.17.0 | Pass |
| [O10 Layers](#o10-layers) | In the game | O10 | 2026-10-14 | 0.18.0 | Pass |
| [T1 TweakDB read](#t1-tweakdb-read) | In the game | T1 | 2026-10-14 | 0.19.0 | Pass |
| [T2 TweakDB write](#t2-tweakdb-write) | In the game | T2 | 2026-10-14 | 0.20.0 | Pass |
| [O11 Spaces](#o11-spaces) | In the game | O11 | 2026-10-14 | 0.21.0 | Pass |
| [Pointer lock](#pointer-lock) | In the game | EDGEbuilder #11 | 2026-10-15 | 0.22.0 | Pass |
| [S1 research spike](#s1-research-spike) | In the game | Sound S1 | 2026-10-16 | 0.23.1 | Partial |
| [S1 Play](#s1-play) | In the game | Sound S1 | 2026-10-16 | 0.24.0 | Pass but pan, fixed in 0.24.1 |
| [S1 check, 0.24.1](#s1-check-0241) | In the game | Sound S1 | 2026-10-16 | 0.24.1 | Pass |
| [Polish 0.24.2](#polish-0242) | In the game | Polish | Not run | 0.24.2 | |

## Before any in-game test

| Step | How |
|---|---|
| Build | `.\tools\build-native.ps1` if `native/` changed. `npm run overlay:package` if the host, the launcher, the UI kit or the apps changed: the deploy copies the packaged host and the apps |
| Deploy | Close the game first. `.\tools\deploy-native.ps1 -GameDir '<game folder>'` (the default is Steam's). It changes the game folder, so ask the player first. With a packaged host deployed, the game starts it; close any host started by hand |
| Memory | The game needs about 12 to 16 GB of RAM. On a 16 GB machine, close other apps |
| Tie steps to the log | Switch on the **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Each mark goes to the Mod log and `red4ext/logs/rednode-mods.log` as `[timer] Mark: step N done at mm:ss`. Give this instruction first, above the steps. The tests below leave it out of each step |
| Read the logs | After the game process has exited (the logs can be empty before): `red4ext/logs/rednode-*.log` (the plugin), `rednode-overlay.log` (the host), `rednode-mods.log` (packages), `red4ext-*.log`, and `r6/logs/redscript_rCURRENT.log` for script errors. The expected plugin lines are in the [plugin README](https://github.com/Edgemodders/REDnode/blob/main/native/README.md) |
| Record | Results go in the phase's page and in this page's table. When a test shows how a game type behaves, add a note in `gameapi/notes/` |

The tests ran on Cyberpunk 2077 2.31 (Steam), RED4ext 1.30.0, at 3840 x 2160 SDR, mostly with a modded profile (Cyber Engine Tweaks, ArchiveXL, Codeware, TweakXL and others) unless a test says otherwise.

## Automated

### Unit tests

```powershell
.\tools\build-native.ps1
```

Builds the plugin and runs four test programs without the game. The build stops if one fails. Each prints `ok` or `FAIL` per check and `PASSED: 0 failure(s)`.

| Program | Source | What it checks |
|---|---|---|
| `REDnode_tests` | `native/tests/windows_test.cpp` | The overlay window manager: hit testing, click-through, focus, z-order, dragging, anchors, HUD input and hiding, keyboard routing |
| `REDnode_json_tests` | `native/tests/json_test.cpp` | The JSON parser of the game API |
| `REDnode_capture_tests` | `native/tests/capture_test.cpp` | The game picture's conversion: scaling, channel order, HDR10 and scRGB to SDR, base64 |
| `REDnode_audio_tests` | `native/tests/audio_test.cpp` | The Sound API: the four sample files decode (WAV, OGG, MP3, FLAC) at their length and not silent; pan left, right and centre on the stereo mix; the stereo mix reaches only the front pair of a 7.1 device |

### Build and type check

```powershell
npm run build
npm run typecheck
npm run docs:game
```

Expected: no errors. The `rednode` package's build generates its game types from `gameapi/2.31/rtti.json` (15,830 classes, 1,524 enums, 802 global functions, about 9 MB). `docs:game` builds the game API reference into `docs/game` in about a minute. The site's workflow runs the same on every push.

### Mock game

A stand-in for the plugin's end of the overlay pipe: it starts the host, plays a script of game events and input, answers game calls with fixed values, and saves each window's picture. Every host change since O3 was checked against it before the game. It is kept outside the repo (a dev tool, not maintained as part of REDnode), so this entry records what it is used for:

| Use | How |
|---|---|
| Start-up, discovery, launcher, saved choices | The host's log and the `window.open` commands it sends |
| Input, drag, hover, tooltips | Mouse moves, clicks, typing and wheel sent as the plugin's input events; a picture of the window after |
| Game calls | Fixed answers for the calls a sample makes (vitals, settings, time, TweakDB) |
| GPU sharing | Counted, not drawn: pictures come only from the CPU path (`renderPath: "cpu"` in the test's settings) |

Use a throwaway data folder (`--data-dir=`) so the player's settings are not touched.

## P1

### P1 probe

[Source](p1-results.md#session-2-ordered-retest). Last run 2026-10-11 (session 2), REDnode 0.1.0, the P1 probe build. **Pass.** The probe build's log lines are its own: re-running needs that build (commit history), so this test is a record more than a repeatable check.

Wait for Steam's cloud save sync before starting, and pause about 30 seconds after each step.

1. Launch the game and wait at the main menu. Expected: `REDnode 0.1.0 loading (P1 probe)`, `RTTI ready: 12039 types, 716 global functions`, `Game thread pump started`, then `Event drained on frame N: PlayerPuppet.OnGameAttached REDnode_Ping(21) = 42` about 2 seconds later. redscript logs `Compilation complete`.
2. Open the load-save list and back out, twice. Expected: no event, only `Pump heartbeat` lines.
3. Load a save. Expected: one event.
4. Save the game. Expected: no event.
5. Load a different save from the pause menu. Expected: one event.
6. Quit to desktop. Expected: `Game thread pump stopped after N frames`; RED4ext logs `REDnode has been unloaded`.

Showed: `OnGameAttached` fires at the main menu and at every save load, never on save or on opening the load list. Pump rate about 265 fps at the menu, 110 in gameplay. Open: why the main menu attaches a `PlayerPuppet`, and how to tell a real session start from it.

## Overlay

### Overlay proof of concept

[Source](overlay.md#running-the-test). Last run 2026-10-11 (run 2), REDnode 0.3.0, with CET and 10 other RED4ext plugins. **Pass** in both runs. The proof-of-concept panel was replaced by O1's windows, so this is a record.

1. Start the host by hand: `npm run overlay`. Expected: `Waiting for the game`.
2. Launch the game. Expected: a panel in the middle at the main menu (a placeholder with a moving cyan line without the host).
3. With the host: the demo app shows, the terminal prints `Connected to the game`, the clock ticks.
4. **F10**: a yellow cursor. Click **Click me**, type in the text box. The camera does not move. **Esc** gives input back.
5. Load a save. Expected: `PlayerPuppet.OnGameAttached` in the events tile. **Read player position**, walk, read again: V's coordinates change.
6. **F10** twice to hide, once more to show. Quit.

Showed: REDnode and CET draw together (REDnode chains the `Present` hook). Run 1 fixed the lagging cursor (the plugin draws it) and the missing caret (`focusOnWebView()`).

### O1 Windows

[Source](overlay.md#o1-windows-test). Last run 2026-10-11, REDnode 0.4.0. **Pass.** The demo and Signal apps were used; since O3 the host starts with the game, so skip "start the host".

1. Start the game. Expected: the demo (1024 x 640) and **Signal** (a 320 x 320 ring with a transparent middle and a yellow tab).
2. **F10**. Drag the demo by its title bar and Signal by its tab: they follow without lag.
3. Overlap them and click one: it comes to the front, the other's title dims.
4. Click inside Signal's transparent middle over the demo: the click reaches the demo.
5. **Ping** on Signal: it shows the game frame.
6. Click empty screen: interactive mode ends.
7. Restart the game: the windows come back where you left them.

### O2 UI kit

[Source](overlay.md#o2-ui-kit-test). Last run 2026-10-11, REDnode 0.5.0. **Pass.** Uses the **Kit** and **Native** apps.

1. Open **Kit** (every widget) and **Native** (the red **Open stash** button, lower right).
2. **F10**. In Kit, try every tab: buttons, toggles, slider, type a call sign and Enter, list and menu items. Hover **Hover me**: a tooltip.
3. Flip **Game theme** in Kit's title bar: the window switches to the game look (the HUD red theme). Since O6b the launcher's theme buttons also set it for every window.
4. Keyboard: Tab between widgets, arrows in the list and menu, Enter to choose.
5. **Open stash**, pick an item: a game-style notification. Drag the button by its grip.
6. Kit's **Sound** tab: pick a name, **Play**. Note which names sound.

Showed: game UI sounds play through `AudioSystem.Play` with no entity. Open: gamepad navigation; which sound names work.

### O3 Apps

[Source](overlay.md#o3-apps-test). Last run 2026-10-11, REDnode 0.6.0. **Pass.** The player's path: no host started by hand.

1. Check the game folder: `red4ext/plugins/REDnode/host/` and `apps/`.
2. Launch the game. Expected: the windows left on and the **REDNODE** tab at the lower left appear on their own.
3. **F10**, click the tab: the launcher lists the apps with versions and descriptions.
4. Switch an app on: it opens. Switch one off: it closes.
5. Quit. Expected: `REDnode-overlay.exe` is gone from Task Manager (the host runs in a job object).
6. Launch again: the choices were kept.

### O4 HUD widgets

[Source](overlay.md#o4-hud-widgets-test). Last run 2026-10-11, REDnode 0.7.0. **Pass, one open item.** Uses **Coords HUD** and **Game state**.

1. Launch the game. Expected: Coords HUD hidden at the main menu; Game state shows *Main menu / loading: yes*.
2. Load a save: Coords HUD at the top, its numbers change as you walk.
3. **F10**, click on Coords HUD: the click goes through it.
4. Inventory, map, then the pause menu: Coords HUD hides; Game state shows *Menu open: yes*.
5. Photo mode: Coords HUD hides.
6. Talk to an NPC, and trigger a cutscene if you can: note the **scene tier** shown and whether Coords HUD hid.
7. **F10** to hidden: everything hides.

Showed: a conversation is scene tier 2, so the HUD stays up. Open: the `scene` threshold (`SceneTier >= 4`) is **unverified**: no cutscene could be triggered. Check it on a fresh playthrough.

### O5 Performance

[Source](overlay.md#o5-performance-test). Last run 2026-10-12, REDnode 0.8.0. **Pass.** Uses **Perf**, **Stress** and **Signal**.

1. Launch the game. Expected: **Perf** at the top right says *Render path: GPU sharing*; *GPU-shared frames* counts up.
2. Every window looks right: no garbage, flicker, tearing or stale frames. Switch **Signal** on: its ring animates smoothly.
3. In interactive mode, click through Signal's middle: still works.
4. Switch **Stress** on. Note the game's frame rate, the overlay's CPU and GPU times, the host's memory and CPU.
5. Switch **GPU sharing** off in the launcher: windows reopen on the CPU path. Note the same numbers.
6. GPU sharing back on, Stress off.

Showed (Stress on, GPU sharing against CPU): 29 to 31 fps both; overlay GPU under 0.1 ms; 0 against 55 MB/s uploaded; host about 910 against 1,080 MB; about 60 to 100 MB per open window. Overlay CPU was about 1 ms a frame, fixed in O6a (0.11 to 0.15 ms). Open: measure again in a lighter scene than 30 fps.

### O6a Runtime

[Source](overlay.md#o6a-runtime-test). Last run 2026-10-12, plugin 0.9.0. **Pass.** Uses **Hello mod**, **Ticker mod**, **Crash mod**, the **Mod log** and Coords HUD. Needs a second save, and a way to edit `apps/hello-mod/mod.mjs` in the game folder.

1. Load a save, stand still 60 seconds. Expected: Hello mod at the right and Coords at the top show the same X, Y, Z.
2. **F10**. Hello mod: **Play sound** plays; **Follow** off stops the position; drag it by its title.
3. Launcher: the mods show **RUNNING · own process** and their memory. Switch **Hot reload** on, change `first version` in Hello mod's `mod.mjs`, save: the window comes back with the new text within seconds.
4. Switch **Mod log** and **Crash mod** on. **Throw an error**: Crash mod shows **CRASHED**, the Mod log shows the error in red, Hello mod keeps updating. **Restart**.
5. Mod log: **Errors only**, **Copy**: the crash and its line in `mod.mjs`.
6. Crash mod: **Hang forever**. Expected: after about 10 seconds **NOT RESPONDING**; Hello mod keeps updating. **Restart**.
7. **Shared process** on for all three: the launcher shows **shared process (3 mods)**.
8. Crash mod: **Kill the process**: all three **CRASHED**, then running again about 2 seconds later.
9. **F10** to hidden, 30 seconds, back to passive.
10. Inventory for 30 seconds: Coords hides, Hello mod and the Mod log stay.
11. Load a save: Hello mod's **Saves loaded** goes up by one.
12. Quit. Read `rednode-overlay.log` (perf and `Mod processes:` lines) and `rednode-mods.log`.

Showed: an own process is about 100 MB; three mods in one shared process about 150 MB against 370. Open: a worst frame of 21 to 25 ms when a window opens or closes (freeing a texture waits for the GPU), for O7.

### O6b Game API

[Source](overlay.md#o6b-game-api-test). Last run 2026-10-12, plugin 0.10.0. **Pass.** Uses **Vitals**, the **Game API mod**, Hello mod and Crash mod. Needs two saves and a way to get hurt a little.

1. Load a save. Expected: **Vitals** under Coords shows **HP**, **LVL** and **€$**; the Game API mod shows the same.
2. Compare with the game's health bar, character screen and inventory: they match. Vitals hides in menus.
3. **F10**. **Give 100 eddies**: both money values go up by 100.
4. **Wrong argument type**: "Refused, as it should be:" and the reason; nothing happens in the game.
5. **Use the player from before**: "Still valid" and V's position.
6. Hello mod: **Play sound** plays.
7. Launcher themes: **EDGE** turns every title bar solid yellow, **HUD red** red. Coords, Vitals and Native stay red.
8. Open the Mod log, switch Crash mod on, and click inside its window as soon as it appears, between its buttons: interactive mode does not end.
9. Crash mod off. **F10** to hidden, 30 seconds, back to passive.
10. Get hurt: HP drops in Vitals and the mod.
11. Load a different save, **Use the player from before**: "that game object no longer exists"; the values update.
12. Quit. The plugin log has no crash inside a game call; the overlay log has no "Released ... shared frame(s)" while hidden.

Open: `game.player.setHealth`, out parameters and `rtti.get` were not tried in this test (out parameters were later used in the Sound spike).

### O8 Mod Manager

[Source](overlay.md#o8-mod-manager-test). Last run 2026-10-13, plugin 0.14.0. **Pass.** Step 7 needs REDagent with the player's API key.

1. Deploy, load a save. Expected: every package still in the launcher; Hello mod shows in gameplay.
2. **F10**, launcher: **Mod Manager** first. Switch it on.
3. Sort by a column, search "hello", try the filters, page with **Next**.
4. Select Hello mod, **Pin to HUD** off. F10 to passive: its window goes. F10 to interactive: it is back. Pin it again.
5. Unpin something from the launcher (**L**): the launcher says "1 more in the Mod Manager". Pin it back.
6. Tick two or three rows, bulk **Off** then **On**.
7. Ask REDagent for a small new app: the launcher says "1 new"; the **New** filter finds it.
8. Close the Mod Manager with its close button: the launcher shows it off.

Showed: the cursor flickered with frequent Alt+Tab; plugin 0.14.1 ignores input while the game is not in front and logs "Overlay: the game left the front", confirmed in REDagent's C5 test.

### O9 Debugger

[Source](overlay.md#o9-debugger-test). Last run 2026-10-13, REDnode 0.16.0. **Pass.** Uses World test, Coords and Hello mod.

1. Deploy, load a save, switch **World test** on: its window shows at once (up to 64 windows).
2. **F10**. Mod Manager, Coords, **Window debugger: In the game**: a debugger with Elements. **Console**, `document.title`, Enter. Close it.
3. Same with **On the desktop**: DevTools opens on the desktop without taking focus. Alt+Tab to it and back.
4. Launcher: **Developer mode** on: a bug button by every close button. Click one: its debugger opens.
5. Hello mod, **Debug (Node inspector)** on: the mod restarts with an address. **Node debugger: In the game**. **Play sound** in Hello mod: "Sound button pressed 1 time(s)" in the Console.
6. **Sources**, Ctrl+P, `mod.mjs`, breakpoint on `presses += 1;` (line 28). **Play sound**: it stops there, no sound. Resume (F8): the sound plays. Remove the breakpoint.
7. **Restart** Hello mod: the Node debugger reopens. Debug off: it closes, the mod keeps working.
8. Developer mode off. Quit.

Showed: about 34 game calls a second cost 0.5 to 0.9 ms a frame. Open: what caused W1's drop to 30 fps.

### O10 Layers

[Source](overlay.md#o10-layers-test). Last run 2026-10-14, REDnode 0.18.0. **Pass.** Uses Layers test, Test timer, Hello mod, Coords and Vitals.

1. Deploy, load a save.
2. **F10**. Mod Manager: give **Test timer** "staying above other packages' windows". Give **Layers test** solo mode and switch it on: a faint tint covers the screen; the timer can still be clicked.
3. Click the tint, then the launcher tab, the Mod Manager and the timer: each takes the click. Open Hello mod: the tint stays above it, the tools stay on top.
4. Layers test: **Solo on**. Hello mod and HUD widgets go; the launcher tab shows "SOLO Layers test".
5. **End** by the launcher tab: everything comes back. **Solo on** again, then switch Layers test off: everything comes back.
6. World test **Spawn box**: since 0.18.1 a textured cardboard box.

### O11 Spaces

[Source](overlay.md#o11-spaces-test). Last run 2026-10-14, REDnode 0.21.0. **Pass.**

1. Deploy, load a save.
2. **F10**. Launcher, **Space**: **New**, `Combat`, Enter. The tab shows **▾ Combat**; package windows and HUD widgets go; launcher, Mod Manager and Test timer stay.
3. Ctrl+1: Main is back. Ctrl+2: Combat. Ctrl+1.
4. Hello mod's title bar, space icon: **Combat**. It goes; Ctrl+2 shows it. Ctrl+1.
5. Mod Manager's **Space** column shows each package's space. Coords: **All**: it shows in both spaces.
6. On a title bar: roll up, Pin to HUD; drag, then **Reset position**. Developer mode on: ⋯ on the far left holds the actions past three.
7. **Rename** Combat to `Driving`, then **Delete**: its windows come back to Main.

### Pointer lock

[Source](overlay.md#pointer-lock-test). Last run 2026-10-15, REDnode 0.22.0. **Pass.** Uses **Pointer lock test**.

1. Deploy, load a save.
2. **F10**, switch on **Pointer lock test**. Hold the right button on its pad and move: the cursor stays hidden where you pressed; Yaw and Pitch change smoothly. Let go: the cursor is back.
3. Hold the right button and press **Esc**: the lock ends; the overlay stays interactive.
4. Hold the right button and press **F10**: the lock ends with interactive mode.

Showed: Chromium drops `movementX` from injected moves, so the host sends raw movement and the page dispatches it.

### Polish 0.24.2

[Source](overlay.md#polish-0242-test). Built, **not run yet**; checked in the mock game only (the Mod Manager's greyed buttons not even there).

1. Load a save, **F10**. Hover a title-bar icon (roll up on the Mod Manager or the Test timer): a tooltip after half a second. Hover the launcher's **Open at start**: a tooltip explains it.
2. Make a second space if needed. Mod Manager, **Test timer**: the Space column says **All**, the space buttons are greyed, a note says it is a tool window.
3. Launcher: **Open at start** off. Restart the game: only HUD widgets at the main menu and after loading a save.
4. **F10**: the launcher and windows show. Start the timer again and Mark. Open at start back on if you like.
5. Quit. The overlay log has `Open at start is off`, `Open at start: the overlay was opened`, and `Sound: the game's volumes are ... (a save loaded)` after each load.

## MCP server

### C1 Kernel MCP server

[Source](mcp.md#c1-test). Last run 2026-10-12, host 0.4.0. **Pass.** Needs Claude Code on the same PC. Uses Crash mod, Hello mod, Coords and Vitals.

1. Load a save. **F10**, launcher: **MCP server** on, **Copy setup**.
2. Alt+Tab to a terminal, run the copied command, then `claude mcp list`: `rednode` connected.
3. In a **new** Claude Code session, ask in turn:
   1. "Using the rednode tools, what are V's health, level and money?" (allow each `api_call`)
   2. "Show me the errors in the REDnode mod log." (first switch Crash mod on and press **Throw an error**)
   3. "Capture the Hello mod window and tell me what it shows."
   4. "What does the game show right now, and what does the overlay cost?" (once in gameplay, once with the inventory open)
   5. "Close the Coords HUD, then open it again."
   6. "Give V 50 eddies." (Claude Code asks first; check Vitals)
4. Quit. `claude mcp list`: `rednode` fails to connect, as expected with the game closed.

## World API

### W1 World API

[Source](world.md#w1-test). Last run 2026-10-13, REDnode 0.15.0. **Pass.** Needs Codeware 1.14 or later. Uses **World test** (base-game assets only since 0.17.1).

1. Deploy, load a save. `r6/logs/redscript_rCURRENT.log` has no compile errors.
2. **F10**, Mod Manager: **World test** on. It says "World API ready (Codeware found)".
3. Face an open spot, **Spawn box**: a box about 3 m ahead; the time it took; `Entity/Initialize` and `Entity/AfterAttach` for it.
4. **Spin 10 s**: 5 seconds one move at a time, 5 seconds ten at a time, with moves per second for each.
5. **Remove**: the box goes; `Entity/Detach`.
6. **Next mesh**, **Spawn box**: the marker mesh. Remove it.
7. Quit. Compare moves per second with the frame rate in the perf lines.

Showed: spawn 254 to 257 ms. Awaited moves run one a frame; ten sent together run in the next frame (302 a second), so batching needs no special call. Open: whether the moves caused the drop to 30 fps.

### W2 Packaging

[Source](world.md#w2-test). Last run 2026-10-14, REDnode 0.17.0. **Pass.** Needs Codeware and ArchiveXL, a REDbridge (found in REDdeck's or REDcode's storage, or `REDBRIDGE_EXE`) and .NET 10. Uses **Packaging test**.

1. Deploy, load a save.
2. **F10**. Mod Manager, **Packaging test** (New filter): **NEEDS**. Under **Requires**: Codeware and ArchiveXL ticked with versions, `not-a-real-mod` crossed out. The **Errors** filter lists it.
3. Switch it on: its window lists the same three lines.
4. **Permissions**: where REDbridge was found. **Allowed** on.
5. **Archives**: 57 archives, about 584,000 files after a few seconds. **Search**: files named `player_ma_tpp`.
6. Launcher: **EDGE**, open a window debugger: its title bar is yellow. Switch back.

Showed: a RED4ext plugin counts as installed only with a DLL in its folder (0.17.1, #9).

## TweakDB API

### T1 TweakDB read

[Source](tweakdb.md#t1-test). Last run 2026-10-14, REDnode 0.19.0. **Pass.** Uses **TweakDB test**.

1. Deploy, load a save.
2. **F10**, Mod Manager: **TweakDB test** on, **Read**: `gamedataWeaponItem_Record`, the Lexington's quality, item type, display name, friendly name, tags and `FriendlyName()`.
3. Type `Vehicle.v_sport2_quadra_type66_player`, Enter: `gamedataVehicle_Record`. Then `Items.not_a_thing`: "No record".
4. **Vehicles**: the count and the time.

Showed: 7 values in 226 ms; 1,377 vehicle records in 26 ms. Open: names for hashed ids (REDbridge #3).

### T2 TweakDB write

[Source](tweakdb.md#t2-test). Last run 2026-10-14, REDnode 0.20.0. **Pass.** Needs TweakXL (1.11.4 in the run).

1. The TweakDB test shows no **NEEDS**. Load a save.
2. **Read**, then **Change**: the friendly name and `FriendlyName()` read "REDnode was here".
3. Switch the TweakDB test off and on, **Read**: `w_handgun_militech_lexington` again. The log: `Undid 1 TweakDB change(s) of tweakdb-test (the mod stopped)`.
4. **Clone**: `Items.REDnode_Test_Clone`, a `gamedataWeaponItem_Record`, friendly name "REDnode clone".
5. Quit. TweakXL's log has nothing from REDnode's calls.

Open: which objects already in the game see a change.

## Sound API

### S1 research spike

[Source](sound.md#s1-spike-results). Last run 2026-10-16, REDnode 0.23.1. **Partial**: a research test. Uses **Sound test** 0.1 (its spike buttons were replaced in 0.2.0, so this is a record).

1. Load a save. **Read settings**: the audio settings with their numbers.
2. Change master and effects volume in Settings, **Read settings**: the two values changed.
3. **Play test tone** and **Low** with game sound on: clean beeps, the game's sound keeps playing.
4. Pause menu, then the map: the "time" line.
5. Slow time (Sandevistan or scanner): the dilation number.
6. Walk, then only turn: the camera line changes, then stays.
7. Alt+Tab and back, **Play test tone**: still plays.
8. Switch Windows' output, **Play test tone**: which output plays it.

Showed: the volumes are under `/audio/volume` (Ints 0 to 100); `IsPausedState` is always false, the global dilation reads 0 in menus; the camera transform works with `api.$out`; miniaudio plays beside Wwise on an 8-channel device. Open: step 8 (following a change of output device) was skipped.

### S1 Play

[Source](sound.md#s1-play-results). Last run 2026-10-16, REDnode 0.24.0. **Pass but pan**, fixed in 0.24.1. Needs a Sandevistan for step 11. Uses **Sound test** 0.2.0.

1. Load a save. **Music (OGG)**: fades in over 1.5 s, loops every 8 s without a gap or click; the list shows it.
2. With music on: **Beep (WAV)**, **Chime (FLAC)**, **Voice (MP3)**: each plays once over the music.
3. **Voice +12 semitones** (an octave up, twice as fast), **Chime left**, **Chime right** (left ear, then right), **Beep in 2 s**.
4. **Music quieter**, then **Music louder**: fades down over a second and back.
5. Pause menu, then the map: the music stops and goes on from where it was.
6. Settings: **Music volume** to 30: the music is quieter. **Sound effects volume** down, **Chime (FLAC)**: quieter. Put both back.
7. **Master volume** to 30, **Beep (WAV)**: ours and the game's sound drop by about the same. Put it back.
8. **Mute in background** on, Alt+Tab with music on: silent in the background, plays again on return.
9. **Stop all**: fades out over half a second; "Nothing playing".
10. **Music (OGG)**, then switch Sound test off: the music stops.
11. A Sandevistan: note "global dilation" and "V's dilation".

Showed: pan did nothing on the 8-channel HDMI device (miniaudio pans only a stereo mix); a sound started in a menu waits for it to close; the Sandevistan sets the global dilation to 0.3 for 2 to 3 s while V's stays 1. Open: the scanner's slow motion (not the global dilation; the player suspects one of their mods); following a change of output device.

### S1 check, 0.24.1

[Source](sound.md#s1-check-rednode-0241). Last run 2026-10-16, REDnode 0.24.1. **Pass**, with step 2 passed in a retest the same day.

1. Load a save, Sound test on. **Chime left**, **Chime right**, **Chime (FLAC)**: left only, right only, both. The plugin log: `mixed in stereo to the front pair`.
2. Press **Beep (WAV)** first (0.24.1 reads the volumes only after a sound has played; 0.24.2 also at each save load). Settings: **Music volume** to 30, close the menus, wait 5 s: the overlay log reads `music 30` with the others at 100. Put it back: `music 100`.
3. Hold the scanner: note "V's dilation".

Showed: the volume reads follow each slider. Step 3: the scanner did not slow time in that run.

## Adding a test

When a phase's test runs for the first time, add it here: a row in the table, then its steps with the expected result, what it showed and what is open, with a link to its source section in the phase's page. Keep the steps runnable with the current build; when a later version changes a step, say so in the step.
