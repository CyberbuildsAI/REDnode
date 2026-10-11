/**
 * Tier 1 API: synchronous interceptors that run inside the game's hook.
 *
 * Interceptors are compiled to plain JavaScript and run in a sandbox (QuickJS).
 * They cannot await, perform I/O or require modules, and they have a hard time
 * budget. On overrun or exception the game falls back to default behavior.
 *
 * @module
 */

/**
 * What an interceptor sees and can change while the hooked call is running.
 *
 * @typeParam Args - Arguments of the hooked call.
 * @typeParam Params - Values pushed ahead of time by a Tier 2 mod.
 */
export interface InterceptorContext<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Params extends Record<string, number | string | boolean> = Record<string, number>,
> {
  /** Arguments of the hooked call. Writes are validated against the game's types. */
  args: Args;
  /** Parameters pushed ahead of time from a Tier 2 mod with {@link interceptor}. */
  readonly params: Readonly<Params>;
  /**
   * Skips the original call.
   *
   * @param returnValue - What the game receives instead of the original result.
   */
  cancel(returnValue?: unknown): void;
}

/**
 * Describes one interceptor. Pass it to {@link defineInterceptor}.
 *
 * @typeParam Args - Arguments of the hooked call.
 * @typeParam Params - Values pushed ahead of time by a Tier 2 mod.
 */
export interface InterceptorDefinition<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Params extends Record<string, number | string | boolean> = Record<string, number>,
> {
  /** The hooked game function, for example `"PlayerPuppet.OnDamageReceived"`. */
  target: string;
  /** Lower runs first when several mods hook the same target. */
  priority?: number;
  /**
   * Runs synchronously inside the hook. Keep it short: it has a time budget of
   * about 100 µs.
   */
  run(ctx: InterceptorContext<Args, Params>): void;
}

/**
 * Declares a Tier 1 interceptor. Export the result as the module's default.
 *
 * @example
 * ```ts
 * export default defineInterceptor({
 *   target: "PlayerPuppet.OnDamageReceived",
 *   run(ctx) {
 *     ctx.args.damage *= ctx.params.multiplier;
 *   },
 * });
 * ```
 */
export function defineInterceptor<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Params extends Record<string, number | string | boolean> = Record<string, number>,
>(definition: InterceptorDefinition<Args, Params>): InterceptorDefinition<Args, Params> {
  return definition;
}

/** Tier 2 handle for pushing parameters to a Tier 1 interceptor. */
export interface InterceptorControl {
  /**
   * Sets a parameter that the interceptor reads from `ctx.params`. Takes
   * effect on the next hooked call.
   */
  set(key: string, value: number | string | boolean): void;
}

/**
 * Gets a handle to a Tier 1 interceptor from a Tier 2 mod.
 *
 * @param _name - The interceptor's name.
 *
 * @example
 * ```ts
 * interceptor("damage-scale").set("multiplier", 0.5);
 * ```
 */
export function interceptor(_name: string): InterceptorControl {
  throw new Error("rednode: interceptor() is not implemented yet (design phase)");
}
