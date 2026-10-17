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
  /** The folders where packages are installed, for tools that read other packages' files. */
  readonly appsDirs: readonly string[];
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
  bridge?(op: string, method?: string, params?: unknown): Promise<unknown>;
  requires?(): Promise<unknown>;
  post?(data: unknown): void;
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

/**
 * Messages between a package's overlay pages and its own Node mod: a web UI
 * with a Node backend. What one side posts, the other side's handlers get.
 * Data must be plain JSON-like values.
 *
 * @example
 * ```ts
 * // In the Node mod
 * import { channel } from "rednode";
 * channel.on((msg) => {
 *   if (msg.type === "ping") channel.post({ type: "pong" });
 * });
 *
 * // In the package's page
 * import { channel } from "rednode";
 * channel.on((msg) => console.log(msg.type)); // "pong"
 * channel.post({ type: "ping" });
 * ```
 */
export const channel = {
  /** Sends data to the other side: from a mod to its pages, from a page to its mod. */
  post(data: unknown): void {
    const t = (transport() as SecretTransport).post ? (transport() as SecretTransport) : pageBridge();
    if (!t?.post) throw new Error("rednode: the channel needs the REDnode host");
    t.post(data);
  },
  /** Calls the handler for every message from the other side. Returns a function that stops it. */
  on<T = any>(handler: (data: T) => void): () => void {
    return transport().listen((m) => {
      if (m.event === "channel") handler(m.data as T);
    });
  },
};

/** How to reach the kernel MCP server: an MCP client's HTTP server config. */
export interface KernelMcp {
  /** For example `http://127.0.0.1:41820/mcp`. */
  url: string;
  /** Headers for every request, with this package's token. */
  headers: Record<string, string>;
}

/**
 * One entry of a package's `requires` (in its rednode-app.json), checked against
 * what the game has installed.
 */
export interface Requirement {
  /** The name as installed, such as `Codeware`, or as written when it is missing. */
  name: string;
  /** The version range asked for, such as `>=1.16`. */
  wants: string;
  /** The installed version, or null when it is missing or its files carry no version. */
  found: string | null;
  /** Whether it is installed at all. */
  installed: boolean;
  /** Whether it is installed in a version the range allows. */
  ok: boolean;
  /** What it is: a RED4ext plugin, a redscript module, a Cyber Engine Tweaks mod, or a framework. */
  kind: "red4ext" | "redscript" | "cet" | "framework" | null;
  /** Why it is not ok, such as "not installed", or a note such as "its version is unknown". */
  note: string;
}

/** REDbridge, WolvenKit's engine, as `kernel.bridge()` gives it to a package. */
export interface KernelBridge {
  /** REDbridge's version, such as `0.5.1`, when known. */
  readonly version: string | null;
  /** Where REDnode found it, such as `EDGEdeck (Code)`. */
  readonly source: string | null;
  /**
   * Calls a REDbridge method with its parameters by name, as REDbridge's docs list
   * them: `archive.archives`, `archive.search`, `archive.extract`, `cr2w.toJson` and
   * more. The first call starts REDbridge, which loads the game's archive index in a
   * few seconds.
   */
  call<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
}

function hostTransport(name: keyof SecretTransport): SecretTransport {
  const t = (transport() as SecretTransport)[name] ? (transport() as SecretTransport) : pageBridge();
  if (!t?.[name]) throw new Error("rednode: the kernel needs the REDnode host");
  return t;
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

  /**
   * REDbridge, WolvenKit's engine, shared by every package that may use it: the
   * game's archives (list, search, extract), CR2W files as JSON and back, textures
   * as PNG, hashes. REDnode does not ship REDbridge (GPL-3.0); it uses the copy
   * EDGEdeck or REDcode fetched. The package must ask for the `bridge` permission
   * in its rednode-app.json and the player must allow it in the Mod Manager; this
   * rejects and says why until then, or when REDbridge is not installed.
   *
   * @example
   * ```ts
   * import { kernel } from "rednode";
   *
   * const bridge = await kernel.bridge();
   * const archives = await bridge.call("archive.archives");
   * const found = await bridge.call("archive.search", { query: "player_ma_tpp", limit: 5 });
   * ```
   */
  async bridge(): Promise<KernelBridge> {
    const t = hostTransport("bridge");
    let status: { version: string | null; source: string | null };
    try {
      status = (await t.bridge!("status")) as { version: string | null; source: string | null };
    } catch (err) {
      throw cleanError(err);
    }
    return {
      version: status.version,
      source: status.source,
      async call<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
        try {
          return (await t.bridge!("call", method, params ?? {})) as T;
        } catch (err) {
          throw cleanError(err);
        }
      },
    };
  },

  /**
   * This package's `requires`, checked against what the game has installed: RED4ext
   * plugins (with their DLL versions), redscript modules, Cyber Engine Tweaks mods,
   * and RED4ext, CET and redscript themselves. The Mod Manager shows the same.
   *
   * @example
   * ```ts
   * import { kernel } from "rednode";
   *
   * // rednode-app.json: "requires": { "codeware": ">=1.16" }
   * const missing = (await kernel.requirements()).filter((r) => !r.ok);
   * if (missing.length) console.log(`Needs ${missing.map((r) => `${r.name} ${r.wants}`).join(", ")}`);
   * ```
   */
  async requirements(): Promise<Requirement[]> {
    try {
      return (await hostTransport("requires").requires!()) as Requirement[];
    } catch (err) {
      throw cleanError(err);
    }
  },
};
