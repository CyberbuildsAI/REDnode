# P0 findings: RED4ext plugin ABI

Status: **in progress.** The RED4ext side is mapped. Cyber Engine Tweaks (CET) hooking is not analysed yet.

Sources: the local install (game 2.31, file version `3.0.80.51928`, RED4ext 1.30.0), a PE export/import dump (`tools/pedump.py`), RED4ext logs, and a shallow clone of [RED4ext.SDK](https://github.com/WopsS/RED4ext.SDK) (MIT, master at `ad72777`, 2026-07-30). The SDK clone is master, not necessarily the exact revision matching RED4ext 1.30.0.

## Verified on the install

### Loader chain

```
Cyberpunk2077.exe
 └─ bin/x64/winmm.dll          RED4ext loader. Proxy exporting 181 winmm functions.
     └─ red4ext/RED4ext.dll    Exports one function: RED4ext_ResolveAddress.
         ├─ reads red4ext/config.ini
         ├─ loads bin/x64/cyberpunk2077_addresses.json   (921,876 addresses)
         ├─ loads red4ext/plugins/<Name>/<Name>.dll       (alphabetical order)
         └─ runs scc (redscript) and redirects the script blob to
            r6/cache/final.redscripts.modded
 └─ bin/x64/version.dll        Ultimate ASI Loader 6.0.0
     └─ bin/x64/plugins/*.asi  cyber_engine_tweaks.asi
```

Plugins load at startup and unload at shutdown. The log shows 6 plugins loaded in about 1.8 seconds and unloaded in reverse order of completion.

### Plugin entry points

Codeware, RedData and DriveAerialVehicle each export exactly these three functions:

| Export | Purpose |
|---|---|
| `Supports` | Returns the API version (`RED4EXT_API_VERSION_1` = 1). |
| `Query` | Fills a `PluginInfo`: name, author, plugin version, SDK version, supported game version. |
| `Main` | Called on load and unload. |

None of them import `RED4ext.dll`. The SDK is passed to `Main` at runtime, so a plugin has no link-time dependency on the loader.

DriveAerialVehicle also exports its own functions (`PostRegisterAddForce`, `RegisterFlyAVSystem`, and others). Plugins can expose an API to other plugins this way.

## From the SDK source (v1 API)

```cpp
RED4EXT_C_EXPORT uint32_t RED4EXT_CALL Supports();                       // return RED4EXT_API_VERSION_1
RED4EXT_C_EXPORT void     RED4EXT_CALL Query(RED4ext::v1::PluginInfo*);
RED4EXT_C_EXPORT bool     RED4EXT_CALL Main(RED4ext::v1::PluginHandle,
                                            RED4ext::v1::EMainReason,    // Load = 0, Unload
                                            const RED4ext::v1::Sdk*);
```

`Sdk` gives a plugin four interfaces and the game's product version:

| Field | Operations |
|---|---|
| `runtime` | `SemVer*`: the game's product version (not the file version). |
| `logger` | `Trace`, `Debug`, `Info`, `Warn`, `Error`, `Critical`, each with narrow, wide and formatted variants. |
| `hooking` | `Attach(handle, target, detour, &original)` and `Detach(handle, target)`. |
| `gameStates` | `Add(handle, type, GameState*)` where a `GameState` has `OnEnter`, `OnUpdate`, `OnExit`. |
| `scripts` | `Add(handle, path)` adds a `.reds` file. `RegisterNeverRefType` and `RegisterMixedRefType` declare ref semantics. |

RTTI access goes through `CRTTISystem::Get()`: `GetClass`, `GetFunction`, `GetClasses`, `AddRegisterCallback` and `AddPostRegisterCallback`. Native functions are added with `CClassFunction::Create(...)` and `RegisterFunction`. `RED4ext::ExecuteFunction(class, function, &out, args...)` calls script functions.

## What this means for REDnode

These are hypotheses to prove in P1. None has been tested yet.

1. **Game-thread pump.** `GameStates::Add` with an `OnUpdate` callback runs once per frame on the game thread. That is a natural place to drain the command queue coming from Node. It needs checking which `EGameStateType` is right (the enum values have not been read yet).
2. **Synchronous interception without raw hooks.** A plugin can register a native function on an RTTI class, and redscript can call it. A `.reds` wrapper (`@wrapMethod`) around a game method can call that native function and use its return value, all on the game thread. This gives Tier 1 a synchronous path that needs no hook addresses and survives patches better than `Hooking::Attach`.
3. **Events for Tier 2.** The same wrapper pattern can call a native `Emit` function that only enqueues an event and returns, which is cheap and never blocks.
4. **Shipping scripts.** `Scripts::Add`, and the on-disk layout of ArchiveXL and Codeware (`red4ext/plugins/<Name>/Scripts/*.reds`), show how a plugin ships its redscript half.
5. **Language.** The SDK is C++ and MIT licensed. `red4ext-rs` has not been examined here.

## Corrections to earlier notes

- An earlier note cited Audioware as a Rust RED4ext plugin on this install. Only an `r6/audioware` folder exists. No Audioware DLL is in `red4ext/plugins`, so that claim is unverified.

## Not yet done

- CET: the `.asi` exports nothing and imports `dxgi.dll`, `d3dcompiler_47.dll`, `GDI32.dll` and `IMM32.dll`, which fits a DirectX overlay with input handling. How it hooks the game and resolves addresses has not been examined.
- Read `EGameStateType` and pick the right state for the frame pump.
- Check the format of `cyberpunk2077_addresses.json` and how `RED4ext_ResolveAddress` is used.
- Look at `red4ext-rs` and decide between C++ and Rust.
- Prove hypotheses 1 to 3 with a hello-world plugin (P1).
