# Kernel MCP server

The REDnode host can serve its tools to AI agents over [MCP](https://modelcontextprotocol.io), the Model Context Protocol. With it, Claude Code on your PC can read your mods' logs, see your overlay windows, look up game types and call the game while it runs. [REDagent](https://github.com/Edgemodders/REDagent), the assistant inside the game, will use the same tools.

Status: **REDagent phase C1, passed in game on 2026-10-12.** Claude Code on the desktop used every tool while the game ran.

## Set it up

| Step | How |
|---|---|
| 1. Turn it on | In the game, open the REDnode launcher (**F10**, then the REDNODE tab). Switch **MCP server** on. For developers running the host from the repo, it is on already |
| 2. Copy the setup command | Press **Copy setup** in the launcher |
| 3. Add it to Claude Code, once | Paste the command into a terminal on the same PC and run it. It looks like `claude mcp add --transport http --scope user rednode http://127.0.0.1:41820/mcp --header "Authorization: Bearer ..."` |
| 4. Check | `claude mcp list` shows `rednode` as connected while the game runs |
| 5. Use it | Start a new Claude Code session. Ask, for example, "using the rednode tools, what is V's health?" |

The server listens only on `127.0.0.1`, port 41820, and every request needs the token from the setup command. The token is made once and kept in the host's settings, so the setup keeps working. It only answers while the game, and with it the host, is running.

## Tools

| Tool | Gives | Changes anything |
|---|---|---|
| `logs` | What Node mods printed, newest last: all, one mod, or errors only. The same lines as the Mod log app | No |
| `apps` | The installed apps and mods: open or running, a mod's state, process, memory and last error, and its window ids. With `open`, `close` or `restart`, changes one as the launcher does | Only with an action |
| `game_state` | Whether REDnode is linked to the game, what the game shows (menu, photo mode, scene, main menu), the overlay mode | No |
| `perf` | The game's frame rate, the overlay's cost per frame, the host's memory and each mod process's memory | No |
| `gameapi_lookup` | Game types and functions with the TypeScript signatures `api` uses, and REDnode's notes. An exact name (`StatsSystem` or `gameStatsSystem`) gives the declaration; part of a name searches | No |
| `window_text` | The text an overlay window shows, including inside UI kit components and input fields | No |
| `window_image` | A picture of an overlay window: its own pixels, before REDnode places it on the game. Not the game behind it, its place on screen, or the cursor | No |
| `game_image` | A picture of the game's screen now: the game alone, or with `overlay: true` the overlay windows and cursor on it, as the player sees it. Scaled to at most `maxWidth` (default 1280). HDR is converted to SDR, so its colors are approximate. Fails while the game is loading or minimized. Plugin 0.13.0 or later | No |
| `api_call` | A live game call, as `api` makes it: a global function, a static function (`class`), or a method (`self`). Game objects come back as `{ "$ref": n, "$type": "..." }` | **Yes**: it can change the player's game, such as money or health |
| `api_get` | A property of a game object | No |

A REDnode package can use the same tools: it lists `"permissions": ["mcp"]` in its `rednode-app.json`, the player allows it in the launcher, and `kernel.mcp()` in the `rednode` package gives it the address and its own token. The server then runs for it even with the **MCP server** switch off; that switch only controls access from outside, such as Claude Code. REDagent uses the tools this way.

Claude Code asks before it uses a tool, unless you allow it. Allow the read-only tools freely; keep `api_call` on ask.

The server also gives the agent short instructions: what REDnode is, what each tool is for, and the game API's rules (the game instance is `{}`, 64-bit numbers are strings, references die when a save loads).

## C1 test

Built 2026-10-12, host 0.4.0. Tested against a stand-in for the game with an MCP client that calls every tool (15 checks), packaged and unpackaged, with GPU sharing on and off: the token is required, and every tool answers.

In the game, in this order. Claude Code runs on the same PC; switch to it with **Alt+Tab**:

1. Start the game and load a save.
2. **F10**, open the launcher, switch **MCP server** on, and press **Copy setup**.
3. Alt+Tab to a terminal, paste the command and run it. Then run `claude mcp list`: `rednode` shows as connected.
4. Start a **new** Claude Code session (MCP servers load when a session starts), and ask in turn:
   1. "Using the rednode tools, what are V's health, level and money?" It should look up the functions, then call the game. Claude Code asks before each `api_call`; allow them.
   2. "Show me the errors in the REDnode mod log." Switch Crash mod on and press **Throw an error** first, so there is one.
   3. "Capture the Hello mod window and tell me what it shows."
   4. "What does the game show right now, and what does the overlay cost?" Ask once in gameplay and once with the inventory open.
   5. "Close the Coords HUD, then open it again." Watch it go and come back in the game.
   6. "Give V 50 eddies." Claude Code should ask first; allow it, and check the money in Vitals.
5. Quit the game. In Claude Code, `claude mcp list` now shows `rednode` as failing to connect, which is expected while the game is closed.

**Result, 2026-10-12: passed.** Modded profile with CET, 3840 x 2160, host 0.4.0. `claude mcp list` showed `rednode: http://127.0.0.1:41820/mcp (HTTP) - ✔ Connected`. In a new Claude Code session, every question worked: V's health, level and money through `gameapi_lookup` and `api_call`; the Crash mod's error from `logs`; a description of the Hello mod window from `window_image`; the game state and the overlay's cost, in gameplay and with the inventory open; Coords closed and opened again through `apps` (the host log shows both, two seconds apart); and 50 eddies given after Claude Code asked. The host logged no failed MCP request, and the plugin no crash inside a game call.

## For developers

| Item | Where |
|---|---|
| The server | [packages/overlay/mcp.js](https://github.com/Edgemodders/REDnode/blob/main/packages/overlay/mcp.js): `@modelcontextprotocol/sdk` 1.32.1, Streamable HTTP, stateless, JSON responses, DNS rebinding protection |
| The game type lookup | [packages/overlay/gameapi-lookup.js](https://github.com/Edgemodders/REDnode/blob/main/packages/overlay/gameapi-lookup.js), reading the generated `game.d.ts` and `gameapi/notes`. Packaged, both ship in `host/resources/gameapi` |
| Switches | `--mcp=on` or `--mcp=off` on the host's command line overrides the launcher. The port can be changed in the host's `settings.json` (`mcp.port`) |
