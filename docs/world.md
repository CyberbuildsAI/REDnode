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
| Entity callbacks | [#2](https://github.com/Edgemodders/REDnode/issues/2) | A small redscript part of REDnode, active only when Codeware is installed, turns Codeware's `Entity/Initialize` and `Entity/Attached` callbacks into REDnode events for the entities a mod watches (not every entity in the world, which would flood the pipe) |
| `api.spawn(...)` | [#2](https://github.com/Edgemodders/REDnode/issues/2) | A helper on top: spawns an entity through Codeware with a template, transform, appearance and components to attach, and resolves when it is attached. Hides the timing from every mod that places things |
| Per-frame budget | [#1](https://github.com/Edgemodders/REDnode/issues/1) | Measure `api` round trips per game frame in game. Add `api.$batch([...])` only if one call per frame is tight |

**To research first:** Codeware's callback system and its entity spawning API, from its own documentation and source, not from memory. Constructing a component and attaching it while an entity assembles is new ground for REDnode; the in-game test proves it.

**The test proves:** a mod spawns a crate in front of V, with its mesh set by path, moves it every frame without dropping frames, and removes it; the entity events arrive for it and only it.

## W2 Packaging

| Piece | Request | Plan |
|---|---|---|
| `requires` in the manifest | [#5](https://github.com/Edgemodders/REDnode/issues/5) | `"requires": { "codeware": ">=1.16", "archivexl": ">=1.23" }`. The host checks the RED4ext plugins and redscript modules installed in the game; the Mod Manager shows what is missing next to the package, and the package can read the result |
| `kernel.bridge()` | [#4](https://github.com/Edgemodders/REDnode/issues/4) | How to reach a running REDbridge, behind a `bridge` permission the player grants, like `kernel.mcp()`. The host finds the copy REDdeck or REDcode already fetched and starts it on demand. REDbridge stays its own GPL-3.0 program, reached over JSON-RPC |

**The test proves:** a package that requires something missing says so in the Mod Manager, and a package with the `bridge` permission lists the game's archives through REDbridge.
