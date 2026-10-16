/**
 * Sound: your package's own audio files, played in the game by REDnode's audio
 * engine beside the game's. WAV, OGG, MP3 and FLAC.
 *
 * A sound plays in a category that follows the game's volume sliders: `"sfx"`
 * (effects, the default), `"dialogue"` or `"music"`, all under master volume. It
 * pauses while a game menu is open, and everything mutes while the game is in the
 * background when the player's "mute in background" setting is on. A package's
 * sounds stop when the package stops.
 *
 * Name a sound by a file in your package's folder, or by an id you declare in
 * `rednode-app.json` with its settings:
 *
 * ```json
 * "sounds": {
 *   "alarm": { "file": "sounds/alarm.ogg", "volume": 0.8 },
 *   "theme": { "file": "sounds/theme.ogg", "category": "music", "loop": true }
 * }
 * ```
 *
 * @module
 */

import { cleanError, transport } from "./transport.js";

/** Where a sound's volume comes from: the game slider it follows. */
export type SoundCategory = "sfx" | "dialogue" | "music";

/** Settings for {@link audio.play}. They override the ones in the manifest. */
export interface PlayOptions {
  /** The slider it follows. Default `"sfx"`. */
  category?: SoundCategory;
  /** Volume, 1 as recorded. Default 1. */
  volume?: number;
  /** Repeat from `start` to `end` until stopped. Default false. */
  loop?: boolean;
  /** Wait this many milliseconds before starting. */
  delay?: number;
  /** Start this many seconds into the file. A loop repeats from here. */
  start?: number;
  /** Stop, or loop back, this many seconds into the file. Default: the file's end. */
  end?: number;
  /** Playback speed: 2 plays twice as fast and an octave higher. Default 1. */
  rate?: number;
  /** Pitch shift in semitones, as a speed: 12 is `rate: 2`. Combines with `rate`. */
  semitones?: number;
  /** Stereo position, -1 left to 1 right. Default 0. */
  pan?: number;
  /** Fade in over this many milliseconds. */
  fadeIn?: number;
  /** Read the file as it plays instead of loading it first. Default true for music, false otherwise. */
  stream?: boolean;
  /** Pause while a game menu is open. Default true. */
  pauseInMenu?: boolean;
}

/** Why a sound ended. */
export interface SoundEnd {
  /** `"ended"` at the end of the file, `"stopped"` by `stop()` or because the package stopped, `"error"` when it could not play. */
  why: "ended" | "stopped" | "error";
  /** What went wrong, for `"error"`. */
  error?: string;
}

/** A playing sound. */
export interface Sound {
  /** Its id in the engine. */
  readonly id: number;
  /** Settles when the sound ends, however it ends. */
  readonly ended: Promise<SoundEnd>;
  /** Stops it, fading out over `fadeOut` milliseconds. */
  stop(options?: { fadeOut?: number }): Promise<void>;
  /**
   * Changes it while it plays. `fadeTo` moves the volume there over `ms`
   * milliseconds instead of at once.
   */
  set(options: { volume?: number; rate?: number; pan?: number; fadeTo?: { volume: number; ms: number } }): Promise<void>;
}

/** A sound of your package, as {@link audio.playing} lists it. */
export interface SoundInfo {
  id: number;
  file: string;
  category: SoundCategory;
  state: "loading" | "playing" | "paused" | "stopping" | "done";
  /** Seconds played. */
  position: number;
  /** The file's length in seconds, 0 while loading. */
  length: number;
}

const endings = new Map<number, (end: SoundEnd) => void>();
const early = new Map<number, SoundEnd>(); // ends that arrived before play() returned
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  transport().listen((m) => {
    if (m.event !== "sound-end" || typeof m.sound !== "number") return;
    const end: SoundEnd = { why: (m.why as SoundEnd["why"]) ?? "ended" };
    if (typeof m.error === "string") end.error = m.error;
    const resolve = endings.get(m.sound);
    if (resolve) {
      endings.delete(m.sound);
      resolve(end);
    } else {
      early.set(m.sound, end);
      if (early.size > 256) early.delete(early.keys().next().value as number);
    }
  });
}

async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    return await transport().call(method, params);
  } catch (err) {
    throw cleanError(err);
  }
}

function handle(id: number): Sound {
  const ended = new Promise<SoundEnd>((resolve) => {
    const already = early.get(id);
    if (already) {
      early.delete(id);
      resolve(already);
    } else {
      endings.set(id, resolve);
    }
  });
  return {
    id,
    ended,
    async stop(options) {
      await call("sound.stop", { id, fadeOut: options?.fadeOut ?? 0 });
    },
    async set(options) {
      await call("sound.set", { id, ...options });
    },
  };
}

/**
 * Sound for packages: play your own audio files in the game.
 *
 * @example
 * ```ts
 * import { audio } from "rednode";
 *
 * const alarm = await audio.play("sounds/alarm.ogg", { loop: true, fadeIn: 500 });
 * setTimeout(() => alarm.stop({ fadeOut: 1000 }), 5000);
 * const { why } = await alarm.ended; // "stopped"
 * ```
 */
export const audio = {
  /**
   * Plays a sound: an id from the manifest's `"sounds"`, or a file's path in your
   * package's folder. Resolves once the engine has it, with a {@link Sound}; the file
   * loads in the background and starts as soon as it is ready.
   */
  async play(sound: string, options?: PlayOptions): Promise<Sound> {
    listen();
    const r = (await call("sound.play", { sound, ...options })) as { id: number };
    return handle(r.id);
  },

  /** Stops every sound of your package, fading out over `fadeOut` milliseconds. */
  async stopAll(options?: { fadeOut?: number }): Promise<void> {
    await call("sound.stop", { fadeOut: options?.fadeOut ?? 0 });
  },

  /** Your package's sounds that are loading or playing. */
  async playing(): Promise<SoundInfo[]> {
    const list = (await call("sound.list", {})) as (SoundInfo & { owner?: string })[];
    return list.map(({ owner: _owner, ...info }) => info);
  },
};
