/**
 * The UI builder: overlay windows from a Node mod, without writing HTML.
 *
 * A mod describes its window as a tree of nodes. The overlay host renders it
 * with the REDnode UI kit, the same components overlay apps use in their
 * markup, and sends clicks and changes back to the mod's handlers.
 *
 * Only Node mods use the builder. Overlay apps write HTML instead.
 *
 * @module
 */

import { transport } from "./transport.js";

/** Where a window sits on the screen. The x and y offsets are measured from this point. */
export type Anchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

/** One piece of a built window: text, a button, a row and so on. */
export interface UiNode<Props extends object = Record<string, unknown>> {
  /** Unique within the mod. */
  readonly id: string;
  /** The node's type, for example `"button"`. */
  readonly type: string;
  /** The node's current properties. */
  readonly props: Readonly<Props>;
  /**
   * Changes some properties. The window updates at once if it is open.
   *
   * @example
   * ```ts
   * const status = ui.text("Waiting");
   * status.set({ text: "Ready" });
   * ```
   */
  set(props: Partial<Props>): void;
}

/** Properties of {@link ui.text} and {@link ui.heading}. */
export interface TextProps {
  text: string;
  /** `"dim"` for secondary text, `"accent"` to stand out, `"danger"` for errors. */
  tone?: "normal" | "dim" | "accent" | "danger";
}
/** Properties of {@link ui.button}. */
export interface ButtonProps {
  label: string;
  /** `"ghost"` for a quieter button, `"danger"` for a destructive one. */
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  /** A game sound event played on press. The UI kit's default is used when not set. */
  sound?: string;
}
/** Properties of {@link ui.toggle}. */
export interface ToggleProps {
  label: string;
  checked?: boolean;
  disabled?: boolean;
}
/** Properties of {@link ui.slider}. */
export interface SliderProps {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  /** Shown after the value, for example `"%"`. */
  unit?: string;
}
/** Properties of {@link ui.input}. */
export interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
}
/** Properties of {@link ui.progress}. */
export interface ProgressProps {
  label?: string;
  value: number;
  max?: number;
}

/** Options of {@link ui.window}. */
export interface WindowOptions {
  /** Names the window within the mod, so its saved position is found again. Defaults to `"main"`. */
  id?: string;
  /** The title bar text. */
  title: string;
  /** Width in page pixels at 1080p. Defaults to 360. */
  width?: number;
  /** Height in page pixels at 1080p. Defaults to 320. Space the content does not use is transparent and clicks through. */
  height?: number;
  /** Defaults to `"center"`. A saved position wins after the player has moved the window. */
  anchor?: Anchor;
  x?: number;
  y?: number;
  /** Shows a close button. Defaults to true. */
  closable?: boolean;
  /** The window's content, top to bottom. */
  children: UiNode[];
  /** Called when the player closes the window. */
  onClose?: () => void;
}

/** A window opened with {@link ui.window}. */
export interface UiWindow {
  /** The window's id within the mod. */
  readonly id: string;
  /** True after {@link UiWindow.close}, or after the player closed it. */
  readonly closed: boolean;
  /** Closes the window. */
  close(): void;
}

type Handler = (value: unknown) => void;

interface Spec {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: Spec[];
}

interface NodeState {
  spec: Spec;
  window: string | null;
}

let nextNode = 1;
const nodes = new Map<string, NodeState>(); // node id -> state
const handlers = new Map<string, Map<string, Handler>>(); // node id -> event type -> handler
const windows = new Map<string, { onClose?: () => void; closed: boolean; nodes: string[] }>();
let listening = false;

function ensureListening(): void {
  if (listening) return;
  listening = true;
  transport().listen((m) => {
    if (m.event !== "ui") return;
    const win = String(m.window);
    if (m.type === "close") {
      const w = windows.get(win);
      if (w && !w.closed) {
        forget(win);
        w.onClose?.();
      }
      return;
    }
    const handler = handlers.get(String(m.node))?.get(String(m.type));
    if (handler) handler(m.value);
  });
}

function forget(win: string): void {
  const w = windows.get(win);
  if (!w) return;
  w.closed = true;
  for (const id of w.nodes) {
    const n = nodes.get(id);
    if (n) n.window = null;
  }
}

function node<P extends object>(type: string, props: P, on?: Record<string, Handler | undefined>, children?: UiNode[]): UiNode<P> {
  const id = `n${nextNode++}`;
  const spec: Spec = { id, type, props: { ...props } as Record<string, unknown> };
  if (children) spec.children = children.map((c) => nodes.get(c.id)!.spec);
  const state: NodeState = { spec, window: null };
  nodes.set(id, state);
  const events = new Map<string, Handler>();
  for (const [k, fn] of Object.entries(on ?? {})) if (fn) events.set(k, fn);
  if (events.size) handlers.set(id, events);
  return {
    id,
    type,
    get props() {
      return spec.props as Readonly<P>;
    },
    set(next: Partial<P>) {
      Object.assign(spec.props, next);
      if (state.window) transport().ui?.update(state.window, id, next as Record<string, unknown>);
    },
  };
}

