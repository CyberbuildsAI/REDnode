/*
 * @rednode/ui: web components for REDnode overlay apps.
 *
 * Load it with a classic script tag. The overlay host serves it to every app:
 *   <script src="rednode://ui/rednode-ui.js"></script>
 *
 * Then write UI as markup:
 *   <rn-window title="Weather control" draggable>
 *     <rn-toggle label="Freeze time"></rn-toggle>
 *     <rn-button sound="ui_menu_onpress">Apply</rn-button>
 *   </rn-window>
 *
 * Themes: put theme="rednode" (the default), theme="hud" (HUD red) or
 * theme="edge" (EDGE, solid yellow title bars) on any element; everything inside
 * it follows. The old names "game" and "yellow" still work. Themes are CSS custom properties
 * named --rn-*. The player picks a theme for every window in the launcher; an
 * app's own theme attribute wins inside its element.
 *
 * Every component uses an open shadow root, so app CSS cannot break it, and the
 * overlay host can find drag handles inside it. See packages/ui/README.md.
 */
(() => {
  'use strict';
  if (window.RednodeUI) return;

  // ---------- themes and fonts ----------

  const THEMES = `
:root, [theme="rednode"] {
  --rn-bg: rgba(8, 9, 13, .9);
  --rn-panel: rgba(16, 19, 27, .92);
  --rn-panel-2: rgba(21, 25, 37, .96);
  --rn-line: #262c3d;
  --rn-fg: #e3e6ee;
  --rn-dim: #8a93a8;
  --rn-accent: #fcee0a;
  --rn-accent-2: #19f3ff;
  --rn-on-accent: #08090d;
  --rn-danger: #ff2a52;
  --rn-ok: #5dffa1;
  --rn-display: "Chakra Petch", "Arial Narrow", sans-serif;
  --rn-body: "Rajdhani", "Segoe UI", sans-serif;
  --rn-mono: "JetBrains Mono", "Consolas", monospace;
  --rn-cut: 12px;
  --rn-glow: none;
  --rn-title-case: uppercase;
  /* Window title bars: a tint of the accent, normal text. */
  --rn-title-bg: linear-gradient(90deg, color-mix(in srgb, var(--rn-accent) 14%, transparent), transparent 60%);
  --rn-title-bg-dim: var(--rn-title-bg);
  --rn-title-fg: var(--rn-fg);
  --rn-title-dim: var(--rn-dim);
  --rn-title-ok: var(--rn-ok);
  --rn-title-mark: var(--rn-accent);
  --rn-title-line: var(--rn-line);
  --rn-title-hover-bg: var(--rn-accent);
  --rn-title-hover-fg: var(--rn-on-accent);
  /* Scrollbars: thin, a quiet thumb that lights up on hover. */
  --rn-scroll-thumb: color-mix(in srgb, var(--rn-dim) 40%, transparent);
  --rn-scroll-thumb-hover: var(--rn-accent-2);
}
[theme="hud"], [theme="game"] {
  --rn-bg: rgba(12, 6, 8, .86);
  --rn-panel: rgba(24, 9, 11, .88);
  --rn-panel-2: rgba(48, 14, 17, .92);
  --rn-line: rgba(255, 97, 88, .38);
  --rn-fg: #f2e4e2;
  --rn-dim: #c97670;
  --rn-accent: #ff6158;
  --rn-accent-2: #5ef6ff;
  --rn-on-accent: #160708;
  --rn-danger: #ff2a52;
  --rn-ok: #5ef6ff;
  --rn-display: "Rajdhani", "Arial Narrow", sans-serif;
  --rn-body: "Rajdhani", "Segoe UI", sans-serif;
  --rn-mono: "JetBrains Mono", "Consolas", monospace;
  --rn-cut: 8px;
  --rn-glow: 0 0 12px rgba(255, 97, 88, .45);
  --rn-title-case: uppercase;
  /* Window title bars: a tint of the accent, normal text. */
  --rn-title-bg: linear-gradient(90deg, color-mix(in srgb, var(--rn-accent) 14%, transparent), transparent 60%);
  --rn-title-bg-dim: var(--rn-title-bg);
  --rn-title-fg: var(--rn-fg);
  --rn-title-dim: var(--rn-dim);
  --rn-title-ok: var(--rn-ok);
  --rn-title-mark: var(--rn-accent);
  --rn-title-line: var(--rn-line);
  --rn-title-hover-bg: var(--rn-accent);
  --rn-title-hover-fg: var(--rn-on-accent);
  --rn-scroll-thumb: color-mix(in srgb, var(--rn-accent) 40%, transparent);
  --rn-scroll-thumb-hover: var(--rn-accent);
}
[theme="edge"], [theme="yellow"] {
  --rn-bg: rgba(8, 9, 13, .9);
  --rn-panel: rgba(16, 19, 27, .92);
  --rn-panel-2: rgba(21, 25, 37, .96);
  --rn-line: #262c3d;
  --rn-fg: #e3e6ee;
  --rn-dim: #8a93a8;
  --rn-accent: #fcee0a;
  --rn-accent-2: #19f3ff;
  --rn-on-accent: #08090d;
  --rn-danger: #ff2a52;
  --rn-ok: #5dffa1;
  --rn-display: "Chakra Petch", "Arial Narrow", sans-serif;
  --rn-body: "Rajdhani", "Segoe UI", sans-serif;
  --rn-mono: "JetBrains Mono", "Consolas", monospace;
  --rn-cut: 12px;
  --rn-glow: none;
  --rn-title-case: uppercase;
  /* Window title bars: solid yellow with dark text. */
  --rn-title-bg: #fcee0a;
  --rn-title-bg-dim: #8f8710;
  --rn-title-fg: #08090d;
  --rn-title-dim: rgba(8, 9, 13, .62);
  --rn-title-ok: #08090d;
  --rn-title-mark: #08090d;
  --rn-title-line: rgba(8, 9, 13, .4);
  --rn-title-hover-bg: #08090d;
  --rn-title-hover-fg: #fcee0a;
  --rn-scroll-thumb: color-mix(in srgb, var(--rn-accent) 45%, transparent);
  --rn-scroll-thumb-hover: var(--rn-accent);
}
/* Every scrollbar on the page, not only those inside the kit's components. */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--rn-scroll-thumb); }
::-webkit-scrollbar-thumb:hover { background: var(--rn-scroll-thumb-hover); }
::-webkit-scrollbar-button { display: none; }`;

  function installGlobals() {
    if (document.getElementById('rn-ui-globals')) return;
    const fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href =
      'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
    const style = document.createElement('style');
    style.id = 'rn-ui-globals';
    style.textContent = THEMES;
    document.head.append(fonts, style);
  }
  installGlobals();

  // The player's theme, chosen in the REDnode launcher, applies to the whole page.
  // An app that sets theme="..." on its <html> keeps its own; theme on an inner
  // element, such as <body>, still wins inside that element.
  const appTheme = document.documentElement.getAttribute('theme');
  function applyPlayerTheme(theme) {
    if (!appTheme && typeof theme === 'string' && theme) document.documentElement.setAttribute('theme', theme);
  }
  // Developer mode (the launcher's switch) shows a debug button on every rn-window.
  function applyDeveloper(on) {
    document.documentElement.toggleAttribute('rn-developer', !!on && !!window.rednode?.debug);
  }
  window.rednode?.state?.().then((s) => {
    applyPlayerTheme(s?.theme);
    applyDeveloper(s?.developer);
  }, () => {});
  window.rednode?.on?.((m) => {
    if (m.event === 'theme') applyPlayerTheme(m.theme);
    if (m.event === 'developer') applyDeveloper(m.on);
  });

  // ---------- shared helpers ----------

  const BASE = `
:host { box-sizing: border-box; color: var(--rn-fg); font-family: var(--rn-body); font-size: 16px; }
:host([hidden]) { display: none !important; }
*, *::before, *::after { box-sizing: border-box; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--rn-accent-2); outline-offset: 2px; }
.label { font: 600 12px var(--rn-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--rn-dim); }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--rn-scroll-thumb); }
::-webkit-scrollbar-thumb:hover { background: var(--rn-scroll-thumb-hover); }
::-webkit-scrollbar-button { display: none; }`;

  /** Plays a UI sound through the game, if the app runs in the overlay host. Never throws. */
  function playSound(name) {
    if (!name || !window.rednode?.call) return;
    window.rednode.call('audio.play', { name }).catch(() => {});
  }

  function soundFor(el, kind) {
    return el.getAttribute(kind === 'hover' ? 'hover-sound' : 'sound') || RednodeUI.sounds[kind] || null;
  }

  class Base extends HTMLElement {
    constructor(css, html) {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${BASE}${css}</style>${html}`;
    }
    $(sel) {
      return this.shadowRoot.querySelector(sel);
    }
    emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }
    bool(name) {
      return this.hasAttribute(name) && this.getAttribute(name) !== 'false';
    }
    num(name, fallback) {
      const v = parseFloat(this.getAttribute(name));
      return Number.isFinite(v) ? v : fallback;
    }
  }

  // ---------- rn-window ----------

  class RnWindow extends Base {
    static observedAttributes = ['title', 'draggable', 'closable'];
    constructor() {
      super(
        `
:host { display: flex; flex-direction: column; position: relative; min-width: 160px;
  background: var(--rn-bg); border: 1px solid color-mix(in srgb, var(--rn-accent) 55%, transparent);
  box-shadow: var(--rn-glow);
  clip-path: polygon(0 0, calc(100% - var(--rn-cut)) 0, 100% var(--rn-cut), 100% 100%, var(--rn-cut) 100%, 0 calc(100% - var(--rn-cut))); }
:host(.unfocused) { border-color: color-mix(in srgb, var(--rn-accent) 20%, transparent); }
header { display: flex; align-items: center; gap: 10px; padding: 9px 12px 8px 14px;
  border-bottom: 1px solid var(--rn-line); background: var(--rn-title-bg); color: var(--rn-title-fg);
  /* Status text in the title bar (the status slot) follows the title colors. */
  --rn-dim: var(--rn-title-dim); --rn-ok: var(--rn-title-ok); }
:host(.unfocused) header { background: var(--rn-title-bg-dim); }
/* Only the title area is the drag handle, so controls in the status slot stay clickable. */
.grip { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; align-self: stretch; }
.grip[data-rednode-drag] { cursor: move; }
.mark { width: 8px; height: 8px; background: var(--rn-title-mark); flex: none; }
:host(.unfocused) .mark { background: var(--rn-dim); }
h1 { margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 700 15px var(--rn-display); letter-spacing: .1em; text-transform: var(--rn-title-case); }
.close, .debug { width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 1px solid var(--rn-title-line);
  background: transparent; color: var(--rn-title-dim); font: 14px var(--rn-mono); cursor: pointer; }
.close[hidden] { display: none; }
.close:hover, .debug:hover { color: var(--rn-title-hover-fg); background: var(--rn-title-hover-bg); border-color: var(--rn-title-hover-bg); }
/* The debug button shows only in Developer mode. */
.debug { display: none; }
:host-context(html[rn-developer]) .debug { display: grid; }
:host([no-debug]) .debug { display: none !important; }
.debug svg { width: 14px; height: 14px; }
.body { flex: 1; min-height: 0; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
footer:empty { display: none; }
/* Rolled up: only the title bar shows; the rest of the page is transparent and clicks through. */
:host([rolled]) .body, :host([rolled]) footer { display: none; }
/* Pages often stretch a window to the page (inset: 0); rolled up it takes only its title's height. */
:host([rolled]) { bottom: auto !important; height: auto !important; min-height: 0 !important; }
:host([rolled]) header { border-bottom: 0; }
:host([rolled]) .mark { background: transparent; box-shadow: inset 0 0 0 2px var(--rn-title-mark); }`,
        `<header part="titlebar"><span class="grip"><span class="mark"></span><h1></h1></span><slot name="status"></slot><button class="debug" title="Debug this window" aria-label="Debug"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="5" width="6" height="8" rx="3"/><path d="M6 5V3.5h4V5M5 8H2m12 0h-3M5 11H2.5m11 0H11M5.5 6 3 4m7.5 2L13 4M8 7v6"/></svg></button><button class="close" hidden aria-label="Close">✕</button></header>
<div class="body" part="body"><slot></slot></div><footer><slot name="footer"></slot></footer>`,
      );
      this.$('.close').addEventListener('click', () => {
        playSound(soundFor(this, 'press'));
        const ev = new CustomEvent('close', { cancelable: true, bubbles: true, composed: true });
        if (!this.dispatchEvent(ev)) return; // the app handles it
        // The page's only window: close the app, as the launcher's switch does, so the
        // launcher shows it off and can open it again. Otherwise hide this window.
        if (window.rednode?.close && document.querySelectorAll('rn-window').length === 1) window.rednode.close();
        else this.hidden = true;
      });
      // Opens the debugger for this window: Chromium's DevTools, or the Node debugger for
      // a mod window whose mod runs with the debugger.
      this.$('.debug').addEventListener('click', () => {
        playSound(soundFor(this, 'press'));
        window.rednode?.debug?.().catch?.(() => {});
      });
      // Dim the title when the overlay window loses focus. A double-click on the
      // title bar rolls the window up to its title bar; the REDnode plugin sees
      // presses on drag handles first and reports the double-click.
      window.rednode?.on?.((m) => {
        if (m.event === 'focus') this.classList.toggle('unfocused', !m.focused);
        if (m.event === 'title-dblclick') {
          const r = this.$('header').getBoundingClientRect();
          if (m.x >= r.left && m.x < r.right && m.y >= r.top && m.y < r.bottom) this.toggleRollup();
        }
      });
      // Outside the game (the host's --window mode), a real double-click does the same.
      this.$('header').addEventListener('dblclick', (e) => {
        if (!e.target.closest?.('.close, .debug')) this.toggleRollup();
      });
    }
    connectedCallback() {
      this.restoreRollup();
    }
    // The saved state is kept per page and title; a title set later (mod windows) restores it then.
    restoreRollup() {
      if (this.hasAttribute('no-rollup') || !this.isConnected) return;
      try {
        this.toggleAttribute('rolled', localStorage.getItem(this.rollupKey()) === '1');
      } catch {
        // storage is a convenience
      }
    }
    rollupKey() {
      return `rn-rolled:${location.pathname}:${this.getAttribute('title') || ''}`;
    }
    /** Rolls the window up to its title bar, or back down. Emits "rollup" with { rolled }. */
    toggleRollup() {
      if (this.hasAttribute('no-rollup')) return;
      const rolled = !this.hasAttribute('rolled');
      this.toggleAttribute('rolled', rolled);
      playSound(soundFor(this, 'press'));
      try {
        localStorage.setItem(this.rollupKey(), rolled ? '1' : '0');
      } catch {
        // storage is a convenience
      }
      this.emit('rollup', { rolled });
    }
    attributeChangedCallback(name) {
      if (name === 'title') this.restoreRollup();
      this.$('h1').textContent = this.getAttribute('title') || '';
      const grip = this.$('.grip');
      if (this.bool('draggable')) grip.setAttribute('data-rednode-drag', '');
      else grip.removeAttribute('data-rednode-drag');
      this.$('.close').hidden = !this.bool('closable');
    }
  }

  // ---------- rn-panel ----------

  class RnPanel extends Base {
    static observedAttributes = ['title'];
    constructor() {
      super(
        `
:host { display: block; padding: 12px 14px; background: var(--rn-panel); border: 1px solid var(--rn-line);
  border-left: 3px solid var(--rn-accent-2); }
h2 { margin: 0 0 10px; font: 600 13px var(--rn-display); letter-spacing: .1em; text-transform: var(--rn-title-case); color: var(--rn-fg); }
h2:empty { display: none; }
.content { display: flex; flex-direction: column; gap: 10px; }`,
        `<h2></h2><div class="content"><slot></slot></div>`,
      );
    }
    attributeChangedCallback() {
      this.$('h2').textContent = this.getAttribute('title') || '';
    }
  }

  // ---------- rn-button ----------

  class RnButton extends Base {
    static observedAttributes = ['disabled', 'variant'];
    constructor() {
      super(
        `
:host { display: inline-block; }
button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 34px; padding: 7px 16px; cursor: pointer; white-space: nowrap;
  font: 700 14px var(--rn-display); letter-spacing: .12em; text-transform: uppercase;
  color: var(--rn-on-accent); background: var(--rn-accent); box-shadow: var(--rn-glow);
  clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%); }
button:hover { filter: brightness(1.15); }
button:active { transform: translateY(1px); }
button:focus-visible { outline: 2px solid var(--rn-accent-2); outline-offset: -4px; }
:host([variant="ghost"]) button { color: var(--rn-accent-2); background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rn-accent-2) 60%, transparent); }
:host([variant="ghost"]) button:hover { background: color-mix(in srgb, var(--rn-accent-2) 14%, transparent); filter: none; }
:host([variant="danger"]) button { color: #fff; background: var(--rn-danger); }
:host([disabled]) button { cursor: default; opacity: .4; filter: none; transform: none; }`,
        `<button part="button"><slot></slot></button>`,
      );
      const button = this.$('button');
      button.addEventListener('click', (e) => {
        if (this.bool('disabled')) {
          e.stopPropagation();
          return;
        }
        playSound(soundFor(this, 'press'));
      });
      button.addEventListener('mouseenter', () => {
        if (!this.bool('disabled')) playSound(soundFor(this, 'hover'));
      });
    }
    attributeChangedCallback() {
      this.$('button').disabled = this.bool('disabled');
    }
    focus() {
      this.$('button').focus();
    }
  }

  // ---------- rn-toggle ----------

  class RnToggle extends Base {
    static observedAttributes = ['label', 'checked', 'disabled'];
    constructor() {
      super(
        `
:host { display: flex; }
button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 12px; width: 100%; cursor: pointer; padding: 4px 0; }
.track { position: relative; width: 44px; height: 22px; flex: none; border: 1px solid var(--rn-line); background: var(--rn-panel-2); }
.knob { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; background: var(--rn-dim); transition: left .12s, background .12s; }
:host([checked]) .knob { left: 25px; background: var(--rn-accent); box-shadow: var(--rn-glow); }
:host([checked]) .track { border-color: color-mix(in srgb, var(--rn-accent) 60%, transparent); }
.text { flex: 1; font-size: 16px; }
.state { font: 600 11px var(--rn-mono); letter-spacing: .12em; color: var(--rn-dim); }
:host([checked]) .state { color: var(--rn-accent); }
:host([disabled]) button { cursor: default; opacity: .4; }`,
        `<button role="switch" part="button"><span class="track"><span class="knob"></span></span><span class="text"></span><span class="state">OFF</span></button>`,
      );
      this.$('button').addEventListener('click', () => {
        if (this.bool('disabled')) return;
        this.checked = !this.checked;
        playSound(soundFor(this, 'press'));
        this.emit('change', { checked: this.checked });
      });
    }
    get checked() {
      return this.hasAttribute('checked');
    }
    set checked(v) {
      this.toggleAttribute('checked', !!v);
    }
    attributeChangedCallback() {
      this.$('.text').textContent = this.getAttribute('label') || '';
      this.$('.state').textContent = this.checked ? 'ON' : 'OFF';
      this.$('button').setAttribute('aria-checked', String(this.checked));
    }
  }

  // ---------- rn-slider ----------

  class RnSlider extends Base {
    static observedAttributes = ['label', 'min', 'max', 'step', 'value', 'unit'];
    constructor() {
      super(
        `
:host { display: block; }
.top { display: flex; justify-content: space-between; margin-bottom: 6px; }
.value { font: 600 13px var(--rn-mono); color: var(--rn-accent); }
input { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; margin: 0; background: transparent; cursor: pointer; }
input::-webkit-slider-runnable-track { height: 6px; border: 1px solid var(--rn-line);
  background: linear-gradient(90deg, var(--rn-accent) var(--fill), var(--rn-panel-2) var(--fill)); }
input::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 20px; margin-top: -8px;
  background: var(--rn-fg); box-shadow: var(--rn-glow); clip-path: polygon(0 0, 100% 0, 100% 75%, 50% 100%, 0 75%); }
