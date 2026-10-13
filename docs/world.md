# World API

Status: **W1 passed in game on 2026-10-13** ([results](#w1-results)). W2 is planned, after overlay phase O9. Phases W1 and W2 answer requests from [EDGEbuilder](https://edgemodders.github.io/EDGEbuilder/design.html), the world builder, filed as [`request` issues](https://github.com/Edgemodders/REDnode/issues?q=is%3Aissue+label%3Arequest). Order agreed with the user on 2026-10-13: REDagent's C5 test, then **W1**, then overlay phase O9 Debugger, then **W2**.

EDGEbuilder places objects in the running game: an empty entity spawned through Codeware, with a mesh, light or other component attached while it assembles. The `api` in the `rednode` package can call any game function and read properties ([Overlay apps: the game API](overlay-apps.md#the-game-api)), but it cannot yet build objects, write properties, pass resource references or hear an entity assemble.

## W1 World API

For EDGEbuilder's phase B1 (browse and drop) and B2 (position).

| Piece | Request | Plan |
|---|---|---|
| `api.$new(className, props?)` | [#1](https://github.com/Edgemodders/REDnode/issues/1) | The plugin builds any native object by class name and returns a game reference, like any object `api` returns. `props` sets properties first, with the same type checks function arguments get. A plain struct comes back as its value |
| `ref.$set(prop, value)` | [#1](https://github.com/Edgemodders/REDnode/issues/1) | Writes one property of a game object, type checked like `$get` reads |
| Resource references | [#3](https://github.com/Edgemodders/REDnode/issues/3) | Where a function or property expects a resource reference (`rRef`, `raRef`, `ResRef`), a path string (`"base/.../crate_a.mesh"`, hashed the way the game hashes depot paths) or a hash string is accepted. Reading one gives the hash; turning a hash back into a path needs an asset index, which REDbridge has |
| Entity callbacks | [#2](https://github.com/Edgemodders/REDnode/issues/2) | A small redscript part of REDnode, active only when Codeware (1.14 or later) is installed, turns Codeware's `Entity/Initialize` and `Entity/AfterAttach` (alias `Entity/Attached`) callbacks into REDnode events for the entities a mod watches (not every entity in the world, which would flood the pipe) |
| `api.spawn(...)` | [#2](https://github.com/Edgemodders/REDnode/issues/2) | A helper on top: spawns an entity through Codeware with a template, transform, appearance and components to attach, and resolves when it is attached. Hides the timing from every mod that places things |
| Per-frame budget | [#1](https://github.com/Edgemodders/REDnode/issues/1) | Measure `api` round trips per game frame in game. Add `api.$batch([...])` only if one call per frame is tight |

**Codeware, researched 2026-10-13** from its source at tag v1.20.5 (the latest) and its wiki. Codeware is MIT. The user's game has it installed.

| Fact | Source | Consequence for W1 |
|---|---|---|
| `GameInstance.GetCallbackSystem().RegisterCallback(eventName, target, function)` returns a handler with `AddTarget(...)`, `SetRunMode(...)`, `SetLifetime(...)`, `Unregister()` | `scripts/Callback/CallbackSystem.reds`, `CallbackSystemHandler.reds` | REDnode's redscript part registers from a `ScriptableSystem`, where callbacks stay registered until unregistered |
| Lifecycle order: `Entity/Extract`, `Entity/Assemble` (no entity ID yet), `Entity/Initialize` (ID assigned), `Entity/Reassemble`, `Entity/Attach` (may fire more than once), `Entity/AfterAttach`, `Entity/Detach`, `Entity/Uninitialize` | wiki "Game events"; `src/App/Callback/Controllers/` | |
| **`Entity/Attached` is deprecated:** it is now an alias of `Entity/AfterAttach` | `EntityAttachHook.hpp` | REDnode names the event `Entity/AfterAttach` and accepts `Entity/Attached` as an alias, since EDGEbuilder asked for that name |
| `Entity/Initialize` is dispatched before the entity gathers its components, so `Entity.AddComponent(component)` there is picked up. Codeware's wiki warns components must be added "at the right moment, for example, when entity is assembled" | `EntityRequestComponentsHook.hpp`; wiki "Components" | `api.spawn` attaches the components in `Entity/Initialize` |
| Targets by ID or tag match only once the entity has an ID, which it lacks at `Entity/Assemble` | `DynamicEntityTarget.Matches` | Watch with `EntityTarget.ID(...)` or `DynamicEntityTarget.Tag(...)` from `Entity/Initialize` on. **Unverified in game** |
| `GameInstance.GetDynamicEntitySystem().CreateEntity(spec) -> EntityID`; `DynamicEntitySpec` has `recordID` or `templatePath`, `appearanceName`, `position`, `orientation`, `tags`, `persistState`, `persistSpawn`, `alwaysSpawned`, `spawnInView`, `active`; `GetEntity(id)`, `IsSpawned(id)`, `DeleteEntity(id)` | `scripts/World/DynamicEntitySystem.reds`, `DynamicEntitySpec.reds` | `api.spawn` builds the spec from its options and tags its entities, so the callbacks target only REDnode's |
| `entMeshComponent` has `mesh` (`raRef<CMesh>`), `meshAppearance`, `visualScale`, plus Codeware's `LoadAppearance()` | `scripts/Base/Addons/MeshComponent.reds` | The resource reference support (#3) sets `mesh` from a path |
| Minimum versions: the handler API and targets 1.9.0, `Entity/AfterAttach` 1.14.0. The redscript module is `Codeware`; `Codeware.Require(version)` checks at run time | `git log` of the repo; `scripts/Facade.reds` | REDnode's redscript part needs Codeware 1.14 or later and compiles only when it is installed. The exact `@if(ModuleExists(...))` syntax is redscript's: **to confirm** |
| No Codeware example spawns an entity with a mesh component attached; the nearest adds a mesh to the player | wiki "Components", "Spawning dynamic entities" | Spawn, attach in `Entity/Initialize`, and the mesh appearing is what the W1 test proves |

**Codeware stays optional** (agreed with the user on 2026-10-13). REDnode itself never needs it: `$new`, `$set` and resource references are plain REDnode plugin code. Only the entity events and `api.spawn` use Codeware. Their redscript part is compiled only when Codeware is installed; without it, those calls fail with a clear message ("needs Codeware 1.14 or later"), and a package that uses them says so with W2's `requires`. Rebuilding Codeware's entity hooks inside REDnode would duplicate a maintained MIT library and risk the two clashing in players' games.

**The test proves:** a mod spawns a crate in front of V, with its mesh set by path, moves it every frame without dropping frames, and removes it; the entity events arrive for it and only it.

### W1: built

| Piece | Where |
|---|---|
| `rtti.new`, `rtti.set` | `native/src/overlay/reflect.cpp`. An object made by `rtti.new` is held by its reference (references are otherwise weak) until released or a save loads |
| Resource references | `reflect.cpp`: a path is hashed with the SDK's `ResourcePath::HashSanitized`, the game's own clean-up and hash; an `rRef` starts loading when set. Scripts' `ResRef` (`redResourceReferenceScriptToken`) reads and writes as the reference itself |
| Codeware part | `native/scripts/REDnodeWorld.reds`, compiled only with Codeware (`@if(ModuleExists("Codeware"))`): a `ScriptableSystem` registers `Entity/Initialize`, `Entity/AfterAttach` and `Entity/Detach` for entities tagged `REDnode`, or watched by ID. `Spawn` gives each spawn its own tag too, which keys its components, so they are added in that entity's `Entity/Initialize` and no other. `Delete`, `Move` (Codeware's `Entity.SetWorldTransform`) and `Watch` |
| Events | A native `REDnode_EntityEvent(name, entityID, entityType)` queues them; the plugin sends them as game events with `entityId` and `entityType`. The entity itself is not sent: game events go to every mod and page, and references are counted per hand-out |
| Package | `api.$new`, `ref.$set`, and `world` (`packages/rednode/src/world.ts`) |
| Sample | `packages/overlay/apps/world-test` |
| Plugin | 0.15.0 |

Checked before the game: both scripts compile with the redscript compiler (v1.0.0-preview.22) against the game's own script bundle, with Codeware's scripts and without them; the check found and fixed two errors (`OnAttach` must be public, and `EntityID.GetHash` gives only 32 bits, so the event takes the `EntityID` itself). The package's `world.spawn`, `move`, `remove`, `$new` and `$set` pass a check against a fake game. The plugin builds and its unit tests pass. **Not checked before the game:** building objects, writing properties, resource references and the Codeware part, which only the game can run.

### W1 test

Use the **Test timer**: Start, then Mark after each step. The World test uses World Builder's empty entity and box (`base\spawner\...`), which the user's game has.

1. Close the game. Deploy REDnode. Start the game and load a save. Check `r6/logs/redscript_rCURRENT.log` compiled without errors (REDnode's scripts are in it). Mark.
2. F10, Mod Manager: switch **World test** on. Its window says "World API ready (Codeware found)". Mark.
3. Face an open spot and press **Spawn box**. A box appears about 3 metres in front of V; the window says how long it took, and the events `Entity/Initialize` and `Entity/AfterAttach` appear for it. Mark.
4. Press **Spin 10 s** and watch: the box circles for 5 seconds one move at a time, then 5 seconds ten at a time. The window shows the moves per second each way. Mark.
5. Press **Remove**: the box goes, and `Entity/Detach` appears. Mark.
6. Press **Next mesh**, then **Spawn box**: the base game's marker mesh this time. Remove it. Mark.
7. Quit the game. I read the moves per second against the plugin's frame rate in its perf lines, to answer EDGEbuilder's per-frame question.

### W1 results

**2026-10-13: passed.** REDnode 0.15.0, Codeware installed. The scripts compiled in the game. World test spawned World Builder's empty entity with a mesh component built by `api.$new` with its mesh set by path, in 254 to 257 ms from the click; the box appeared in front of V. `Entity/Initialize` and `Entity/AfterAttach` arrived for it, and only for it. `world.remove` removed it, and `Entity/Detach` arrived. The base game's marker mesh worked the same way.

| Measure | Result |
|---|---|
| Spawn to in the world | 254 to 257 ms |
| Moves, one after another (each awaited) | 30 a second at 30 fps: one call a frame, since a call's answer comes the frame after it runs |
| Moves, ten at a time | 302 a second at 30 fps: every call waiting when a frame starts runs in that frame. So `api.$batch` is not needed: send the calls without awaiting each one. The game thread takes at most 256 waiting calls a frame |
| Frame rate | 53 to 61 fps before and after, **30 fps during the 10 seconds of moves**. Unknown yet whether the moves cost it (a few ms can halve the rate under vsync) or something else: the plugin did not time game calls. **Added in 0.15.1:** the perf line gives game calls a second and their milliseconds a frame |

| Finding | Notes |
|---|---|
| World test's window did not show until Restart | The plugin drew at most 16 windows, and refused the 17th (World test's) with only a line in its own log; 17 were open with the samples, mods and built-in apps. **Fixed in 0.15.1:** up to 64 windows, and a refused window is reported in the host's log |

## W2 Packaging

| Piece | Request | Plan |
|---|---|---|
| `requires` in the manifest | [#5](https://github.com/Edgemodders/REDnode/issues/5) | `"requires": { "codeware": ">=1.16", "archivexl": ">=1.23" }`. The host checks the RED4ext plugins and redscript modules installed in the game; the Mod Manager shows what is missing next to the package, and the package can read the result |
| `kernel.bridge()` | [#4](https://github.com/Edgemodders/REDnode/issues/4) | How to reach a running REDbridge, behind a `bridge` permission the player grants, like `kernel.mcp()`. The host finds the copy REDdeck or REDcode already fetched and starts it on demand. REDbridge stays its own GPL-3.0 program, reached over JSON-RPC |

**The test proves:** a package that requires something missing says so in the Mod Manager, and a package with the `bridge` permission lists the game's archives through REDbridge.
