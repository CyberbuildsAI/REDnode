// The kernel MCP server: REDnode's tools for AI agents, served by the overlay
// host on localhost. Claude Code on the desktop uses it while the game runs, and
// REDagent, the in-game assistant, will use the same tools.
//
//   http://127.0.0.1:41820/mcp   Streamable HTTP, stateless; every request needs
//                                Authorization: Bearer <token> (see the launcher)
//
// Tools: logs, apps, game_state, perf, gameapi_lookup, window_text, window_image,
// window_console, game_image, api_call, api_get, tweakdb. See docs/mcp.md.

'use strict';

const http = require('node:http');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const INSTRUCTIONS = `These tools reach REDnode, a Node.js modding runtime for Cyberpunk 2077, while the game runs.
REDnode runs overlay apps (web pages drawn on top of the game) and Node mods (Node code in the REDnode host, outside the game), both installed as packages in the apps folder and both using the "rednode" package: game (events, state, the player), ui (windows built from Node), and api (any game function, typed from the game's own data).
- logs: what Node mods printed, and their crashes.
- apps: the installed apps and mods, their state and memory; open, close, restart.
- game_state, perf: what the game shows, and what the overlay costs.
- gameapi_lookup: game types and functions with the exact signatures api uses. Look before calling.
- window_text, window_image: what an overlay window shows. window_console: what its page logged.
- game_image: the game's screen as the player sees it, with or without the overlay.
- tweakdb: TweakDB flats and records, read from the running game.
- api_call, api_get: live calls into the game. Game objects come back as {"$ref": n, "$type": "..."}; pass {"$ref": n} back as self. Most functions take the game instance first: pass {}. 64-bit numbers are strings. References die when a save loads.
api_call can change the player's game, such as their money or health: ask before changes the user did not request.
Guide: https://edgemodders.github.io/REDnode/overlay-apps.html`;

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const READ = { readOnlyHint: true, openWorldHint: false };

/**
 * @param {object} host  functions from main.js: log, version, logs, apps, setOpen, restart,
 *                       state, perf, lookup, webContentsOf, consoleOf, captureGame, call
 */
