/**
 * The generic game API: call any game function, static function or method by
 * name, with typed arguments and results. Types are generated from the game's
 * own type data, the same data as the [game API reference](https://edgemodders.github.io/REDnode/game/).
 *
 * Calls run on the game thread between frames; each one is a round trip, so
 * the promise resolves a frame or two later.
 *
 * @module
 */

import type { GameApi } from "./generated/game.js";
import { cleanError, transport } from "./transport.js";

/**
 * A game object, such as the player, a system or an item. It stands in for the
 * object in the game: call its methods as if it were local, with `await`.
 *
 * A reference points at the object weakly. When the game deletes the object, or
 * a save loads, calls on it fail with "that game object no longer exists".
 *
 * @example
 * ```ts
 * const player = await api.GetPlayer(game.instance);
 * const pos = await player?.GetWorldPosition();
 * ```
 */
export interface GameRef {
  /** The reference's id. */
  readonly $ref: number;
  /** The object's class, its native name, for example `"PlayerPuppet"`. */
  readonly $type: string;
  /**
   * Reads one of the object's properties.
   *
   * @example
   * ```ts
   * const slots = await player.$get("quickSlotsManager");
   * ```
   */
  $get(prop: string): Promise<unknown>;
  /**
   * Writes one of the object's properties, with the same type checks as arguments.
   * A resource reference takes a depot path or its hash.
   *
   * @example
   * ```ts
   * await mesh.$set("meshAppearance", "default");
   * await mesh.$set("visualScale", { X: 2, Y: 2, Z: 2 });
   * ```
   */
  $set(prop: string, value: unknown): Promise<void>;
  /**
   * Calls a method by its full name, for overloads that share a name.
   *
   * @example
   * ```ts
   * await obj.$call("SetHealth;Float", 100);
   * ```
   */
  $call(fn: string, ...args: unknown[]): Promise<unknown>;
}

const REF = Symbol("rednode.ref");

// One proxy per object id in this realm, so the id can be released when the proxy is collected.
const proxies = new Map<number, WeakRef<GameRef>>();
let toRelease: number[] = [];
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function release(id: number): void {
  toRelease.push(id);
  if (releaseTimer) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    const refs = toRelease;
    toRelease = [];
    transport()
      .call("rtti.release", { refs })
      .catch(() => {
        // the game may be gone; its references went with it
      });
  }, 1000);
}

const registry = new FinalizationRegistry<number>((id) => {
  if (!proxies.get(id)?.deref()) proxies.delete(id);
  release(id);
});

function wrap(raw: { $ref: number; $type: string }): GameRef {
  const existing = proxies.get(raw.$ref)?.deref();
  if (existing) {
    release(raw.$ref); // the game counted this hand-out too; one proxy is enough
    return existing;
  }
  const target = { $ref: raw.$ref, $type: raw.$type };
  const self = { $ref: raw.$ref };
  const proxy = new Proxy(target, {
    get(t, k) {
      if (k === "$ref" || k === "$type") return t[k];
      if (k === REF) return t.$ref;
      // Not a promise, not JSON-able as a function, no symbols.
      if (typeof k === "symbol" || k === "then" || k === "toJSON") return undefined;
      if (k === "$get") return (prop: string) => invoke("rtti.get", { self, prop });
      if (k === "$set") return (prop: string, value: unknown) => invoke("rtti.set", { self, prop, value }).then(() => undefined);
      if (k === "$call") return (fn: string, ...args: unknown[]) => invoke("rtti.call", { self, fn, args });
      return (...args: unknown[]) => invoke("rtti.call", { self, fn: k, args });
    },
  }) as unknown as GameRef;
  proxies.set(raw.$ref, new WeakRef(proxy));
  registry.register(proxy, raw.$ref);
  return proxy;
}

// Values to the game: references become {$ref}, bigints become strings.
function toWire(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (!v || typeof v !== "object") return v;
  const id = (v as Record<PropertyKey, unknown>)[REF];
  if (typeof id === "number") return { $ref: id };
  if (Array.isArray(v)) return v.map(toWire);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = toWire(x);
  return out;
}

// Values from the game: {$ref, $type} become references.
function fromWire(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(fromWire);
  const o = v as Record<string, unknown>;
  if (typeof o.$ref === "number" && typeof o.$type === "string") return wrap(o as { $ref: number; $type: string });
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = fromWire(x);
  return out;
}

/** @internal A bridge call whose answer has game objects in it, such as `tweakdb.record`. */
export async function invoke(method: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    return fromWire(await transport().call(method, toWire(params)));
  } catch (err) {
    throw cleanError(err);
  }
}

