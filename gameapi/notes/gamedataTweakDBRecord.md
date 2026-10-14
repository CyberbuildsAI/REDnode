# gamedataTweakDBRecord

The base of every TweakDB record type (`gamedataItem_Record`, `gamedataVehicle_Record` and 964 more). A record is one entry of TweakDB, the game's tuning database; its values are flats, such as `Items.Preset_Lexington_Default.quality`.

REDnode reads records and flats with `tweakdb` in the rednode package, straight from the game's database, with nothing else installed: `tweakdb.record(path)` returns the record as a game object, `tweakdb.flat(path)` a flat with its type, `tweakdb.records(type)` every id of a type. See [Reading TweakDB](https://edgemodders.github.io/REDnode/overlay-apps.html#reading-tweakdb).

Measured in game on 2.31 (2026-10-14, [T1 test](https://edgemodders.github.io/REDnode/tweakdb.html#t1-results)): `tweakdb.records("Vehicle")` returned 1,377 vehicle records in one call, in 26 ms. A record's methods are the record type's own: `FriendlyName` is an item's (`gamedataItem_Record`), and a vehicle record answers that it has no such method; `DisplayName` exists on both.

Ids are hashes (CRC32 of the path and its length), and the game keeps no names, so an id comes back as a path only when its name is known.