function collect(spec: Spec, out: string[]): void {
  out.push(spec.id);
  for (const c of spec.children ?? []) collect(c, out);
}

/**
 * Builds overlay windows from a Node mod.
 *
 * @example
 * ```ts
 * import { game, ui } from "rednode";
 *
 * const where = ui.text("Waiting for the game");
 * ui.window({
 *   title: "Where am I",
 *   children: [
 *     where,
 *     ui.button("Update", async () => {
 *       const p = await game.player.position();
 *       where.set({ text: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` });
 *     }),
 *   ],
 * });
 * ```
 */
export const ui = {
  /** A line of text. Update it with `set({ text })`. */
  text(text: string, options: Omit<TextProps, "text"> = {}): UiNode<TextProps> {
    return node("text", { text, ...options });
  },

  /** A small heading. */
  heading(text: string, options: Omit<TextProps, "text"> = {}): UiNode<TextProps> {
    return node("heading", { text, ...options });
  },

  /** A button. `onClick` runs in the mod when the player presses it. */
  button(label: string, onClick?: () => void, options: Omit<ButtonProps, "label"> = {}): UiNode<ButtonProps> {
    return node("button", { label, ...options }, { click: onClick && (() => onClick()) });
  },

  /** An on and off switch. `onChange` gets the new state. */
  toggle(label: string, onChange?: (checked: boolean) => void, options: Omit<ToggleProps, "label"> = {}): UiNode<ToggleProps> {
    let self: UiNode<ToggleProps>;
    self = node("toggle", { label, ...options }, {
      change: (v) => {
        Object.assign(self.props, { checked: !!v });
        onChange?.(!!v);
      },
    });
    return self;
  },

  /** A slider. `onChange` gets the value when the player lets go. */
  slider(label: string, onChange?: (value: number) => void, options: Omit<SliderProps, "label"> = {}): UiNode<SliderProps> {
    let self: UiNode<SliderProps>;
    self = node("slider", { label, ...options }, {
      change: (v) => {
        Object.assign(self.props, { value: Number(v) });
        onChange?.(Number(v));
      },
    });
    return self;
  },

  /** A text field. `onSubmit` runs on Enter; `onChange` when the field loses focus. */
  input(
    options: InputProps & { onChange?: (value: string) => void; onSubmit?: (value: string) => void } = {},
  ): UiNode<InputProps> {
    const { onChange, onSubmit, ...props } = options;
    let self: UiNode<InputProps>;
    self = node("input", props, {
      change: (v) => {
        Object.assign(self.props, { value: String(v) });
        onChange?.(String(v));
      },
      submit: (v) => onSubmit?.(String(v)),
    });
    return self;
  },

  /** A progress bar from 0 to `max` (100 by default). */
  progress(value: number, options: Omit<ProgressProps, "value"> = {}): UiNode<ProgressProps> {
    return node("progress", { value, ...options });
  },

  /** Puts nodes side by side. */
  row(...children: UiNode[]): UiNode<Record<string, never>> {
    return node("row", {}, undefined, children);
  },

  /** Puts nodes under each other. A window's content is already a column. */
  column(...children: UiNode[]): UiNode<Record<string, never>> {
    return node("column", {}, undefined, children);
  },

  /**
   * Opens a window in the game. It looks like any overlay app window: the
   * player can move it in interactive mode (F10), and its position is saved.
   */
  window(options: WindowOptions): UiWindow {
    const t = transport();
    if (!t.ui) throw new Error("rednode: ui.window is for Node mods. Overlay apps write HTML with the UI kit.");
    ensureListening();
    const id = options.id ?? "main";
    const existing = windows.get(id);
    if (existing && !existing.closed) throw new Error(`rednode: a window with id "${id}" is already open`);

    const root: Spec = {
      id: `w:${id}`,
      type: "window",
      props: {
        title: options.title,
        width: options.width ?? 360,
        height: options.height ?? 320,
        anchor: options.anchor ?? "center",
        x: options.x ?? 0,
        y: options.y ?? 0,
        closable: options.closable !== false,
      },
      children: options.children.map((c) => nodes.get(c.id)!.spec),
    };
    const ids: string[] = [];
    for (const c of root.children!) collect(c, ids);
    for (const n of ids) nodes.get(n)!.window = id;
    const state = { onClose: options.onClose, closed: false, nodes: ids };
    windows.set(id, state);
    t.ui.open(id, root);

    return {
      id,
      get closed() {
        return state.closed;
      },
      close() {
        if (state.closed) return;
        forget(id);
        t.ui!.close(id);
      },
    };
  },
};