input:focus-visible { outline: 2px solid var(--rn-accent-2); outline-offset: 2px; }`,
        `<div class="top"><span class="label"></span><span class="value"></span></div><input type="range" part="input">`,
      );
      const input = this.$('input');
      input.addEventListener('input', () => {
        this.setAttribute('value', input.value);
        this.emit('input', { value: this.value });
      });
      input.addEventListener('change', () => {
        playSound(soundFor(this, 'press'));
        this.emit('change', { value: this.value });
      });
    }
    get value() {
      return Number(this.$('input').value);
    }
    set value(v) {
      this.setAttribute('value', v);
    }
    attributeChangedCallback() {
      const input = this.$('input');
      input.min = this.num('min', 0);
      input.max = this.num('max', 100);
      input.step = this.getAttribute('step') || '1';
      if (this.hasAttribute('value') && input.value !== this.getAttribute('value')) input.value = this.getAttribute('value');
      const span = Number(input.max) - Number(input.min) || 1;
      input.style.setProperty('--fill', `${((Number(input.value) - Number(input.min)) / span) * 100}%`);
      this.$('.label').textContent = this.getAttribute('label') || '';
      this.$('.value').textContent = `${input.value}${this.getAttribute('unit') || ''}`;
    }
  }

  // ---------- rn-input ----------

  class RnInput extends Base {
    static observedAttributes = ['label', 'placeholder', 'value', 'type'];
    constructor() {
      super(
        `
