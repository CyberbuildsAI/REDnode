/**
 * Questions to the AI assistant: a package asks, the assistant package (REDagent)
 * answers, through the REDnode host. Works in Node mods and overlay apps.
 *
 * @module
 */

import { transport } from "./transport.js";

/** The answer to {@link agent.ask}. */
export interface AgentAnswer {
  /** The whole answer, as plain text or simple Markdown. */
  text: string;
  /** What the answer cost the player, in US dollars. */
  cost: number;
}

/** Options for {@link agent.ask}. */
export interface AskOptions {
  /** Data the assistant needs, such as the mod's state. Sent as JSON beside the question. */
  context?: unknown;
  /** Called with each piece of the answer as it is written, for showing it while it streams. */
  onText?: (text: string) => void;
  /** Stops the question. The promise then rejects. */
  signal?: AbortSignal;
}

/** A question as the assistant package receives it in {@link agent.serve}. */
export interface AgentRequest {
  /** The package that asks. */
  from: { id: string; name: string };
  prompt: string;
  context?: unknown;
  /** Aborted when the asker cancels. */
  signal: AbortSignal;
  /** Sends a piece of the answer to the asker while it is written. */
  write(text: string): void;
}

/** What an {@link agent.serve} handler returns: the cost, and the text if it was not written piece by piece. */
export interface AgentResult {
  text?: string;
  cost?: number;
}

interface AgentTransport {
  agent?(msg: Record<string, unknown>): void;
}

function send(msg: Record<string, unknown>): void {
  const fromMod = transport() as AgentTransport;
  const fromPage = (globalThis as Record<string, unknown>).rednode as AgentTransport | undefined;
  const t = fromMod.agent ? fromMod : fromPage;
  if (!t?.agent) throw new Error("rednode: agent needs the REDnode host");
  t.agent(msg);
}

interface Pending {
  resolve(answer: AgentAnswer): void;
  reject(err: Error): void;
  onText?: (text: string) => void;
  text: string;
}
let nextAsk = 1;
const asks = new Map<number, Pending>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  transport().listen((m) => {
    if (m.event !== "agent") return;
    const p = asks.get(Number(m.aid));
    if (!p) return;
    if (m.type === "text") {
      const t = String(m.text ?? "");
      p.text += t;
      p.onText?.(t);
      return;
    }
    asks.delete(Number(m.aid));
    if (m.type === "done") p.resolve({ text: typeof m.text === "string" && m.text ? m.text : p.text, cost: Number(m.cost) || 0 });
    else p.reject(new Error(String(m.error ?? "The assistant could not answer.")));
  });
}

/**
 * The AI assistant, for any package. Asking needs `"permissions": ["agent"]` in
 * the package's rednode-app.json and the player's OK in the launcher or the Mod
 * Manager. Every answer costs the player a little, so ask when it helps them,
 * not on a timer. The assistant (REDagent) answers with read-only tools: it can
 * look at logs, the game state and the game API, but never changes anything.
 * It keeps a daily spending limit per package; past it, questions fail.
 *
 * @example
 * ```ts
 * import { agent, ui } from "rednode";
 *
 * const answer = ui.text("");
 * const { text, cost } = await agent.ask("Suggest a build for a netrunner at level 12.", {
 *   context: { level: 12, attributes: { intelligence: 9 } },
 *   onText: (t) => answer.set({ text: answer.props.text + t }),
 * });
 * console.log(`That cost $${cost.toFixed(3)}`);
 * ```
 */
export const agent = {
  /** Asks a question. Resolves with the whole answer; rejects if it is refused, fails or is stopped. */
  ask(prompt: string, options: AskOptions = {}): Promise<AgentAnswer> {
    listen();
    const aid = nextAsk++;
    return new Promise<AgentAnswer>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error("Stopped."));
        return;
      }
      asks.set(aid, { resolve, reject, onText: options.onText, text: "" });
      options.signal?.addEventListener("abort", () => {
        if (!asks.has(aid)) return;
        asks.delete(aid);
        send({ op: "cancel", aid });
        reject(new Error("Stopped."));
      });
      try {
        send({ op: "ask", aid, prompt, context: options.context });
      } catch (err) {
        asks.delete(aid);
        reject(err as Error);
      }
    });
  },

  /**
   * For the assistant package only (its manifest says `"provides": ["agent"]`):
   * answers other packages' questions. The handler writes the answer with
   * `request.write` as it streams, or returns it, and returns the cost.
   * A thrown error goes back to the asker as the reason.
   */
  serve(handler: (request: AgentRequest) => Promise<AgentResult | void>): () => void {
    const running = new Map<number, AbortController>();
    const stop = transport().listen((m) => {
      if (m.event === "agent-cancel") {
        running.get(Number(m.rid))?.abort();
        return;
      }
      if (m.event !== "agent-request") return;
      const rid = Number(m.rid);
      const controller = new AbortController();
      running.set(rid, controller);
      const request: AgentRequest = {
        from: m.from as { id: string; name: string },
        prompt: String(m.prompt ?? ""),
        context: m.context,
        signal: controller.signal,
        write: (text) => send({ op: "reply", rid, type: "text", text }),
      };
      Promise.resolve()
        .then(() => handler(request))
        .then(
          (result) => send({ op: "reply", rid, type: "done", text: result?.text ?? "", cost: result?.cost ?? 0 }),
          (err) => send({ op: "reply", rid, type: "error", error: String((err as Error)?.message ?? err) }),
        )
        .finally(() => running.delete(rid));
    });
    send({ op: "serve" });
    return stop;
  },
};
