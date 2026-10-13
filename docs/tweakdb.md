# TweakDB API

Status: **planned**, agreed with the user on 2026-10-13 ("We need to do it"). Phases T1 to T3, right after W2's in-game test and before overlay phase O7 Display. The user chose the recommended answers below on 2026-10-13: reads in the plugin, writes through TweakXL, undo per package.

TweakDB is the game's database of tuning data: items, weapons, vehicles, characters, perks, status effects, UI icons. It holds **records** (`Items.Preset_Yinglong_Default`, of a type such as `gamedataWeaponItem_Record`) and **flats**, the single values inside them (`Items.money.quality`). Most gameplay mods change TweakDB.

## What works today

| Need | Today | Gap |
|---|---|---|
| Read a value | `api` can call the game's `TweakDBInterface` getters: `GetFloat`, `GetInt`, `GetString`, `GetCName`, `GetForeignKey`, `GetVector3`, their array forms and more. A record path such as `"Items.money"` works where a TweakDBID is expected. **Unverified** in game | You must know each flat's type to pick the getter, and get a default when it is missing |
| Read a record | About 960 `Get...Record` functions (`GetItemRecord`, `GetWeaponItemRecord`) return record objects, typed from the game's data | No way to list the records of a type, or to ask what type a record is |
| Change a value or add a record | Not in the base game. [TweakXL](https://github.com/psiberx/cp2077-tweak-xl), installed on the user's PC (1.11.3), adds `TweakDBManager`: `SetFlat`, `CreateRecord`, `CloneRecord`, `UpdateRecord`, batches | Its values are `Variant`, which REDnode cannot convert yet. Its functions are not in the generated types (base game only) |
| Read without the game running | REDbridge's README lists a `tweakdb` method group (records, record, flats, query) | Not in REDbridge 0.5.1 yet |
| Static edits | TweakXL's YAML files in `r6/tweaks`, outside REDnode | None; they stay the way to ship fixed edits |

## Design

```js
import { tweakdb } from 'rednode';

// T1: read, no other mod needed
await tweakdb.get('Items.Preset_Yinglong_Default.quality');      // 'Quality.Legendary' (a TweakDBID, as its path when known)
const rec = await tweakdb.record('Items.Preset_Yinglong_Default'); // a game object, typed gamedataWeaponItem_Record
await rec.DisplayName();
await tweakdb.records('gamedataVehicle_Record');                   // every record of that type, as paths

// T2: write, needs TweakXL
await tweakdb.set('Items.Preset_Yinglong_Default.magazineCapacity', 60);
await tweakdb.clone('Items.MyYinglong', 'Items.Preset_Yinglong_Default');
await tweakdb.batch((b) => {
  b.set('Items.MyYinglong.displayName', 'LocKey#12345');
  b.set('Items.MyYinglong.quality', 'Quality.Iconic');
});
```

| Decision | Decided | Why |
|---|---|---|
| How to read | The REDnode plugin reads TweakDB itself, through the RED4ext SDK (`TweakDB::GetFlatValue`, `GetRecord`, `GetRecordsByType`). A flat comes with its own type, so `get` needs no type and converts with REDnode's existing JSON conversion | No dependency for the common case. Faster than one getter call per flat |
| How to write | Through TweakXL, declared with `"requires": { "tweakxl": ">=1.10" }` (W2) | TweakXL is the maintained standard: it handles record inheritance and the extra flats records need, and its edits work with every other TweakXL mod. The SDK could write too, but REDnode would copy that logic and could clash with TweakXL in players' games, as rebuilding Codeware would have (see [World API](world.md)) |
| Undo | REDnode remembers each flat's value before a package first changes it, and puts it back when that package stops (switched off, restarted, hot reloaded) | Edits made at runtime last until the game closes. Without undo, a mod's old edits stay after the player switches it off, and hot reload stacks them |
| Names | Paths in, paths out where known. A TweakDBID is a hash, so a value that points to another record comes back as a path only if the name is known: from REDnode's calls, from TweakXL's registered names, or from a names list (research below). Otherwise as `"0x..."` | The game keeps no names at runtime |
| Types | `tweakdb.record` returns the record's generated class (`gamedataWeaponItem_Record`), so its methods are typed. A `RecordTypes` map lets `records('gamedataVehicle_Record')` and `record<...>()` check names | Record classes are already in `gameapi/2.31/rtti.json` (signatures only) |
| No TweakDB data in the repository | The repository keeps only types. Paths, values and names are read from the player's game at runtime | The rule in CLAUDE.md: never commit game data, TweakDB included |

## Phases

| Phase | Builds | Test proves |
|---|---|---|
| **T1 Read** | Plugin: `tweakdb.get`, `tweakdb.record`, `tweakdb.records`, `tweakdb.type` (a record's type) on the game thread. `tweakdb` in the `rednode` package with TSDoc and examples. An MCP tool `tweakdb` for agents (REDagent can look values up while writing a mod). A sample app that shows a weapon's record | A mod reads a weapon's flats and lists every vehicle record, with no other mod installed |
| **T2 Write** | `Variant` conversion in the plugin (to a flat's own type, or a type given). `tweakdb.set`, `clone`, `create`, `update`, `batch` through TweakXL's `TweakDBManager`. Undo per package. `kernel.requirements()` tells the mod when TweakXL is missing. The sample changes a weapon's magazine size and puts it back | A changed value shows in game; switching the mod off restores it; hot reload does not stack edits |
| **T3 Offline and tools** | When REDbridge ships its `tweakdb` methods: the same reads through `kernel.bridge()` without the game, for REDcode and REDagent. Game API reference pages for record types with notes in `gameapi/notes/` | REDagent answers "what fields does a vehicle record have" without the game running |

## Research before T1 and T2

| Question | How to find out |
|---|---|
| Which edits take effect at once, and which need a new object or a save reload. Items already in the inventory, spawned NPCs and vehicles likely keep values they copied | Test in game during T2: change a held weapon's magazine size, then drop and pick it up, then reload a save. Record the results in `gameapi/notes/` |
| Where to get record and flat names for IDs that come back as hashes. Candidates: TweakXL's registered names, WolvenKit's TweakDB names list (through REDbridge), CET's names file | Check each source's license and size; prefer one the player already has |
| Thread safety. The SDK warns that creating flat values while other threads read is unsafe | Reads run on the game thread, as every REDnode game call does. Writes go through TweakXL, which handles its own locking |
| TweakXL calls through `rtti.call`: static natives on `TweakDBManager`, `TweakDBBatch` objects | A spike at the start of T2, before building on it |

## Order

Decided with the user on 2026-10-13: right after W2's in-game test, then overlay phase O7 Display.
