/**
 * Tier 2 API: asynchronous mods and overlay apps.
 *
 * Events flow out of the game, queries and commands flow in. Nothing here
 * blocks the game thread: a query is answered on the game thread between
 * frames, and the promise resolves after that.
 *
 * The same calls work in a Node mod and in an overlay app, and give the same
 * answers.
 *
 * @module
 */

import { api } from "./api.js";
import { cleanError, transport, type HostMessage } from "./transport.js";

/** Stops a subscription made with {@link Game.on} or {@link Game.onState}. */
export type Unsubscribe = () => void;

/**
 * Handles one game event. May be async: the game never waits for it.
 *
 * @typeParam T - The event payload.
 */
export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

/** A position in the game world, in meters. */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** A game event, as sent by the REDnode plugin. */
export interface GameEvent {
  /** The event name, for example `"PlayerPuppet.OnGameAttached"`. */
  name: string;
  /** A number sent with the event. */
  value: number;
  /** The plugin's frame counter when the event was sent. */
  frame: number;
}

/** What the game is showing, and whether REDnode is linked to it. */
export interface GameState {
  /** True while the overlay host is linked to the game. All other fields are false when it is not. */
  connected: boolean;
  /** A game menu is open: inventory, map, pause menu and so on. */
  menu: boolean;
  /** Photo mode is on. */
  photoMode: boolean;
  /** A scene that takes control of V, such as a cutscene. The threshold is unverified. */
  scene: boolean;
  /** The main menu, before a save is loaded. */
  mainMenu: boolean;
  /** The overlay's input mode, switched with F10. */
  overlay: "passive" | "interactive" | "hidden";
}

/** The player character, V. */
export interface Player {
  /**
   * Reads V's position in the world.
   *
   * Rejects at the main menu and while a save loads, when there is no player.
   *
   * @example
   * ```ts
   * const { x, y, z } = await game.player.position();
   * console.log(`V is at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
   * ```
   */
  position(): Promise<Vector3>;

  /**
   * Reads V's health, in health points. Built on {@link api}: the stat pools
   * system's `Health` pool.
   *
   * @example
   * ```ts
   * const hp = await game.player.getHealth();
   * ```
   */
  getHealth(): Promise<number>;

  /**
   * Sets V's health, in health points. Applied by the game on its next update.
   *
   * @param value - New health points. The game caps it at V's maximum.
   *
   * @example
   * ```ts
   * await game.player.setHealth(1); // one hit from death
   * ```
   */
  setHealth(value: number): Promise<void>;
}

/** The game's audio. */
export interface Audio {
  /**
   * Plays a game sound event, the way the game plays its UI sounds.
   *
   * Sound event names are listed in the game's audio data. These are tested:
   * `ui_menu_onpress`, `ui_menu_hover`, `ui_loot_take_all`. The Overlay apps guide lists more.
   *
   * @param name - The sound event name.
   *
   * @example
   * ```ts
   * await game.audio.play("ui_menu_onpress");
   * ```
   */
  play(name: string): Promise<void>;
}

/** Entry point for Tier 2 mods and overlay apps. Use the {@link game} instance. */
export interface Game {
  /**
   * Subscribes to a game event.
   *
   * Events are named by the game class and method that raise them. Today the
   * plugin sends `"PlayerPuppet.OnGameAttached"`, at the main menu and on every
   * save load. Events from any hooked game function arrive with phase P2.
   *
   * @typeParam T - The event payload.
   * @param name - Event name, for example `"PlayerPuppet.OnGameAttached"`.
   * @param handler - Called for every occurrence. The game does not wait for it.
   * @returns A function that stops the subscription.
   *
   * @example
   * ```ts
   * const stop = game.on("PlayerPuppet.OnGameAttached", async () => {
   *   console.log("A save was loaded");
   * });
   * ```
   */
  on<T = GameEvent>(name: string, handler: EventHandler<T>): Unsubscribe;

  /**
   * Reads what the game is showing: menus, photo mode, scenes, the main menu.
   *
   * @example
   * ```ts
   * const s = await game.state();
   * if (s.connected && !s.mainMenu) console.log("In a loaded save");
   * ```
   */
  state(): Promise<GameState>;