// api.Name(...) calls a global function; api.Class.Name(...) a static function.
function member(name: string, owner?: string): unknown {
  return new Proxy(function rednodeGameFunction() {}, {
    apply(_t, _this, args: unknown[]) {
      return invoke("rtti.call", owner ? { class: owner, fn: name, args } : { fn: name, args });
    },
    get(_t, k) {
      if (typeof k !== "string" || k === "then" || owner) return undefined;
      return member(k, name);
    },
  });
}

/** Extra calls on {@link api} for names the typed API cannot express. */
export interface ApiExtras {
  /**
   * Calls a global function by name or full name, for example an operator such
   * as `"Cast;EntityID;StatsObjectID"`.
   */
  $call(fn: string, ...args: unknown[]): Promise<unknown>;
  /** Calls a class's static function by name or full name. */
  $static(className: string, fn: string, ...args: unknown[]): Promise<unknown>;
  /**
   * Builds a game object by its class name (native or script name) and sets
   * properties on it first. Resolves with a {@link GameRef} for an object, which
   * keeps the object alive until the reference is released (or a save loads),
   * since nothing in the game holds it yet; or with the value, for a struct.
   *
   * @example
   * ```ts
   * const mesh = await api.$new("entMeshComponent", {
   *   name: "crate",
   *   mesh: "base\environment\props\crate_a.mesh", // a depot path or its hash
   *   meshAppearance: "default",
   *   visualScale: { X: 1, Y: 1, Z: 1 },
   * });
   * ```
   */
  $new(className: string, props?: Record<string, unknown>): Promise<GameRef | Record<string, unknown>>;
  /**
   * Put in place of an argument to get that parameter's value back after the
   * call, in `out`. Some native functions write their answer into a parameter
   * the game does not mark as out; the call then returns `{ result, out }`.
   *
   * @example
   * ```ts
   * const camera = await api.GameInstance.GetCameraSystem(game.instance);
   * const r = (await camera!.GetActiveCameraWorldTransform(api.$out)) as unknown as {
   *   result: boolean;
   *   out: { transform: { position: { X: number; Y: number; Z: number } } };
   * };
   * ```
   */
  readonly $out: never;
}

/**
 * The game API: every global function, and every class's static functions
 * under its script name, typed from the game's type data.
 *
 * Arguments and results:
 *
 * | Game type | In JavaScript |
 * |---|---|
 * | Bool, Int8 to Int32, Uint8 to Uint32, Float, Double | `boolean`, `number` |
 * | Int64, Uint64, CRUID | `string`, because numbers lose precision above 2^53 |
 * | CName, String | `string` |
 * | TweakDBID | `"0x..."`; a record path such as `"Items.money"` also works as an argument |
 * | enums | the member's name, such as `"Health"` |
 * | structs | plain objects; as arguments, missing properties keep their default, and `null` is the default value |
 * | objects (handles) | {@link GameRef} proxies, or `null` |
 * | arrays | arrays |
 * | resource references (`rRef`, `raRef`, `ResRef`) | a depot path such as `"base\...\crate_a.mesh"`, or its hash as a string; read back as the hash |
 *
 * Functions with out parameters return `{ result, out }`, and so does a call with
 * {@link ApiExtras.$out | api.$out} in place of an argument. Objects a call makes
 * that nothing in the game holds yet stay alive while you hold their reference.
 *
 * @example
 * ```ts
 * import { api, game } from "rednode";
 *
 * const player = await api.GetPlayer(game.instance);
 * const id = await player!.GetEntityID();
 * const statsId = await api.$call("Cast;EntityID;StatsObjectID", id);
 * const stats = await api.GameInstance.GetStatsSystem(game.instance);
 * const level = await stats!.GetStatValue(statsId as never, "Level");
 * ```
 */
export const api: GameApi & ApiExtras = new Proxy({} as GameApi & ApiExtras, {
  get(_t, k) {
    if (typeof k !== "string" || k === "then") return undefined;
    if (k === "$out") return { $out: true };
    if (k === "$call") return (fn: string, ...args: unknown[]) => invoke("rtti.call", { fn, args });
    if (k === "$new") {
      return (cls: string, props?: Record<string, unknown>) => invoke("rtti.new", { class: cls, props: props ?? null });
    }
    if (k === "$static") {
      return (cls: string, fn: string, ...args: unknown[]) => invoke("rtti.call", { class: cls, fn, args });
    }
    return member(k);
  },
});
