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

## T1: built

REDnode 0.19.0. How to use it: [Overlay apps: TweakDB](overlay-apps.md#tweakdb).

| Piece | Where |
|---|---|
| Plugin | `tweakdb.get` (a flat's type and value, through the SDK's `TweakDB::GetFlatValue`; the flat carries its own type, converted with REDnode's JSON conversion), `tweakdb.record` (the record object as a reference, `TryGetRecord`), `tweakdb.records` (every record id of a type, `TryGetRecordsByType`; the type by its native name, script name or short name). In `reflect.cpp`, on the game thread, beside `rtti.*`. A path is a record or flat path, or an id as `"0x..."` |
| `tweakdb` in the `rednode` package | `get`, `flat`, `record` (typed through a generated `RecordTypes` map of 966 record types, by native and short name), `records`, `type`, `id` (the game's id of a path, computed in JavaScript: CRC32 of the path and its length), `name`, `learn`. Ids come back as paths when their names are known |
| Names | TweakDB ids are hashes, and the game keeps no names. A package's own paths are remembered (and a flat's record path with it); `tweakdb.learn` adds more. Names for everything else: requested from REDbridge, which already loads WolvenKit's names list ([REDbridge #3](https://github.com/Edgemodders/REDbridge/issues/3)) |
| For agents | The kernel MCP server's `tweakdb` tool: `get`, `record` and `records` (capped at 500 ids unless asked) |
| Sample | `apps/tweakdb-test`: reads the Lexington's record (type, flats, a method) and lists every vehicle record |

Tested in the mock game, with a stand-in TweakDB: the sample read the Lexington's type, five flats and `FriendlyName()`, and listed the vehicle records, naming the one whose path it knew. `tweakdb.id` matches CRC32's check value. **Unverified** in the game: the SDK's TweakDB functions on game 2.31, and the timing of a large `records` call.

### T1 test

Use the **Test timer**: Start, then Mark after each step.

1. Close the game. Deploy REDnode. Start the game and load a save. Mark.
2. F10. In the Mod Manager, switch on **TweakDB test** (new). Press **Read**: it shows `gamedataWeaponItem_Record`, the Lexington's quality, item type, display name, friendly name and tags, and `FriendlyName()`. Mark.
3. Type `Vehicle.v_sport2_quadra_type66_player` and press Enter: the type is `gamedataVehicle_Record`. Then type `Items.not_a_thing`: "No record". Mark.
4. Press **Vehicles**: the number of vehicle records and how long it took. Mark.
5. Checks from 0.18.1: close the Hello mod's window with its close button, quit the game, start it and load a save: the window stays closed, and the launcher's **Show** brings it back. In the World test, **Spawn box** shows a cardboard box with its texture. Mark.
6. Quit the game.

### T1 results

**Result, 2026-10-14: passed.** REDnode 0.19.0, game 2.31. The Test timer was not used this time; the times below are from the logs.

| Check | Result |
|---|---|
| Reading a record | The Lexington: its type (`gamedataWeaponItem_Record`), five flats and `FriendlyName()`, 7 values in 226 ms, one game call after another |
| Listing records | `tweakdb.records("Vehicle")`: 1,377 vehicle records in 26 ms, in one call |
| A missing record | `Items.not_a_thing`: "No record" |
| 0.18.1 | The Hello mod's closed window stayed closed after a restart of the game ("Kept hello-mod~main closed"); the World test spawned the textured cardboard box |

| Finding | Change |
|---|---|
| Reading the vehicle failed: `gamedataVehicle_Record has no method "FriendlyName"`. The sample checked `typeof record.FriendlyName === 'function'`, but a game object answers to every name, since the game decides which methods exist, so the check always passed. REDnode's answer was right | The sample (0.1.1) picks the method by the record's type (`FriendlyName` for items, `DisplayName` otherwise) and reads its flats with one `Promise.all`, so they run in the same game frame instead of one frame each |

## T2: built

REDnode 0.20.0. How to use it: [Overlay apps: changing TweakDB](overlay-apps.md#changing-tweakdb).

| Piece | Where |
|---|---|
| Variant | The plugin converts the game's `Variant` to and from JSON as `{ "$type": "Float", "value": 1.5 }`, in every game call, not only TweakDB's |
| Writes | `tweakdb.set`, `tweakdb.clone`, `tweakdb.create`, `tweakdb.update` in the plugin call TweakXL's native `TweakDBManager` functions, the ones that take a TweakDBID (TweakXL's script overloads take a CName). `set` keeps the flat's own type, read from TweakDB, or takes the one given for a new flat, then updates the record. Without TweakXL they fail with "Changing TweakDB needs TweakXL" |
| Undo per package | The host keeps, per package, each flat's value from before the package's first change to it, and puts them back, newest first, when the package stops: a mod at every stop (restarts and hot reloads included, told by the mod runner), an app when its last window closes. A package's next calls wait for its undo to finish. Records cloned or created, and new flats, stay. If two packages change the same flat, the first to stop restores what it found |
| `tweakdb` in the package | `set`, `clone`, `create`, `update`. No separate batch call: changes sent together with `Promise.all` run in one game frame, as W1 measured for game calls |
| Sample | `apps/tweakdb-test` 0.2.0 requires TweakXL; **Change** sets an item's friendly name and reads it back through the record's own `FriendlyName()`; **Clone** copies the record to `Items.REDnode_Test_Clone` with its own name |

Tested in the mock game, with a stand-in TweakDB that keeps writes: Change set the name and the record's method returned it; a restart of the mod (through the MCP `apps` tool) undid it ("Undid 1 TweakDB change(s) of tweakdb-test"), and Read showed the original name again; Clone made the copy with its own name. A first try undid nothing on a restart: the host only noticed stopped packages, and a restarting mod is starting again by then; the mod runner now tells the host at every stop. **Unverified** in the game: TweakXL's calls through REDnode, and which objects already in the game see a change.

### T2 test

Use the **Test timer**: Start, then Mark after each step.

1. Check that TweakXL is installed: `red4ext/plugins/TweakXL/TweakXL.dll`. In the Mod Manager, the TweakDB test then shows no NEEDS. Start the game and load a save. Mark.
2. In the TweakDB test, press **Read**, then **Change**: the friendly name and `FriendlyName()` both read "REDnode was here". Mark.
3. In the Mod Manager, switch the TweakDB test off and on again, then press **Read**: the friendly name is `w_handgun_militech_lexington` again. Mark.
4. Press **Clone**: `Items.REDnode_Test_Clone`, a `gamedataWeaponItem_Record`, with the friendly name "REDnode clone". Mark.
5. Quit the game. I read the logs, including TweakXL's own.

## Research before T1 and T2

| Question | How to find out |
|---|---|
| Which edits take effect at once, and which need a new object or a save reload. Items already in the inventory, spawned NPCs and vehicles likely keep values they copied | Test in game during T2: change a held weapon's magazine size, then drop and pick it up, then reload a save. Record the results in `gameapi/notes/` |
| Where to get record and flat names for IDs that come back as hashes. Candidates: TweakXL's registered names, WolvenKit's TweakDB names list (through REDbridge), CET's names file | Check each source's license and size; prefer one the player already has |
| Thread safety. The SDK warns that creating flat values while other threads read is unsafe | Reads run on the game thread, as every REDnode game call does. Writes go through TweakXL, which handles its own locking |
| TweakXL calls through `rtti.call`: static natives on `TweakDBManager`, `TweakDBBatch` objects | A spike at the start of T2, before building on it |

## Order

Decided with the user on 2026-10-13: right after W2's in-game test, then overlay phase O7 Display.
