# gameStatsSystem

`StatsSystem` in scripts: an object's stats, such as level and attributes. Get it with `GameInstance.GetStatsSystem(gameInstance)`.

## GetStatValue

A stat's current value. Tested in game on 2.31 (2026-10-12) for V's `Level`, against the character screen: [O6b test](https://edgemodders.github.io/REDnode/overlay.html#o6b-game-api-test).

```js
const stats = await api.GameInstance.GetStatsSystem(game.instance);
const level = await stats.GetStatValue(statsId, 'Level');
```
