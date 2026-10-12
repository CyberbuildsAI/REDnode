# rednode

The REDnode SDK: a Node.js API for scripting Cyberpunk 2077 (PC, single-player).

> **Status: overlay phase O6 done.** `game`, `ui` and `api`, the generic game API (any game function, typed from the game's data), work in the REDnode overlay host for Node mods and overlay apps alike, tested in game on 2026-10-12. Tier 1 interceptors are still a design, and their functions throw.

## Two tiers

| | Tier 2: async mods and overlay apps | Tier 1: interceptors |
|---|---|---|
| Runs in | The REDnode host, outside the game | The game process, sandboxed |
| Can | Observe events, query state, send commands, open windows | Change arguments or return values inside a hook |
| Cannot | Block the game | `await`, do I/O, run long |
| Start with | `game`, `ui` | `defineInterceptor` |

A Node mod that opens a window and follows V:

```ts
import { game, ui } from "rednode";

const where = ui.text("Waiting for the game...");
ui.window({ title: "Where is V", children: [where] });

setInterval(async () => {
  const p = await game.player.position();
  where.set({ text: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` });
}, 500);

game.on("PlayerPuppet.OnGameAttached", () => console.log("A save was loaded"));
```

Anything else in the game, through `api`, typed from the game's own data:

```ts
import { api, game } from "rednode";

const player = await api.GetPlayer(game.instance);
const shop = await api.GameInstance.GetTransactionSystem(game.instance);
await shop!.GiveItem(player, await api.MarketSystem.Money(), 100);
```

The package's build generates those types from `gameapi/<version>/rtti.json` (about 9 MB).

How to write and install mods and apps: the [Overlay apps guide](https://edgemodders.github.io/REDnode/overlay-apps.html). The architecture: the [design document](https://edgemodders.github.io/REDnode/design.html).
