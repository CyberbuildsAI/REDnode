# World API

Status: **planned.** Phases W1 and W2 answer requests from [EDGEbuilder](https://edgemodders.github.io/EDGEbuilder/design.html), the world builder, filed as [`request` issues](https://github.com/Edgemodders/REDnode/issues?q=is%3Aissue+label%3Arequest). Order agreed with the user on 2026-10-13: REDagent's C5 test, then **W1**, then overlay phase O9 Debugger, then **W2**.

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

**The test proves:** a mod spawns a crate in front of V, with its mesh set by path, moves it every frame without dropping frames, and removes it; the entity events arrive for it and only it.

## W2 Packaging

| Piece | Request | Plan |
|---|---|---|
| `requires` in the manifest | [#5](https://github.com/Edgemodders/REDnode/issues/5) | `"requires": { "codeware": ">=1.16", "archivexl": ">=1.23" }`. The host checks the RED4ext plugins and redscript modules installed in the game; the Mod Manager shows what is missing next to the package, and the package can read the result |
| `kernel.bridge()` | [#4](https://github.com/Edgemodders/REDnode/issues/4) | How to reach a running REDbridge, behind a `bridge` permission the player grants, like `kernel.mcp()`. The host finds the copy REDdeck or REDcode already fetched and starts it on demand. REDbridge stays its own GPL-3.0 program, reached over JSON-RPC |

**The test proves:** a package that requires something missing says so in the Mod Manager, and a package with the `bridge` permission lists the game's archives through REDbridge.
