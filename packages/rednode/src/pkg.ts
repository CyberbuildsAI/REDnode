/**
 * What a package may use besides the game: its own folders, its own secrets,
 * and the kernel's tools for AI agents.
 *
 * @module
 */

import { cleanError, transport } from "./transport.js";

/** This package, as the REDnode host sees it. */
export interface PackageInfo {
  /** The package's id, from its rednode-app.json. */
  readonly id: string;
  /** The package's folder, in the apps folder. Treat it as read-only: hot reload watches it. */
  readonly dir: string;
  /**
   * A folder of the package's own, outside the apps folder, for anything it
   * writes: settings, caches, history. It survives updates of the package.
   */
  readonly dataDir: string;
}

/**
 * This package's folders. Node mods only; an overlay app has no file access.
 *
 * @example
 * ```ts
 * import { pkg } from "rednode";
 * import { writeFileSync } from "node:fs";
 * import { join } from "node:path";
 *
 * writeFileSync(join(pkg.dataDir, "notes.txt"), "remember this");
 * ```
 */
export const pkg: PackageInfo = new Proxy({} as PackageInfo, {
  get(_t, k) {
    const info = (globalThis as Record<PropertyKey, unknown>)[Symbol.for("rednode.package")] as
      | PackageInfo
      | undefined;
    if (!info) throw new Error("rednode: pkg is for Node mods; overlay apps have no file access");
    return info[k as keyof PackageInfo];
  },
});

interface SecretTransport {
  secret?(op: string, name: string, value?: string): Promise<unknown>;
  mcp?(): Promise<unknown>;
}

function pageBridge(): SecretTransport | undefined {
  const r = (globalThis as Record<string, unknown>).rednode as { pkg?: SecretTransport } | undefined;
  return r?.pkg;
}

async function secretCall(op: string, name: string, value?: string): Promise<unknown> {
  const t = (transport() as SecretTransport).secret ? (transport() as SecretTransport) : pageBridge();
  if (!t?.secret) throw new Error("rednode: secrets need the REDnode host");
  try {
    return await t.secret(op, name, value);
  } catch (err) {
    throw cleanError(err);
  }
}

/**
 * Secrets of this package, such as an API key. They are encrypted with the
 * player's Windows account and kept by the REDnode host; a package can read
 * only its own. They never go into the package's folder.
 *
 * @example
 * ```ts
 * import { secrets } from "rednode";
 *
 * await secrets.set("api-key", key);
 * const key = await secrets.get("api-key"); // null when not set
 * ```
 */
export const secrets = {
  /** The secret, or null when it is not set. */
  async get(name: string): Promise<string | null> {
    return (await secretCall("get", name)) as string | null;
  },
  /** Sets the secret. */
  async set(name: string, value: string): Promise<void> {
    await secretCall("set", name, value);
  },
  /** Deletes the secret. */
  async delete(name: string): Promise<void> {
    await secretCall("delete", name);
  },
};

/** How to reach the kernel MCP server: an MCP client's HTTP server config. */
export interface KernelMcp {
  /** For example `http://127.0.0.1:41820/mcp`. */
  url: string;
  /** Headers for every request, with this package's token. */
  headers: Record<string, string>;
}

/** The REDnode kernel's services for this package. */
export const kernel = {
  /**
   * The kernel MCP server, for an AI agent in this package: logs, apps, game
   * state, the game API and overlay windows, as Claude Code gets them. The
   * package must ask for the `mcp` permission in its rednode-app.json, and the
   * player must allow it in the launcher; until then this rejects and says so.
   *
   * @example
   * ```ts
   * import { kernel } from "rednode";
   *
   * const { url, headers } = await kernel.mcp();
   * // mcpServers: { rednode: { type: "http", url, headers } }
   * ```
   */
  async mcp(): Promise<KernelMcp> {
    const t = (transport() as SecretTransport).mcp ? (transport() as SecretTransport) : pageBridge();
    if (!t?.mcp) throw new Error("rednode: the kernel needs the REDnode host");
    try {
      return (await t.mcp()) as KernelMcp;
    } catch (err) {
      throw cleanError(err);
    }
  },
};