:host { display: block; }
.label { display: block; margin-bottom: 6px; }
.label:empty { display: none; }
input { width: 100%; padding: 8px 10px; font: 14px var(--rn-mono); color: var(--rn-fg);
  background: color-mix(in srgb, var(--rn-panel-2) 70%, black); border: 1px solid var(--rn-line); border-left: 3px solid var(--rn-accent); }
input:focus { border-color: var(--rn-accent-2); outline: none; }
input::placeholder { color: var(--rn-dim); }`,
        `<label><span class="label"></span><input part="input" spellcheck="false" autocomplete="off"></label>`,
      );
      const input = this.$('input');
      input.addEventListener('input', () => this.emit('input', { value: input.value }));
      input.addEventListener('change', () => this.emit('change', { value: input.value }));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.emit('submit', { value: input.value });
      });
    }
    get value() {
      return this.$('input').value;
    }
    set value(v) {
      this.$('input').value = v;
    }
    focus() {
      this.$('input').focus();
    }
    attributeChangedCallback(name) {
      const input = this.$('input');
      this.$('.label').textContent = this.getAttribute('label') || '';
      input.placeholder = this.getAttribute('placeholder') || '';
      input.type = this.getAttribute('type') || 'text';
      if (name === 'value') input.value = this.getAttribute('value') || '';
    }
  }

  // ---------- rn-list and rn-menu, with rn-item / rn-menu-item ----------

  // Shared keyboard model: arrows move, Home/End jump, Enter/Space choose.
  function listKeys(host, itemSelector, choose) {
    host.addEventListener('keydown', (e) => {
      const items = [...host.querySelectorAll(itemSelector)].filter((i) => !i.hasAttribute('disabled'));
      if (!items.length) return;
      const at = items.indexOf(document.activeElement);
      let next = null;
      if (e.key === 'ArrowDown') next = items[(at + 1) % items.length];
      else if (e.key === 'ArrowUp') next = items[(at - 1 + items.length) % items.length];
      else if (e.key === 'Home') next = items[0];
      else if (e.key === 'End') next = items[items.length - 1];
      else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
        e.preventDefault();
        choose(items[at]);
        return;
      } else return;
      e.preventDefault();
      next.focus();
    });
  }

  const ITEM_CSS = `
