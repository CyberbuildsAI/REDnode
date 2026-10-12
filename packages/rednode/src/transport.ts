/**
 * How the SDK reaches the REDnode host. Internal: mods and apps use {@link game}
 * and {@link ui}, which work the same in both places.
 *
 * - In a Node mod, the host's mod runtime puts a transport on
 *   `globalThis[Symbol.for("rednode.transport")]` before the mod loads.
 * - In an overlay app, the host's preload script provides `window.rednode`.
 *
 * @internal
 * @module
 */

/** A message from the host: a game event, a state change or a UI event. */
export interface HostMessage {
  event?: string;
  [key: string]: unknown;
}

/** The host side of the UI builder. Only Node mods have it. */
export interface UiTransport {
  open(window: string, spec: unknown): void;
  update(window: string, node: string, props: Record<string, unknown>): void;
  close(window: string): void;
}

/** What the SDK needs from the host. */
export interface Transport {
  call(method: string, params?: unknown): Promise<unknown>;
  listen(fn: (message: HostMessage) => void): () => void;
  state(): Promise<Record<string, unknown>>;
  ui?: UiTransport;
}

interface PageBridge {
  call(method: string, params?: unknown): Promise<unknown>;
  on(fn: (message: HostMessage) => void): () => void;
  state(): Promise<Record<string, unknown>>;
}

let cached: Transport | null = null;

/**
 * Finds the host. Throws outside REDnode, for example when a mod's file is run
 * with plain `node`.
 */
export function transport(): Transport {
  if (cached) return cached;
  const g = globalThis as Record<PropertyKey, unknown>;
  const fromMod = g[Symbol.for("rednode.transport")] as Transport | undefined;
  if (fromMod) return (cached = fromMod);
  const page = g.rednode as PageBridge | undefined;
  if (page && typeof page.call === "function" && typeof page.on === "function") {
    return (cached = {
      call: (method, params) => page.call(method, params),
      listen: (fn) => page.on(fn),
      state: () => page.state(),
    });
  }
  throw new Error(
    "rednode: no REDnode host. Run this code as a Node mod or an overlay app (see the Overlay apps guide).",
  );
}

/** Strips the wrapper Electron adds to errors that cross from the host to a page. */
export function cleanError(err: unknown): Error {
  const message = String((err as Error)?.message ?? err).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
  return new Error(message);
}
