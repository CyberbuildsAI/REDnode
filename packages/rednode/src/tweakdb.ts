/**
 * TweakDB: the game's database of tuning data. Items, weapons, vehicles,
 * characters, perks and status effects are **records** (`Items.money`, of a type
 * such as `gamedataItem_Record`), and the single values inside them are **flats**
 * (`Items.money.quality`). This module reads them from the running game.
 *
 * TweakDB ids are hashes: the game keeps no names. A path you pass in is
 * remembered, so ids that come back are shown as paths when their name is known,
 * and as `"0x..."` otherwise. Both forms are accepted everywhere.
 *
 * Reading needs nothing else installed. Changing TweakDB goes through TweakXL:
 * a package that changes it lists `"requires": { "tweakxl": ">=1.10" }`. REDnode
 * undoes a package's changes when the package stops (switched off, restarted, hot
 * reloaded), so a mod sets its values every time it starts.
 *
 * @module
 */

import { invoke, type GameRef } from "./api.js";
import type { RecordTypes, gamedataTweakDBRecord } from "./generated/game.js";
import { cleanError, transport } from "./transport.js";

/** A TweakDB id: a path such as `"Items.money"` when its name is known, else `"0x..."`. */
export type TweakId = string;

/** A flat and its type, as TweakDB stores it. */
export interface Flat<T = unknown> {
  /** The flat's type, such as `"Float"`, `"TweakDBID"`, `"array:CName"`. */
  type: string;
  /** The value. TweakDB ids are {@link TweakId}s; 64-bit numbers are strings. */
  value: T;
}

/** A record type's name: native (`gamedataVehicle_Record`) or short (`Vehicle`). */
export type RecordTypeName = keyof RecordTypes;

// ---------- ids and names ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The part of an id that names it: the CRC32 of the path and its length, 40 bits.
// The game puts the flat's place in its buffer in the bits above, so they are ignored.
const NAME_BITS = (1n << 40n) - 1n;
const names = new Map<bigint, string>();

function nameKey(id: string): bigint | null {
  if (!/^0x[0-9a-f]{1,16}$/i.test(id)) return null;
  return BigInt(id) & NAME_BITS;
}

function learn(path: string): void {
  if (!path || path.startsWith("0x")) return;
  const bytes = new TextEncoder().encode(path);
  if (bytes.length > 255) return;
  names.set((BigInt(bytes.length) << 32n) | BigInt(crc32(bytes)), path);
}

function named(id: unknown): unknown {
  if (typeof id !== "string") return id;
  const key = nameKey(id);
  return key === null ? id : names.get(key) ?? id;
}

// ---------- calls ----------

async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    return await transport().call(method, params);
  } catch (err) {
    throw cleanError(err);
  }
}

function withPaths(path: string): void {
  learn(path);
  // A flat's path names its record too: "Items.money.quality" -> "Items.money".
  const dot = path.lastIndexOf(".");
  if (dot > 0 && !path.startsWith("0x")) learn(path.slice(0, dot));
}

/**
 * Reading TweakDB from the running game.
 *
 * @example
 * ```ts
 * import { tweakdb } from "rednode";
 *
 * const name = await tweakdb.get("Items.Preset_Lexington_Default.friendlyName"); // "w_handgun_militech_lexington"
 * const weapon = await tweakdb.record("Items.Preset_Lexington_Default", "WeaponItem");
 * const vehicles = await tweakdb.records("Vehicle"); // every vehicle record's id
 * ```
 */
