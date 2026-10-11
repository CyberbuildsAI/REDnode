# P1 results: in-game probe test

Status: **passed.** The probe plugin loads, both tier paths work, and the game-thread pump runs and stops cleanly. One detail is not explained yet: the probe event fired twice in one session. A follow-up test is planned below.

## Setup

| Item | Value |
|---|---|
| Date | 2026-10-11 |
| Game | Cyberpunk 2077 2.31 (file version `3.0.80.51928`), Steam |
| RED4ext | 1.30.0 |
| redscript | Present, run by RED4ext as `scc` |
| Other mods | ArchiveXL, Codeware, TweakXL, audioware, CET and about 10 more, managed by Vortex |
| REDnode | 0.1.0, the P1 probe from [native/](https://github.com/CyberbuildsAI/REDnode/tree/main/native), built with MSVC 14.44 |

The probe was deployed by hand with `tools/deploy-native.ps1`, not through Vortex.

## What the player did

1. Launched the game from Steam. Steam was still syncing saves from the cloud.
2. Tried to load a save a couple of times. Loading had to wait until the cloud sync finished.
3. Loaded a save and played for about two minutes.
4. Saved the game once.
5. Quit to desktop through the menu.

The exact time of each action was not recorded.

## Results

| Check | Expected | Result |
|---|---|---|
| Plugin loads | RED4ext lists REDnode as loaded | Passed: `REDnode (version: 0.1.0, author(s): CyberbuildsAI) has been loaded` |
| Script compiles | No redscript errors | Passed: `REDnode.reds` compiled with all other mods, `Compilation complete` |
| RTTI access | Type and function counts | Passed: 12,039 types, 716 global functions |
| Tier 1 path | Synchronous call returns its value to the script | Passed: `REDnode_Ping(21) = 42` |
| Tier 2 path | Queued event handled on the game thread | Passed: drained by the pump on frame 80 |
| Pump | Starts, logs heartbeats, stops | Passed: 6 heartbeats, stopped after 23,782 frames |
| Shutdown | Plugin unloads | Passed: `REDnode has been unloaded` |

## Log

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

RED4ext started at 10:57:16 and logged the unload at 11:01:45. The game process took several more seconds to exit after the player quit.

## Observations

### The probe event fired twice

`PlayerPuppet.OnGameAttached` ran on frame 80 and again on frame 9,608, about 38 seconds apart. The probe only reacts to that callback, so the game attached a player puppet twice.

The cause is **unverified**. Possible reasons:

| Hypothesis | Notes |
|---|---|
| The main menu attaches a player puppet | Frame 80 is 2 seconds after the pump started. That is likely before the cloud sync finished and before any save could load |
| Each save load attaches the player again | The player tried to load more than once. Only one load is known to have completed |
| Opening the load-save list attaches a puppet | Not expected, but not ruled out |
| Saving the game attaches a puppet | Not expected, but not ruled out |

Either way the probe behaved correctly. Each call returned 42 and was drained on the game thread. For later phases this matters: mods must not assume `OnGameAttached` runs once per session.

### Pump frame rate varies a lot

A "frame" here is one call of the pump's `OnUpdate` in the `Running` game state. Rates worked out from the heartbeat times:

| Interval | Frames | Seconds | About fps |
|---|---|---|---|
| Start to 3,600 | 3,600 | 17.6 | 204 |
| 3,600 to 7,200 | 3,600 | 14.0 | 258 |
| 7,200 to 10,800 | 3,600 | 26.2 | 137 |
| 10,800 to 14,400 | 3,600 | 103.5 | 35 |
| 14,400 to 18,000 | 3,600 | 29.6 | 122 |
| 18,000 to 21,600 | 3,600 | 12.4 | 289 |
| 21,600 to stop | 2,182 | 15.4 | 141 |

High rates fit menus and loading screens, and the 35 fps stretch fits gameplay. This is **unverified** because the actions were not timed. The heartbeat counts pump updates, not seconds, so it is not a clock.

## Follow-up: ordered retest

Goal: tie each `OnGameAttached` event to a specific player action. Do one run per row. Start each run from a closed game. Wait for Steam cloud sync to finish before doing anything in the menu. Write down the clock time of each action, to the second if possible.

| Run | Actions, in order | Answers |
|---|---|---|
| A | Launch. Stay on the main menu for 60 seconds without touching anything. Quit | Does the main menu fire the event? |
| B | Launch. Open the load-save list, back out. Repeat once. Quit | Does browsing saves fire it? |
| C | Launch. Load one save. Play 60 seconds. Quit | One event per load? |
| D | Launch. Load a save. Save the game. Wait 30 seconds. Quit | Does saving fire it? |
| E | Launch. Load save 1. Play 30 seconds. Load save 2 from the pause menu. Play 30 seconds. Quit | Does loading in-game fire it again? |

After each run, read `red4ext/logs/rednode-*.log` and match event times to the written times.

## Next

- Run the ordered retest above.
- Decide the Tier 2 IPC transport (see the open decisions in [native/README.md](https://github.com/CyberbuildsAI/REDnode/blob/main/native/README.md)). That starts P2.
