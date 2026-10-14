# native

The RED4ext plugin. C++20, built with CMake against [RED4ext.SDK](https://github.com/WopsS/RED4ext.SDK) (MIT), which CMake fetches at a pinned revision.

The plugin is one part of REDnode; see [What REDnode is made of](https://edgemodders.github.io/REDnode/#what-rednode-is-made-of). Its version is REDnode's, read from `VERSION` at the repo root at build time. It began as the P1 probe, which passed in game on 2026-10-11 ([docs/p0-findings.md](../docs/p0-findings.md), [docs/p1-results.md](../docs/p1-results.md)).

## What the probe does

| Step | How | Proves |
|---|---|---|
| Load | `Query`, `Supports` and `Main` exports | RED4ext loads the plugin and its logger works |
| RTTI | Reads type and global function counts after registration | The plugin can see the game's reflection data |
| Tier 1 path | A redscript wrapper on `PlayerPuppet.OnGameAttached` calls `REDnode_Ping(21)` and uses the result | Synchronous script-to-native calls work |
| Tier 2 path | The wrapper calls `REDnode_Emit(...)`, which only queues the event | Scripts can hand events to the plugin without waiting |
| Game-thread pump | A `Running` game state drains the queue in `OnUpdate` once per frame | Queued work runs on the game thread |

## Build and deploy

Needs the Visual Studio 2022 Build Tools. See [docs/dev-setup.md](../docs/dev-setup.md).

```powershell
.\tools\build-native.ps1          # builds and stages native\build\dist\red4ext\plugins\REDnode
.\tools\deploy-native.ps1         # copies it into the game (close the game first)
.\tools\deploy-native.ps1 -Remove # takes it out again
```

Installed layout:

```
red4ext/plugins/REDnode/
  REDnode.dll
  Scripts/REDnode.reds
```

## Expected log after loading a save

`red4ext/logs/red4ext-*.log` should list `REDnode (version: 0.20.0, author(s): Edgemodders) has been loaded`. The plugin's own lines go to its log in `red4ext/plugins/REDnode/` or the RED4ext log:

```
REDnode <version> loading
RTTI ready: <n> types, <n> global functions
Game thread pump started
Event drained on frame <n>: PlayerPuppet.OnGameAttached = 42
Pump heartbeat: 3600 frames
```

`= 42` confirms the synchronous call returned its value to the script. The frame number confirms the event was handled on the game thread.

## RTTI dump

The plugin can also dump the game's type data for the [game API reference](https://edgemodders.github.io/REDnode/game/). Create an empty `dump.request` file next to `REDnode.dll`. When the game reaches the main menu, the plugin writes `rtti-dump.json` beside it, logs `RTTI dump written to ...` and deletes the request. Normal runs do nothing.

The dump holds every class, enum, bitfield and global function with names, types and flags. REDnode's own functions are left out. Code: [src/dump.cpp](src/dump.cpp). The full procedure, including the base-game setup, is in [docs/dev-setup.md](../docs/dev-setup.md), section 9.

## Overlay

The plugin also runs the in-game half of the [HTML overlay](../docs/overlay.md): a Present hook that draws overlay windows, a window hook for input (F10), and a named pipe to the overlay host. Code: [src/overlay/](src/overlay/). If `host/REDnode-overlay.exe` is next to the DLL, the plugin starts it with the game, in a job object so it ends with the game. Window logic has unit tests in [tests/](tests/), run by `tools/build-native.ps1`.

## Open decisions

- IPC transport for Tier 2: named pipe, local socket, or shared memory for hot data.
- C++ was chosen for P1 because the SDK and its examples are C++. `red4ext-rs` has not been evaluated.
