/**
 * Tier 2 API: asynchronous mods running in a normal Node process.
 *
 * Events flow out of the game, queries and commands flow in. Nothing here
 * blocks the game thread. Stubs only: the native bridge does not exist yet.
 *
 * @module
 */

/** Stops a subscription made with {@link Game.on}. */
export type Unsubscribe = () => void;

/**
 * Handles one game event. May be async: the game never waits for it.
 *
 * @typeParam T - The event payload.
 */
export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

/** The player character, V. */
export interface Player {
  /**
   * Reads the player's current health.
   *
   * This is a query: the value is read on the game thread and the promise
   * resolves on a later tick.
   *
   * @returns Current health points.
   *
   * @example
   * ```ts
   * const hp = await game.player.getHealth();
   * ```
   */
  getHealth(): Promise<number>;

  /**
   * Sets the player's health.
   *
   * This is a command: it is queued and applied on the next game tick. It
   * returns before the change happens.
   *
   * @param value - New health points.
   */
  setHealth(value: number): void;
}

/** Entry point for Tier 2 mods. Use the {@link game} instance. */
export interface Game {
  /**
   * Subscribes to a game event.
   *
   * Events are named by the game class and method that raise them, as listed
   * in the game's reflection data.
   *
   * @typeParam T - The event payload.
   * @param name - Event name, for example `"PlayerPuppet.OnDamageReceived"`.
   * @param handler - Called for every occurrence. The game does not wait for it.
   * @returns A function that stops the subscription.
   *
   * @example
   * ```ts
   * const stop = game.on("PlayerPuppet.OnDamageReceived", async (e) => {
   *   await log(e);
   * });
   * ```
   */
  on<T = unknown>(name: string, handler: EventHandler<T>): Unsubscribe;

  /** The player character. */
  readonly player: Player;
}

const notImplemented = (what: string): never => {
  throw new Error(`rednode: ${what} is not implemented yet (design phase)`);
};

/**
 * The running game, as seen from a Tier 2 mod.
 *
 * @example
 * ```ts
 * import { game } from "rednode";
 *
 * game.on("PlayerPuppet.OnGameAttached", () => {
 *   game.player.setHealth(100);
 * });
 * ```
 */
export const game: Game = {
  on() {
    return notImplemented("game.on");
  },
  player: {
    getHealth() {
      return notImplemented("game.player.getHealth");
    },
    setHealth() {
      return notImplemented("game.player.setHealth");
    },
  },
};
