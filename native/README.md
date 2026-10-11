# native

The RED4ext plugin. C++20, built with CMake against [RED4ext.SDK](https://github.com/WopsS/RED4ext.SDK) (MIT), which CMake fetches at a pinned revision.

Current state: **P1 probe.** See [docs/p0-findings.md](../docs/p0-findings.md) for the hypotheses it tests.

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

`red4ext/logs/red4ext-*.log` should list `REDnode (version: 0.1.0, author(s): CyberbuildsEX) has been loaded`. The plugin's own lines go to its log in `red4ext/plugins/REDnode/` or the RED4ext log:

```
REDnode 0.1.0 loading (P1 probe)
RTTI ready: <n> types, <n> global functions
Game thread pump started
Event drained on frame <n>: PlayerPuppet.OnGameAttached REDnode_Ping(21) = 42
Pump heartbeat: 3600 frames
```

`= 42` confirms the synchronous call returned its value to the script. The frame number confirms the event was handled on the game thread.

## Open decisions

- IPC transport for Tier 2: named pipe, local socket, or shared memory for hot data.
- C++ was chosen for P1 because the SDK and its examples are C++. `red4ext-rs` has not been evaluated.