:host { display: flex; align-items: center; gap: 10px; padding: 7px 12px; cursor: pointer;
  border-left: 3px solid transparent; font-size: 16px; }
:host(:hover) { background: color-mix(in srgb, var(--rn-accent-2) 10%, transparent); }
:host(:focus-visible) { outline: none; background: color-mix(in srgb, var(--rn-accent-2) 16%, transparent); }
:host([selected]) { border-left-color: var(--rn-accent); background: color-mix(in srgb, var(--rn-accent) 12%, transparent); color: var(--rn-accent); }
:host([disabled]) { opacity: .4; cursor: default; }
::slotted([slot="end"]) { margin-left: auto; color: var(--rn-dim); font: 12px var(--rn-mono); }`;

  class RnItem extends Base {
    constructor() {
      super(ITEM_CSS, `<slot></slot><slot name="end"></slot>`);
    }
    connectedCallback() {
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
      this.setAttribute('role', 'option');
    }
  }

  class RnList extends Base {
    constructor() {
      super(
        `:host { display: block; border: 1px solid var(--rn-line); background: var(--rn-panel); }
.scroll { max-height: var(--rn-list-height, 220px); overflow: auto; }`,
        `<div class="scroll" role="listbox"><slot></slot></div>`,
      );
      const choose = (item) => {
        if (item.hasAttribute('disabled')) return;
        this.querySelectorAll('rn-item[selected]').forEach((i) => i.removeAttribute('selected'));
        item.setAttribute('selected', '');
        playSound(soundFor(this, 'press'));
        this.emit('select', { value: item.getAttribute('value') ?? item.textContent.trim(), item });
      };
      this.addEventListener('click', (e) => {
        const item = e.target.closest('rn-item');
        if (item && this.contains(item)) choose(item);
      });
      listKeys(this, 'rn-item', choose);
    }
    get value() {
      const s = this.querySelector('rn-item[selected]');
      return s ? (s.getAttribute('value') ?? s.textContent.trim()) : null;
    }
  }

  class RnMenuItem extends Base {
    constructor() {
      super(
        `${ITEM_CSS}
