/**
 * Placing entities in the world: spawn one with components attached, move it,
 * remove it, and hear its lifecycle. Uses Codeware (1.14 or later) in the game,
 * through REDnode's own script part; without Codeware these calls reject and say so.
 *
 * @module
 */

import { api, type GameRef } from "./api.js";
import { game, type GameEvent } from "./game.js";

/** An entity's ID, as the game API passes it: its 64-bit hash as a string. */
export interface EntityId {
  hash: string;
}

/** A position in the world, in metres. */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** A rotation as a quaternion, the game's own form. */
export interface WorldRotation {
  i: number;
  j: number;
  k: number;
  r: number;
}

/** What {@link world.spawn} places. */
export interface SpawnOptions {
  /** An entity template's depot path (`.ent`), or its hash. One of `template` and `record`. */
  template?: string;
  /** A TweakDB record, such as `"Character.Panam"`. One of `template` and `record`. */
  record?: string;
  /** The appearance to use. */
  appearance?: string;
  position: WorldPoint;
  /** A quaternion; or use `yaw`. Default: facing north. */
  orientation?: WorldRotation;
  /** Turn around the vertical axis, in degrees, when `orientation` is not given. */
  yaw?: number;
  /** Components to attach while the entity assembles, made with `api.$new`. */
  components?: GameRef[];
  /** More tags for the entity, for your own bookkeeping. */
  tags?: string[];
  /** How long to wait for the entity to be in the world. Default 10 seconds. */
  timeoutMs?: number;
}

/** A spawned entity. */
export interface Spawned {
  id: EntityId;
  /** The entity itself, or null if it is gone again. */
  entity: GameRef | null;
}

/** The entity events REDnode passes on. `Entity/Attached` is Codeware's old name for `Entity/AfterAttach`. */
export type EntityEventName = "Entity/Initialize" | "Entity/AfterAttach" | "Entity/Attached" | "Entity/Detach";

const NEEDS_CODEWARE = "needs Codeware 1.14 or later in the game (REDnode's world support compiles only with it)";

// Calls REDnode's script part; a missing class means Codeware is not installed.
async function script(fn: string, ...args: unknown[]): Promise<unknown> {
  try {
    return await api.$static("REDnodeWorld", fn, ...args);
  } catch (err) {
    const message = (err as Error).message;
    if (/no game class "REDnodeWorld"|has no static function/.test(message)) throw new Error(`world.${fn.toLowerCase()} ${NEEDS_CODEWARE}`);
    throw err;
  }
}

const vector = (p: WorldPoint) => ({ X: p.x, Y: p.y, Z: p.z, W: 1 });
function rotation(o?: WorldRotation, yaw?: number): WorldRotation {
  if (o) return o;
  const half = (((yaw ?? 0) * Math.PI) / 180) / 2;
  return { i: 0, j: 0, k: Math.sin(half), r: Math.cos(half) };
}
const idOf = (id: EntityId | string) => (typeof id === "string" ? { hash: id } : { hash: String(id.hash) });

/**
 * Entities in the world, for builders and anything that places things.
 *
 * @example
 * ```ts
 * import { api, world } from "rednode";
 *
 * const mesh = await api.$new("entMeshComponent", {
 *   name: "crate",
 *   mesh: "base\\environment\\props\\crate_a.mesh",
 *   meshAppearance: "default",
 * });
 * const { id } = await world.spawn({
 *   template: "base\\spawner\\empty_entity.ent",
 *   position: { x: -1234, y: 987, z: 12 },
 *   components: [mesh as GameRef],
 * });
 * await world.move(id, { x: -1234, y: 988, z: 12 }, undefined, 90);
 * await world.remove(id);
 * ```
 */
export const world = {
  /** True when REDnode's world support runs: Codeware is installed and a game is loaded. */
  async available(): Promise<boolean> {
    try {
      return (await api.$static("REDnodeWorld", "Ready")) === true;
    } catch {
      return false;
    }
  },

  /**
   * Spawns an entity and resolves once it is in the world (Codeware's
   * `Entity/AfterAttach`). Components are attached while it assembles, before the
   * game gathers its components, the moment Codeware documents for it.
   */
  async spawn(options: SpawnOptions): Promise<Spawned> {
    if (!options.template === !options.record) throw new Error("world.spawn needs either template or record");
    const spec = await api.$new("DynamicEntitySpec", {
      ...(options.template ? { templatePath: options.template } : { recordID: options.record }),
      ...(options.appearance ? { appearanceName: options.appearance } : {}),
      position: vector(options.position),
      orientation: rotation(options.orientation, options.yaw),
      spawnInView: true,
      active: true,
      tags: options.tags ?? [],
    });
    // Listen before spawning: the events can come before the ID does.
    const attached = new Set<string>();
    let wake: (() => void) | null = null;
    const stop = game.on<GameEvent>("Entity/AfterAttach", (e) => {
      if (e.entityId) attached.add(e.entityId);
      wake?.();
    });
    try {
      const id = (await script("Spawn", spec, options.components ?? [])) as EntityId | null;
      if (!id || id.hash === "0") throw new Error(`world.spawn failed: no entity was created (${NEEDS_CODEWARE}, and a loaded game)`);
      const timeout = options.timeoutMs ?? 10000;
      const until = Date.now() + timeout;
      while (!attached.has(id.hash)) {
        const left = until - Date.now();
        if (left <= 0) throw new Error(`world.spawn: the entity was created but not in the world after ${timeout} ms (it may be out of view or still loading)`);
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, Math.min(left, 250));
        });
      }
      return { id, entity: await world.entity(id) };
    } finally {
      stop();
    }
  },

  /** Places an entity. Cheap enough for once a frame, while the player drags it. */
  async move(id: EntityId | string, position: WorldPoint, orientation?: WorldRotation, yaw?: number): Promise<boolean> {
    return (await script("Move", idOf(id), vector(position), rotation(orientation, yaw))) === true;
  },

  /** Removes an entity spawned with {@link world.spawn}. */
  async remove(id: EntityId | string): Promise<boolean> {
    return (await script("Delete", idOf(id))) === true;
  },

  /** Entity events for an entity spawned elsewhere (by its ID), as {@link world.on} delivers them. */
  async watch(id: EntityId | string): Promise<boolean> {
    return (await script("Watch", idOf(id))) === true;
  },

  /** The entity with this ID, or null if it is not in the world. */
  async entity(id: EntityId | string): Promise<GameRef | null> {
    return (await api.$static("GameInstance", "FindEntityByID", game.instance, idOf(id))) as GameRef | null;
  },

  /**
   * Calls the handler for an entity event of REDnode's entities and watched ones.
   * The event has `entityId` and `entityType`. Returns a function that stops it.
   */
  on(name: EntityEventName, handler: (event: GameEvent) => void): () => void {
    return game.on<GameEvent>(name === "Entity/Attached" ? "Entity/AfterAttach" : name, handler);
  },
};
