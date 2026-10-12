# gameStatPoolsSystem

`StatPoolsSystem` in scripts: values that go up and down, such as health, stamina and memory. Get it with `GameInstance.GetStatPoolsSystem(gameInstance)`.

## GetStatPoolValue

With `perc` false, the pool's value in points; with true, a percentage. Tested in game on 2.31 (2026-10-12) for V's `Health`, against the health bar: [O6b test](https://edgemodders.github.io/REDnode/overlay.html#o6b-game-api-test).

```js
const pools = await api.GameInstance.GetStatPoolsSystem(game.instance);
const hp = await pools.GetStatPoolValue(statsId, 'Health', false);
```

## RequestSettingStatPoolValue

Sets a pool's value. REDnode's `game.player.setHealth` uses it with `perc` false and no instigator. **Unverified**: not tested in game yet.