:host { font: 600 15px var(--rn-display); letter-spacing: .1em; text-transform: uppercase; }
:host::before { content: ""; width: 6px; height: 6px; background: var(--rn-line); flex: none; }
:host(:hover)::before, :host(:focus-visible)::before { background: var(--rn-accent); }`,
        `<slot></slot><slot name="end"></slot>`,
      );
    }
    connectedCallback() {
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
      this.setAttribute('role', 'menuitem');
    }
  }

  class RnMenu extends Base {
    static observedAttributes = ['title'];
    constructor() {
      super(
        `
:host { display: block; min-width: 200px; background: var(--rn-bg); border: 1px solid var(--rn-line); border-top: 2px solid var(--rn-accent); box-shadow: var(--rn-glow); }
h3 { margin: 0; padding: 8px 12px; font: 600 11px var(--rn-mono); letter-spacing: .16em; text-transform: uppercase; color: var(--rn-dim); border-bottom: 1px solid var(--rn-line); }
h3:empty { display: none; }`,
        `<h3></h3><div role="menu"><slot></slot></div>`,
      );
      const choose = (item) => {
        if (item.hasAttribute('disabled')) return;
        playSound(soundFor(this, 'press'));
        this.emit('select', { value: item.getAttribute('value') ?? item.textContent.trim(), item });
      };
      this.addEventListener('click', (e) => {
        const item = e.target.closest('rn-menu-item');
        if (item && this.contains(item)) choose(item);
      });
      listKeys(this, 'rn-menu-item', choose);
    }
    attributeChangedCallback() {
      this.$('h3').textContent = this.getAttribute('title') || '';
    }
  }

  // ---------- rn-tabs with rn-tab ----------

  class RnTab extends Base {
    static observedAttributes = ['label'];
    constructor() {
      super(`:host { display: flex; flex-direction: column; gap: 12px; } :host(:not([active])) { display: none; }`, `<slot></slot>`);
    }
    attributeChangedCallback() {
      this.parentElement?.render?.();
    }
  }

  class RnTabs extends Base {
    constructor() {
      super(
        `