export const tweakdb = {
  /**
   * A flat's value, or `null` when TweakDB has no such flat. TweakDB ids in the
   * value come back as paths when their names are known.
   *
   * @param path - The flat's path, such as `"Items.money.quality"`, or its id as `"0x..."`.
   *
   * @example
   * ```ts
   * const capacity = await tweakdb.get<number>("Items.Preset_Lexington_Default.magazineCapacity");
   * ```
   */
  async get<T = unknown>(path: TweakId): Promise<T | null> {
    return ((await tweakdb.flat<T>(path))?.value ?? null) as T | null;
  },

  /**
   * A flat with its type, or `null` when there is none.
   *
   * @example
   * ```ts
   * await tweakdb.flat("Items.money.quality"); // { type: "TweakDBID", value: "0x..." }
 * tweakdb.learn(["Quality.Common"]);
 * await tweakdb.flat("Items.money.quality"); // { type: "TweakDBID", value: "Quality.Common" }
   * ```
   */
  async flat<T = unknown>(path: TweakId): Promise<Flat<T> | null> {
    withPaths(path);
    const r = (await call("tweakdb.get", { path })) as Flat | null;
    if (!r) return null;
    const value = r.type === "TweakDBID" ? named(r.value) : r.type === "array:TweakDBID" && Array.isArray(r.value) ? r.value.map(named) : r.value;
    return { type: r.type, value: value as T };
  },

  /**
   * A record, as a game object you can call methods on, or `null` when there is
   * none. Give its type for typed methods; it is not checked.
   *
   * @example
   * ```ts
   * const car = await tweakdb.record("Vehicle.v_standard2_archer_hella_player", "Vehicle");
   * console.log(await car?.DisplayName());
   * ```
   */
  async record<K extends RecordTypeName = "gamedataTweakDBRecord">(
    path: TweakId,
    type?: K,
  ): Promise<RecordTypes[K] | null> {
    void type;
    learn(path);
    // As api's calls do, so the record comes back as a game object.
    const r = await invoke("tweakdb.record", { path });
    return (r ?? null) as RecordTypes[K] | null;
  },

  /**
   * The ids of every record of a type, as paths where their names are known and
   * `"0x..."` otherwise. A list can be long: TweakDB holds thousands of items.
   *
   * @example
   * ```ts
   * const ids = await tweakdb.records("Vehicle");
   * console.log(`${ids.length} vehicles`);
   * ```
   */
  async records(type: RecordTypeName | string): Promise<TweakId[]> {
    const r = (await call("tweakdb.records", { type })) as { type: string; ids: string[] };
    return r.ids.map((id) => named(id) as string);
  },

  /**
   * A record's type, its native name such as `"gamedataVehicle_Record"`, or `null`
   * when there is no such record.
   */
  async type(path: TweakId): Promise<string | null> {
    const r = (await tweakdb.record(path)) as GameRef | null;
    return r ? r.$type : null;
  },

  /**
   * The id of a path, as the game computes it: `"0x..."`. Needs no game.
   *
   * @example
   * ```ts
   * tweakdb.id("Items.money"); // "0x0000000B..."
   * ```
   */
  id(path: string): string {
    if (path.startsWith("0x")) return path;
    learn(path);
    const bytes = new TextEncoder().encode(path);
    const v = (BigInt(bytes.length) << 32n) | BigInt(crc32(bytes));
    return `0x${v.toString(16).toUpperCase().padStart(16, "0")}`;
  },

  /** The path of an id, when REDnode knows its name, or `null`. */
  name(id: TweakId): string | null {
    const n = named(id);
    return typeof n === "string" && !n.startsWith("0x") ? n : null;
  },

  /**
   * Tells REDnode the names of ids, such as a list of the records your mod uses,
   * so they come back as paths.
   */
  learn(paths: string[]): void {
    for (const p of paths) learn(p);
  },

  /**
   * Changes a flat, through TweakXL, and applies it to its record. The flat keeps
   * its own type; a flat that does not exist yet needs `type`, such as `"Int32"`,
   * `"String"` or `"array:CName"`. Resolves with TweakXL's answer: true when it
   * took the value.
   *
   * REDnode undoes the change when your package stops. Changes made at once (with
   * `Promise.all`) run in the same game frame.
   *
   * Objects already in the game, such as an item in V's inventory, may keep the
   * values they copied when they were made. **Unverified** which ones.
   *
   * @example
   * ```ts
   * await tweakdb.set("Items.Preset_Lexington_Default.friendlyName", "REDnode's Lexington");
   * await Promise.all([
   *   tweakdb.set("Items.MyGun.quality", "Quality.Legendary"),
   *   tweakdb.set("Items.MyGun.tags", ["Weapon", "MyMod"], { type: "array:CName" }),
   * ]);
   * ```
   */
  async set(path: TweakId, value: unknown, options: { type?: string } = {}): Promise<boolean> {
    withPaths(path);
    return (await call("tweakdb.set", { path, value, ...(options.type ? { type: options.type } : {}) })) === true;
  },

  /**
   * A new record, as a copy of another one, through TweakXL. Change its flats with
   * {@link tweakdb.set}. Records stay until the game closes: TweakDB cannot remove them.
   *
   * @example
   * ```ts
   * await tweakdb.clone("Items.MyMod_Lexington", "Items.Preset_Lexington_Default");
   * ```
   */
  async clone(path: TweakId, base: TweakId): Promise<boolean> {
    learn(path);
    learn(base);
    return (await call("tweakdb.clone", { path, base })) === true;
  },

  /**
   * A new, empty record of a type, through TweakXL. Most mods clone an existing
   * record instead, which comes with every flat its type needs.
   */
  async create(path: TweakId, type: RecordTypeName | string): Promise<boolean> {
    learn(path);
    return (await call("tweakdb.create", { path, type })) === true;
  },

  /**
   * Applies a record's changed flats to the record object. {@link tweakdb.set} does
   * this itself; call it after changing flats some other way.
   */
  async update(path: TweakId): Promise<boolean> {
    return (await call("tweakdb.update", { path })) === true;
  },
};

export type { gamedataTweakDBRecord };