function createMcp(host) {
  let server = null;
  let current = { enabled: false, port: 0, token: '' };

  function build() {
    const mcp = new McpServer({ name: 'rednode', version: host.version }, { instructions: INSTRUCTIONS });

    mcp.registerTool(
      'logs',
      {
        title: 'Mod log',
        description: 'What REDnode Node mods printed, newest last, as the Mod log app shows it. Crashes keep only the stack lines in the mod\'s own code.',
        inputSchema: {
          mod: z.string().optional().describe('Only this mod id'),
          errorsOnly: z.boolean().optional().describe('Only errors and crashes'),
          limit: z.number().int().min(1).max(500).optional().describe('How many lines, newest last. Default 100'),
        },
        annotations: READ,
      },
      async ({ mod, errorsOnly, limit }) => {
        const lines = host
          .logs()
          .filter((e) => (!mod || e.id === mod) && (!errorsOnly || e.level === 'error'))
          .slice(-(limit ?? 100))
          .map((e) => `${e.time} [${e.id}]${e.level === 'error' ? ' ERROR' : ''} ${e.text}`);
        return text(lines.length ? lines.join('\n') : 'No lines.');
      },
    );

    mcp.registerTool(
      'apps',
      {
        title: 'Apps and mods',
        description:
          'Lists the installed overlay apps and Node mods: open or running, a mod\'s state (running, crashed, not-responding), process and memory, and its last error. ' +
          'With an action, opens, closes or restarts one, or pins it to the launcher or the HUD, as the launcher and Mod Manager do. Window ids for window_text and window_image are listed too.',
        inputSchema: {
          action: z
            .enum(['list', 'open', 'close', 'restart', 'pin-launcher', 'unpin-launcher', 'pin-hud', 'unpin-hud'])
            .optional()
            .describe('Default list. pin-launcher lists a package in the launcher; pin-hud keeps its windows on screen during gameplay'),
          id: z.string().optional().describe('The app or mod id, for every action but list'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ action = 'list', id }) => {
        if (action !== 'list') {
          if (!id) return fail(`${action} needs an id`);
          try {
            if (action === 'restart') host.restart(id);
            else if (action.endsWith('-launcher') || action.endsWith('-hud')) {
              host.setPin(id, action.endsWith('-hud') ? 'hud' : 'launcher', action.startsWith('pin'));
            } else host.setOpen(id, action === 'open');
          } catch (err) {
            return fail(err.message);
          }
        }
        return text(host.apps());
      },
    );

    mcp.registerTool(
      'game_state',
      {
        title: 'Game state',
        description: 'Whether REDnode is linked to the game, what the game shows (a menu, photo mode, a scene, the main menu) and the overlay mode (passive, interactive, hidden).',
        annotations: READ,
      },
      async () => text(host.state()),
    );

    mcp.registerTool(
      'perf',
      {
        title: 'Performance',
        description: 'The game\'s frame rate and what the overlay costs per game frame, the host\'s memory and CPU, and each mod process\'s memory. Updated every second while the game runs.',
        annotations: READ,
      },
      async () => text(host.perf()),
    );

    mcp.registerTool(
      'gameapi_lookup',
      {
        title: 'Game API lookup',
        description:
          'Looks up Cyberpunk 2077 game types and functions, with the TypeScript signatures that `api` in the rednode package uses, and REDnode\'s notes. ' +
          'Give an exact type name (native, such as gameStatsSystem, or script, such as StatsSystem) for its full declaration, or part of a name to search.',
        inputSchema: {
          query: z.string().describe('A type or function name, or part of one'),
          member: z.string().optional().describe('With an exact type: only members whose name contains this'),
        },
        annotations: READ,
      },
      async ({ query, member }) => {
        try {
          return text(host.lookup(query, member));
        } catch (err) {
          return fail(`The game API types are not available: ${err.message}`);
        }
      },
    );

    mcp.registerTool(
      'window_text',
      {
        title: 'Window text',
        description: 'The text an overlay window shows, including inside UI kit components and the values of input fields. Use apps to find window ids.',
        inputSchema: { id: z.string().describe('The app id, or a mod window id such as "hello-mod~main"') },
        annotations: READ,
      },
      async ({ id }) => {
        const wc = host.webContentsOf(id);
        if (!wc) return fail(`No open window "${id}". Use apps to list them.`);
        try {
          return text(await wc.executeJavaScript(WINDOW_TEXT, true));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'window_image',
      {
        title: 'Window image',
        description: 'A picture of an overlay window: its own pixels, as drawn before REDnode places it on the game. It does not show the game behind it, its place on screen, or the cursor.',
        inputSchema: { id: z.string().describe('The app id, or a mod window id such as "hello-mod~main"') },
        annotations: READ,
      },
      async ({ id }) => {
        const wc = host.webContentsOf(id);
        if (!wc) return fail(`No open window "${id}". Use apps to list them.`);
        try {
          const image = await wc.capturePage();
          if (image.isEmpty()) return fail('The window gave an empty picture.');
          return { content: [{ type: 'image', data: image.toPNG().toString('base64'), mimeType: 'image/png' }] };
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'window_console',
      {
        title: 'Window console',
        description:
          "What an overlay window's page logged with console.log, console.error and the like, and its uncaught errors: " +
          'the last 200 messages since the window opened, oldest first. (Node mods log to logs instead.)',
        inputSchema: {
          id: z.string().describe('The app id, or a mod window id such as "hello-mod~main"'),
          level: z.enum(['debug', 'info', 'warning', 'error']).optional().describe('Only this level and above'),
          limit: z.number().int().min(1).max(200).optional().describe('The newest this many. Default 50'),
        },
        annotations: READ,
      },
      async ({ id, level, limit }) => {
        const all = host.consoleOf(id);
        if (!all) return fail(`No open window "${id}". Use apps to list them.`);
        const order = ['debug', 'info', 'warning', 'error'];
        const min = level ? order.indexOf(level) : 0;
        const picked = all.filter((m) => order.indexOf(m.level) >= min).slice(-(limit ?? 50));
        if (!picked.length) return text(`No console messages from "${id}"${level ? ` at ${level} or above` : ''}.`);
        return text(
          picked
            .map((m) => {
              const where = m.source ? ` (${String(m.source).split('/').pop()}:${m.line})` : '';
              const d = new Date(m.time); // local time, as in the host log
              const time = `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
              return `${time} ${m.level}: ${m.message}${where}`;
            })
            .join('\n'),
        );
      },
    );

    mcp.registerTool(
      'game_image',
      {
        title: 'Game screen',
        description:
          "A picture of the game's screen now. By default the game alone, as it draws its frame; with overlay true, " +
          "REDnode's overlay windows and the cursor on top, as the player sees it. Scaled to at most maxWidth pixels wide. " +
          'HDR is converted to SDR, so its colors are approximate. Fails while the game is loading or minimized.',
        inputSchema: {
          overlay: z.boolean().optional().describe("Include REDnode's overlay windows and the cursor. Default false"),
          maxWidth: z.number().int().min(320).max(1920).optional().describe('Default 1280'),
        },
        annotations: READ,
      },
      async ({ overlay, maxWidth }) => {
        try {
          const c = await host.captureGame({ overlay, maxWidth: maxWidth ?? 1280 });
          return {
            content: [
              { type: 'image', data: c.image.toJPEG(85).toString('base64'), mimeType: 'image/jpeg' },
              {
                type: 'text',
                text: `${c.width} x ${c.height}, scaled from ${c.sourceWidth} x ${c.sourceHeight}; ${c.overlay ? 'with' : 'without'} the overlay${c.hdr ? '; HDR converted to SDR' : ''}.`,
              },
            ],
          };
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'api_call',
      {
        title: 'Call the game',
        description:
          'Calls a game function, as `api` in the rednode package does: a global function by name, a static function with class (script or native name), or a method with self. ' +
          'Arguments are checked against the game\'s types first. Game objects come back as {"$ref": n, "$type": "..."}. Functions with out parameters return {result, out}. ' +
          'This can change the player\'s game.',
        inputSchema: {
          fn: z.string().describe('The function name, or its full name for overloads, such as "Cast;EntityID;StatsObjectID"'),
          class: z.string().optional().describe('For a static function: the class, such as "GameInstance"'),
          self: z.number().int().optional().describe('For a method: the object reference number ($ref)'),
          args: z.array(z.unknown()).optional().describe('The arguments. The game instance is {}; 64-bit numbers are strings; enums are member names'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async ({ fn, class: cls, self, args }) => {
        const params = { fn, args: args ?? [] };
        if (cls) params.class = cls;
        if (self !== undefined) params.self = { $ref: self };
        try {
          return text(await host.call('rtti.call', params));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'api_get',
      {
        title: 'Read a property',
        description: 'Reads a property of a game object by its reference number.',
        inputSchema: {
          self: z.number().int().describe('The object reference number ($ref)'),
          prop: z.string().describe('The property name'),
        },
        annotations: READ,
      },
      async ({ self, prop }) => {
        try {
          return text(await host.call('rtti.get', { self: { $ref: self }, prop }));
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    mcp.registerTool(
      'tweakdb',
      {
        title: 'TweakDB',
        description:
          "Reads TweakDB, the game's tuning database, from the running game. op 'get': a flat's type and value " +
          "(path such as 'Items.Preset_Lexington_Default.magazineCapacity'). op 'record': the record as a game " +
          "object reference, to call its methods with api_call (path such as 'Items.money'). op 'records': the ids " +
          "of every record of a type (type such as 'Vehicle' or 'gamedataVehicle_Record'). Ids are hashes shown as " +
          '"0x..."; the game keeps no names. Record types and their methods are in gameapi_lookup.',
        inputSchema: {
          op: z.enum(['get', 'record', 'records']),
          path: z.string().optional().describe("A record or flat path, or an id as '0x...' (get, record)"),
          type: z.string().optional().describe('A record type (records)'),
          limit: z.number().int().min(1).max(5000).optional().describe('records: the most ids to list. Default 500'),
        },
        annotations: READ,
      },
      async ({ op, path, type, limit }) => {
        try {
          if (op === 'records') {
            const r = await host.call('tweakdb.records', { type });
            const max = limit ?? 500;
            return text({ type: r.type, count: r.ids.length, ids: r.ids.slice(0, max), more: Math.max(0, r.ids.length - max) });
          }
          const r = await host.call(op === 'get' ? 'tweakdb.get' : 'tweakdb.record', { path });
          return text(r ?? `TweakDB has no ${op === 'get' ? 'flat' : 'record'} "${path}"`);
        } catch (err) {
          return fail(err.message);
        }
      },
    );

    return mcp;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const ok = (current.external && token === current.token) || current.internal?.has(token);
    if (!token || !ok) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'A valid token is required' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end(); // stateless: no server-sent stream, no sessions
      return;
    }
    const mcp = build();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${current.port}`, `localhost:${current.port}`],
    });
    res.on('close', () => {
      transport.close();
      mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      host.log(`MCP request failed: ${err.message}`);
      if (!res.headersSent) res.writeHead(500).end();
    }
  }

  function stop() {
    if (!server) return;
    server.close();
    server.closeAllConnections?.();
    server = null;
  }

  return {
    /** Starts, stops or moves the server to match aConfig: { enabled, external, port, token, internal }. */
    configure(aConfig) {
      const same = server && current.port === aConfig.port;
      current = { ...aConfig };
      if (!current.enabled) {
        if (server) host.log('MCP server stopped');
        stop();
        return;
      }
      if (same) return;
      stop();
      server = http.createServer((req, res) => {
        handle(req, res);
      });
      server.on('error', (err) => {
        host.log(`MCP server could not start on port ${current.port}: ${err.message}`);
        server = null;
      });
      server.listen(current.port, '127.0.0.1', () => host.log(`MCP server on http://127.0.0.1:${current.port}/mcp`));
    },
    stop,
  };
}

// Collects a page's visible text, including inside shadow roots and slots.
const WINDOW_TEXT = `(() => {
  const out = [];
  const visible = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\\s+/g, ' ').trim();
        if (t) out.push(t);
      } else if (c.nodeType === 1) {
        if (!visible(c) || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
        if ((c.tagName === 'INPUT' || c.tagName === 'TEXTAREA') && c.value) out.push('[' + c.value + ']');
        if (c.tagName === 'SLOT') { for (const a of c.assignedNodes({ flatten: true })) walk({ childNodes: [a] }); continue; }
        if (c.shadowRoot) walk(c.shadowRoot); else walk(c);
      }
    }
  };
  walk(document.body);
  return out.join('\\n');
})()`;

module.exports = { createMcp };