:host { display: flex; flex-direction: column; gap: 12px; }
nav { display: flex; gap: 2px; border-bottom: 1px solid var(--rn-line); }
nav button { all: unset; padding: 7px 14px 6px; cursor: pointer; font: 600 13px var(--rn-display); letter-spacing: .12em;
  text-transform: uppercase; color: var(--rn-dim); border-bottom: 2px solid transparent; margin-bottom: -1px; }
nav button:hover { color: var(--rn-fg); }
nav button[aria-selected="true"] { color: var(--rn-accent); border-bottom-color: var(--rn-accent); }
nav button:focus-visible { outline: 2px solid var(--rn-accent-2); outline-offset: -2px; }`,
        `<nav role="tablist"></nav><slot></slot>`,
      );
      this.$('nav').addEventListener('keydown', (e) => {
        const tabs = [...this.querySelectorAll(':scope > rn-tab')];
        const at = tabs.findIndex((t) => t.hasAttribute('active'));
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          this.select((at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length, true);
        }
      });
      this.shadowRoot.querySelector('slot').addEventListener('slotchange', () => this.render());
    }
    connectedCallback() {
      this.render();
    }
    select(index, focus) {
      const tabs = [...this.querySelectorAll(':scope > rn-tab')];
      if (!tabs[index]) return;
      tabs.forEach((t, i) => t.toggleAttribute('active', i === index));
      this.render();
      if (focus) this.$('nav').children[index]?.focus();
      playSound(soundFor(this, 'press'));
      this.emit('change', { index, label: tabs[index].getAttribute('label') });
    }
    render() {
      const tabs = [...this.querySelectorAll(':scope > rn-tab')];
      if (tabs.length && !tabs.some((t) => t.hasAttribute('active'))) tabs[0].setAttribute('active', '');
      const nav = this.$('nav');
      nav.replaceChildren(
        ...tabs.map((t, i) => {
          const b = document.createElement('button');
          b.textContent = t.getAttribute('label') || `Tab ${i + 1}`;
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', String(t.hasAttribute('active')));
          b.tabIndex = t.hasAttribute('active') ? 0 : -1;
          b.addEventListener('click', () => this.select(i));
          return b;
        }),
      );
    }
  }

  // ---------- rn-progress ----------

  class RnProgress extends Base {
    static observedAttributes = ['value', 'max', 'label'];
    constructor() {
      super(
        `