  /**
   * Calls a handler whenever the game state changes, and once at the start
   * with the current state.
   *
   * @example
   * ```ts
   * game.onState((s) => console.log(s.menu ? "menu open" : "menu closed"));
   * ```
   */
  onState(handler: EventHandler<GameState>): Unsubscribe;

  /**
   * Calls a bridge method by name. The typed calls such as
   * {@link Player.position} are built on it.
   *
   * @typeParam T - The result type.
   * @param method - For example `"player.position"`.
   * @param params - The method's parameters, if any.
   *
   * @example
   * ```ts
   * const info = await game.call<{ frame: number }>("game.info");
   * ```
   */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;

  /** The player character. */
  readonly player: Player;

  /** The game's audio. */
  readonly audio: Audio;

  /**
   * The game instance, for the many game functions whose first argument is a
   * `GameInstance`.
   *
   * @example
   * ```ts
   * const stats = await api.GameInstance.GetStatsSystem(game.instance);
   * ```
   */
  readonly instance: Record<string, never>;
}

const instance: Record<string, never> = Object.freeze({}) as Record<string, never>;

async function player() {
  const p = await api.GetPlayer(instance);
  if (!p) throw new Error("No player. Load a save first.");
  return p;
}

// The player's id for stat systems: Cast<StatsObjectID>(player.GetEntityID()).
async function playerStatsId() {
  const id = await (await player()).GetEntityID();
  return (await api.$call("Cast;EntityID;StatsObjectID", id)) as Record<string, unknown>;
}

async function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  try {
    return (await transport().call(method, params)) as T;
  } catch (err) {
    throw cleanError(err);
  }
}

function toState(raw: Record<string, unknown> | undefined): GameState {
  const s = (raw ?? {}) as Partial<GameState>;
  const connected = !!s.connected;
  return {
    connected,
    menu: connected && !!s.menu,
    photoMode: connected && !!s.photoMode,
    scene: connected && !!s.scene,
    mainMenu: connected && !!s.mainMenu,
    overlay: s.overlay ?? "passive",
  };
}

function listen(fn: (m: HostMessage) => void): Unsubscribe {
  return transport().listen(fn);
}

/**
 * The running game, as seen from a Tier 2 mod or an overlay app.
 *
 * @example
 * ```ts
 * import { game } from "rednode";
 *
 * game.on("PlayerPuppet.OnGameAttached", async () => {
 *   const p = await game.player.position();
 *   console.log("Loaded at", p);
 * });
 * ```
 */
export const game: Game = {
  on<T>(name: string, handler: EventHandler<T>) {
    return listen((m) => {
      if (m.event === "game" && m.name === name) {
        void handler({ name: m.name, value: m.value, frame: m.frame } as T);
      }
    });
  },
  async state() {
    const s = await transport().state();
    return toState(s.game as Record<string, unknown>);
  },
  onState(handler) {
    let stopped = false;
    let last = "";
    const deliver = (s: GameState) => {
      const key = JSON.stringify(s);
      if (stopped || key === last) return;
      last = key;
      void handler(s);
    };
    const stop = listen((m) => {
      if (m.event === "state") deliver(toState(m.state as Record<string, unknown>));
    });
    void game.state().then(deliver);
    return () => {
      stopped = true;
      stop();
    };
  },
  call,
  instance,
  player: {
    async position() {
      const v = await (await player()).GetWorldPosition();
      return { x: v.X, y: v.Y, z: v.Z };
    },
    async getHealth() {
      const pools = await api.GameInstance.GetStatPoolsSystem(instance);
      return pools!.GetStatPoolValue(await playerStatsId(), "Health", false);
    },
    async setHealth(value: number) {
      const pools = await api.GameInstance.GetStatPoolsSystem(instance);
      await pools!.RequestSettingStatPoolValue(await playerStatsId(), "Health", value, null, false);
    },
  },
  audio: {
    async play(name: string) {
      const audio = await api.GameInstance.GetAudioSystem(instance);
      await audio!.Play(name);
    },
  },
};
