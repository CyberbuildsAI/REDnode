/**
 * Tier 2 API: asynchronous mods running in a normal Node process.
 *
 * Events flow out of the game, queries and commands flow in. Nothing here
 * blocks the game thread. Stubs only: the native bridge does not exist yet.
 */

export type Unsubscribe = () => void;

export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

export interface Player {
  /** Async query. Resolves with the value read on the game thread. */
  getHealth(): Promise<number>;
  /** Command. Queued and applied on the next game tick. */
  setHealth(value: number): void;
}

export interface Game {
  /** Subscribe to a game event, named by its RTTI class and method. */
  on<T = unknown>(name: string, handler: EventHandler<T>): Unsubscribe;
  readonly player: Player;
}

const notImplemented = (what: string): never => {
  throw new Error(`rednode: ${what} is not implemented yet (design phase)`);
};

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
