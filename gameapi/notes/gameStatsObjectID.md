# gameStatsObjectID

`StatsObjectID` in scripts: which object a stat or stat pool belongs to. For an entity, cast its `EntityID`; the cast is the global function `Cast;EntityID;StatsObjectID`.

```js
// REDnode: V's stats id. Tested in game on 2.31 (2026-10-12).
const statsId = await api.$call('Cast;EntityID;StatsObjectID', await player.GetEntityID());
```

`entityHash` is a Uint64, so REDnode carries it as a string.
