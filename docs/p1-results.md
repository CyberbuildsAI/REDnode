# P1 results: in-game probe test

Status: **passed.** The probe plugin loads, both tier paths work, and the game-thread pump runs and stops cleanly. A second session explained why the probe event fired more than once: `PlayerPuppet.OnGameAttached` runs at the main menu and again on every save load.

## Setup

| Item | Value |
|---|---|
| Date | 2026-10-11 |
| Game | Cyberpunk 2077 2.31 (file version `3.0.80.51928`), Steam |
| RED4ext | 1.30.0 |
| redscript | Present, run by RED4ext as `scc` |
| Other mods | ArchiveXL, Codeware, TweakXL, audioware, CET and about 10 more, managed by Vortex |
| REDnode | 0.1.0, the P1 probe from [native/](https://github.com/Edgemodders/REDnode/tree/main/native), built with MSVC 14.44 |

The probe was deployed by hand with `tools/deploy-native.ps1`, not through Vortex. Both sessions used the same build.

## Results

| Check | Expected | Result |
|---|---|---|
| Plugin loads | RED4ext lists REDnode as loaded | Passed: `REDnode (version: 0.1.0, author(s): CyberbuildsAI) has been loaded` |
| Script compiles | No redscript errors | Passed: `REDnode.reds` compiled with all other mods, `Compilation complete` |
| RTTI access | Type and function counts | Passed: 12,039 types, 716 global functions |
| Tier 1 path | Synchronous call returns its value to the script | Passed: `REDnode_Ping(21) = 42` |
| Tier 2 path | Queued event handled on the game thread | Passed: every event was drained by the pump |
| Pump | Starts, logs heartbeats, stops | Passed in both sessions |
| Shutdown | Plugin unloads | Passed: `REDnode has been unloaded` |

## When `OnGameAttached` fires

| Player action | Fires the event |
|---|---|
| Game reaches the main menu | Yes, once, about 2 seconds after the pump starts |
| Open the load-save list and back out | No |
| Load a save from the main menu | Yes, once |
| Save the game | No |
| Load a save from the pause menu | Yes, once |

This comes from session 2, which ran the actions in a fixed order with 30-second pauses between them. Events were matched to actions by their order and the gaps between them, not by clock times.

Why the main menu attaches a `PlayerPuppet` is **unverified**. The menu may load a small world with a puppet in it.

**For later phases:** mods must not assume `OnGameAttached` runs once per session, or that it means a save is loaded. The rednode API should expose a clear "session started" event that ignores the main menu. How to tell the two apart is not worked out yet.

## Session 1: first run

The player launched the game while Steam was still syncing saves from the cloud. They tried to load a save a couple of times, loaded one once the sync finished, played about two minutes, saved once and quit through the menu. Times were not recorded.

`red4ext/logs/rednode-2026-10-11-10-57-20.log`, complete:

```
10:57:20.811  REDnode 0.1.0 loading (P1 probe)
10:57:21.326  RTTI ready: 12039 types, 716 global functions
10:57:40.584  Game thread pump started
10:57:42.715  Event drained on frame 80: PlayerPuppet.OnGameAttached REDnode_Ping(21) = 42
10:57:58.218  Pump heartbeat: 3600 frames
10:58:12.180  Pump heartbeat: 7200 frames
10:58:20.296  Event drained on frame 9608: PlayerPuppet.OnGameAttached REDnode_Ping(21) = 42
10:58:38.384  Pump heartbeat: 10800 frames
11:00:21.892  Pump heartbeat: 14400 frames
11:00:51.451  Pump heartbeat: 18000 frames
11:01:03.899  Pump heartbeat: 21600 frames
11:01:19.332  Game thread pump stopped after 23782 frames
```

Two events fired. Session 2 showed that frame 80 was the main menu and frame 9,608 was the save load.

RED4ext logged the unload at 11:01:45. The game process took several more seconds to exit after the player quit, and the log files were empty until it did.

## Session 2: ordered retest

The player did these steps in one session, waiting for the cloud sync before starting and pausing about 30 seconds (phone stopwatch) after each step:

| Step | Action |
|---|---|
| A | Launch and wait on the main menu |
| B | Open the load-save list, back out, twice |
| C | Load a save |
| D | Save the game |
| E | Load a different save from the pause menu |
| | Quit to desktop through the menu |

`red4ext/logs/rednode-2026-10-11-11-14-32.log`, complete, with the matched step:

```
11:14:32.206  REDnode 0.1.0 loading (P1 probe)
11:14:32.564  RTTI ready: 12039 types, 716 global functions
11:14:49.761  Game thread pump started
11:14:51.785  Event drained on frame 77: ... = 42          <- A: main menu
11:15:07.548  Pump heartbeat: 3600 frames
11:15:20.973  Pump heartbeat: 7200 frames
11:15:34.531  Pump heartbeat: 10800 frames
11:15:49.014  Pump heartbeat: 14400 frames                  (B: no event)
11:16:03.559  Pump heartbeat: 18000 frames
11:16:17.826  Pump heartbeat: 21600 frames
11:16:31.075  Pump heartbeat: 25200 frames
11:16:44.365  Pump heartbeat: 28800 frames
11:16:51.643  Event drained on frame 31010: ... = 42        <- C: load save
11:17:23.831  Pump heartbeat: 32400 frames                  (D: no event)
11:17:57.073  Pump heartbeat: 36000 frames
11:18:40.765  Event drained on frame 39200: ... = 42        <- E: load from pause menu
11:18:43.433  Pump heartbeat: 39600 frames
11:19:19.858  Game thread pump stopped after 41364 frames  <- quit, 39 s after E
```

Each event line reads `PlayerPuppet.OnGameAttached REDnode_Ping(21) = 42` in full.

The two minutes between A and C cover the sync wait, the A pause and step B, and contain no event. The 1 minute 49 seconds between C and E cover the C pause, step D with its pause, and the load in step E, and also contain no event.

## Pump frame rate

A "frame" here is one call of the pump's `OnUpdate` in the `Running` game state. The heartbeat counts pump updates, not seconds, so it is not a clock.

| Session | Main menu | Gameplay |
|---|---|---|
| 1 | About 200 to 290 fps | As low as about 35 fps |
| 2 | About 265 fps | About 110 fps |

Session 1 ran while Steam was syncing saves from the cloud, which may explain its lower gameplay rate. That is **unverified**.

## Next

- Decide the Tier 2 IPC transport (see the open decisions in [native/README.md](https://github.com/Edgemodders/REDnode/blob/main/native/README.md)). That starts P2.
- Work out how to tell a real session start from the main-menu attach.
