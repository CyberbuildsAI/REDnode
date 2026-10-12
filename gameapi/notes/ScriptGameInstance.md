# ScriptGameInstance

`GameInstance` in scripts: the running game, passed as the first argument of `GetPlayer` and of every `GameInstance.Get...System` function.

From REDnode, pass `game.instance`. The plugin fills in the running game whatever is passed. A `GameInstance` built only from the type data has no game in it, and functions given one answer as if nothing existed: `GetPlayer` returns null. Found and fixed in the [O6b test](https://edgemodders.github.io/REDnode/overlay.html#o6b-game-api-test) (2026-10-12).

```js
// REDnode, from a Node mod or an overlay app
const player = await api.GetPlayer(game.instance);
const stats = await api.GameInstance.GetStatsSystem(game.instance);
```