:host { display: block; }
.top { display: flex; justify-content: space-between; margin-bottom: 6px; }
.top:has(.label:empty) { display: none; }
.pct { font: 600 12px var(--rn-mono); color: var(--rn-accent); }
.bar { position: relative; height: 8px; overflow: hidden; border: 1px solid var(--rn-line); background: var(--rn-panel-2); }
.fill { position: absolute; inset: 0 auto 0 0; background: var(--rn-accent); box-shadow: var(--rn-glow); transition: width .2s; }
:host(:not([value])) .fill { width: 30% !important; animation: slide 1.1s linear infinite; }
@keyframes slide { from { left: -30%; } to { left: 100%; } }`,
        `<div class="top"><span class="label"></span><span class="pct"></span></div><div class="bar" role="progressbar"><div class="fill"></div></div>`,
      );
    }
    attributeChangedCallback() {
      const max = this.num('max', 100) || 100;
      const value = Math.min(max, Math.max(0, this.num('value', 0)));
      const pct = this.hasAttribute('value') ? Math.round((value / max) * 100) : null;
      this.$('.fill').style.width = pct === null ? '' : `${pct}%`;
      this.$('.label').textContent = this.getAttribute('label') || '';
      this.$('.pct').textContent = pct === null ? '' : `${pct}%`;
    }
  }

  // ---------- rn-tooltip ----------

  class RnTooltip extends Base {
    static observedAttributes = ['text'];
    constructor() {
      super(
        `
