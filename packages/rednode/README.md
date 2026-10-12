# rednode

The REDnode SDK: a Node.js API for scripting Cyberpunk 2077 (PC, single-player).

> **Status: design phase.** This reference documents the planned API. Every function throws until the native bridge exists.

## Two tiers

| | Tier 2: async mods | Tier 1: interceptors |
|---|---|---|
| Runs in | A separate Node process | The game process, sandboxed |
| Can | Observe events, query state, send commands | Change arguments or return values inside a hook |
| Cannot | Block the game | `await`, do I/O, run long |
| Start with | `game` | `defineInterceptor` |

```ts
import { game, interceptor } from "rednode";

game.on("PlayerPuppet.OnGameAttached", async () => {
  const hp = await game.player.getHealth();
  interceptor("damage-scale").set("multiplier", hp < 50 ? 0.5 : 1);
});
```

Read the [design document](https://edgemodders.github.io/REDnode/design.html) for the architecture.
