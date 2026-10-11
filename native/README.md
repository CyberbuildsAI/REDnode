# native

The RED4ext plugin. Not started.

## Responsibilities

- Enumerate RTTI classes, functions and properties for type generation.
- Call functions and get or set properties on game objects.
- Hook functions through RED4ext and the Address Library.
- Marshal game types (`CName`, `Vector4`, handles, arrays) to and from JSON-like values.
- Queue all incoming commands and run them on the game thread. Game objects are not thread-safe.
- Manage object handle lifetime so Node never holds a stale reference.
- Later: apply declarative rules in hooks, and host the sandboxed Tier 1 interceptor runner.

## Open decisions

- Language: C++ with RED4ext.SDK, or Rust with `red4ext-rs`.
- IPC transport: named pipe, local socket, or shared memory for hot data.

## Install layout (reference)

RED4ext loads plugins from `red4ext/plugins/<name>/<name>.dll` next to the game's `bin/`. The plugin entry points are `Query`, `Main` and `Supports`. P0 in the roadmap confirms the exact ABI against the SDK.
