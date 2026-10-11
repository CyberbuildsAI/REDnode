/**
 * The REDnode SDK: a Node.js API for scripting Cyberpunk 2077.
 *
 * REDnode has two tiers:
 *
 * - **Tier 2 (async mods)** run in a normal Node process. They observe events,
 *   query game state and send commands through {@link game}. Nothing they do
 *   blocks the game.
 * - **Tier 1 (interceptors)** run inside the game, in a sandbox, while a hooked
 *   function is executing. They can change arguments or cancel the call. Define
 *   them with {@link defineInterceptor}.
 *
 * A Tier 2 mod can steer a Tier 1 interceptor by pushing parameters to it with
 * {@link interceptor}.
 *
 * **Status: design phase.** The API below is a sketch. Every function throws
 * until the native bridge exists.
 *
 * @packageDocumentation
 */

export { game } from "./game.js";
export type { Game, EventHandler, Unsubscribe, Player } from "./game.js";
export { defineInterceptor, interceptor } from "./interceptor.js";
export type {
  InterceptorDefinition,
  InterceptorContext,
  InterceptorControl,
} from "./interceptor.js";
