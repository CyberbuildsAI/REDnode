/**
 * The REDnode SDK: a Node.js API for scripting Cyberpunk 2077.
 *
 * REDnode has two tiers:
 *
 * - **Tier 2 (async mods)** run in Node, in the REDnode host outside the game.
 *   They observe events, query game state and send commands through {@link game},
 *   and build overlay windows with {@link ui}. Nothing they do blocks the game.
 *   Overlay apps use the same {@link game} calls.
 * - **Tier 1 (interceptors)** run inside the game, in a sandbox, while a hooked
 *   function is executing. They can change arguments or cancel the call. Define
 *   them with {@link defineInterceptor}.
 *
 * A Tier 2 mod can steer a Tier 1 interceptor by pushing parameters to it with
 * {@link interceptor}.
 *
 * **Status:** {@link game} and {@link ui} work in the overlay host since
 * overlay phase O6a, and {@link api}, the generic game API, since O6b. Tier 1
 * interceptors are still a design and throw.
 *
 * @packageDocumentation
 */

export { game } from "./game.js";
export type { Game, GameEvent, GameState, EventHandler, Unsubscribe, Player, Audio, Vector3 } from "./game.js";
export { ui } from "./ui.js";
export { api } from "./api.js";
export { pkg, secrets, kernel, channel } from "./pkg.js";
export { agent } from "./agent.js";
export { world } from "./world.js";
export type { EntityId, WorldPoint, WorldRotation, SpawnOptions, Spawned, EntityEventName } from "./world.js";
export type { AgentAnswer, AskOptions, AgentRequest, AgentResult } from "./agent.js";
export type { PackageInfo, KernelMcp, KernelBridge, Requirement } from "./pkg.js";
export { tweakdb } from "./tweakdb.js";
export type { TweakId, Flat, RecordTypeName } from "./tweakdb.js";
export type { GameRef, ApiExtras } from "./api.js";
export type {
  Anchor,
  UiNode,
  UiWindow,
  WindowOptions,
  TextProps,
  ButtonProps,
  ToggleProps,
  SliderProps,
  InputProps,
  ProgressProps,
} from "./ui.js";
export { defineInterceptor, interceptor } from "./interceptor.js";
export type {
  InterceptorDefinition,
  InterceptorContext,
  InterceptorControl,
} from "./interceptor.js";