:host { display: inline-block; position: relative; }
.tip { position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%); z-index: 10;
  width: max-content; max-width: 260px; padding: 6px 10px; pointer-events: none; opacity: 0; transition: opacity .12s;
  font: 13px var(--rn-body); color: var(--rn-fg); background: var(--rn-panel-2); border: 1px solid var(--rn-accent-2); }
:host(:hover) .tip, :host(:focus-within) .tip { opacity: 1; }`,
        `<slot></slot><span class="tip" role="tooltip"></span>`,
      );
    }
    attributeChangedCallback() {
      this.$('.tip').textContent = this.getAttribute('text') || '';
    }
  }

  // ---------- rn-notification ----------

  class RnNotification extends Base {
    static observedAttributes = ['type', 'title'];
    constructor() {
      super(
        `
:host { display: flex; gap: 12px; align-items: flex-start; padding: 10px 14px; min-width: 240px; max-width: 380px;
  background: var(--rn-bg); border: 1px solid var(--rn-line); border-left: 4px solid var(--rn-accent-2); box-shadow: var(--rn-glow);
  animation: in .18s ease-out; }
:host([type="success"]) { border-left-color: var(--rn-ok); }
:host([type="warning"]) { border-left-color: var(--rn-accent); }
:host([type="error"]) { border-left-color: var(--rn-danger); }
.title { display: block; font: 700 13px var(--rn-display); letter-spacing: .1em; text-transform: uppercase; }
.title:empty { display: none; }
.msg { font-size: 15px; }
@keyframes in { from { opacity: 0; transform: translateX(16px); } }`,
        `<div><span class="title"></span><div class="msg"><slot></slot></div></div>`,
      );
    }
    attributeChangedCallback() {
      this.$('.title').textContent = this.getAttribute('title') || '';
    }
  }

  function notify(message, options = {}) {
    let stack = document.getElementById('rn-notifications');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'rn-notifications';
      stack.style.cssText =
        'position:fixed;right:12px;bottom:12px;display:flex;flex-direction:column;gap:8px;z-index:2147483000;pointer-events:none';
      document.body.appendChild(stack);
    }
    const n = document.createElement('rn-notification');
    if (options.type) n.setAttribute('type', options.type);
    if (options.title) n.setAttribute('title', options.title);
    if (options.theme) n.setAttribute('theme', options.theme);
    n.textContent = message;
    stack.appendChild(n);
    playSound(options.sound ?? RednodeUI.sounds.notify);
    setTimeout(() => n.remove(), options.timeout ?? 4000);
    return n;
  }

  // ---------- registration ----------

  const RednodeUI = {
    version: '0.1.0',
    /** Default sounds by kind ('press', 'hover', 'notify'). Game sound event names; unverified ones may be silent. */
    sounds: { press: null, hover: null, notify: null },
    playSound,
    notify,
  };
  window.RednodeUI = RednodeUI;

  const elements = {
    'rn-window': RnWindow,
    'rn-panel': RnPanel,
    'rn-button': RnButton,
    'rn-toggle': RnToggle,
    'rn-slider': RnSlider,
    'rn-input': RnInput,
    'rn-list': RnList,
    'rn-item': RnItem,
    'rn-menu': RnMenu,
    'rn-menu-item': RnMenuItem,
    'rn-tabs': RnTabs,
    'rn-tab': RnTab,
    'rn-progress': RnProgress,
    'rn-tooltip': RnTooltip,
    'rn-notification': RnNotification,
  };
  for (const [name, cls] of Object.entries(elements)) {
    if (!customElements.get(name)) customElements.define(name, cls);
  }
})();
