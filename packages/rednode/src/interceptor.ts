/**
 * Tier 1 API: synchronous interceptors that run inside the game's hook.
 *
 * Interceptors are compiled to plain JavaScript and run in a sandbox (QuickJS).
 * They cannot await, perform I/O or require modules, and they have a hard time
 * budget. On overrun or exception the game falls back to default behavior.
 */

export interface InterceptorContext<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Params extends Record<string, number | string | boolean> = Record<string, number>,
> {
  /** Arguments of the hooked call. Writes are validated against the RTTI types. */
  args: Args;
  /** Parameters pushed ahead of time from a Tier 2 mod. */
  readonly params: Readonly<Params>;
  /** Skip the original call and use the given return value. */
  cancel(returnValue?: unknown): void;
}

export interface InterceptorDefinition<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Params extends Record<string, number | string | boolean> = Record<string, number>,
> {
  /** RTTI target, for example "PlayerPuppet.OnDamageReceived". */
  target: string;
  /** Lower runs first when several mods hook the same target. */
  priority?: number;
  run(ctx: InterceptorContext<Args, Params>): void;
}

export function defineInterceptor<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Params extends Record<string, number | string | boolean> = Record<string, number>,
>(definition: InterceptorDefinition<Args, Params>): InterceptorDefinition<Args, Params> {
  return definition;
}

/** Tier 2 handle for pushing parameters to a named Tier 1 interceptor. */
export interface InterceptorControl {
  set(key: string, value: number | string | boolean): void;
}

export function interceptor(_name: string): InterceptorControl {
  throw new Error("rednode: interceptor() is not implemented yet (design phase)");
}
