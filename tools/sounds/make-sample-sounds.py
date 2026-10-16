"""Makes the Sound test sample's audio files (packages/overlay/apps/sound-test/sounds).

Every sound is synthesized here, so the files are REDnode's own (no game audio, no
third-party samples). One file per format the engine plays: OGG, WAV, FLAC and MP3.

    python tools/sounds/make-sample-sounds.py

Needs numpy and soundfile (pip install numpy soundfile).
"""

from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 44100
OUT = Path(__file__).resolve().parents[2] / "packages" / "overlay" / "apps" / "sound-test" / "sounds"


def t(seconds):
    return np.arange(int(seconds * RATE)) / RATE


def envelope(n, attack, release):
    env = np.ones(n)
    a = max(1, int(attack * RATE))
    r = max(1, int(release * RATE))
    env[:a] = np.linspace(0, 1, a)
    env[-r:] *= np.linspace(1, 0, r)
    return env


def note(freq, seconds, attack=0.01, release=0.2, harmonics=((1, 1.0), (2, 0.3), (3, 0.1))):
    x = t(seconds)
    wave = sum(amp * np.sin(2 * np.pi * freq * k * x) for k, amp in harmonics)
    return wave * envelope(len(x), attack, release)


def normalize(signal, peak=0.7):
    return signal * (peak / max(1e-9, np.max(np.abs(signal))))


def music_loop():
    """8 seconds of a slow A minor arpeggio over a pad; starts and ends silent-free so it loops."""
    seconds = 8.0
    out = np.zeros(int(seconds * RATE))
    x = t(seconds)
    # A pad that holds for the whole loop: no fade, so the loop point is seamless.
    for f in (110.0, 164.81, 220.0):
        out += 0.25 * np.sin(2 * np.pi * f * x)
    out *= 0.6 + 0.4 * np.sin(2 * np.pi * x / seconds) ** 2
    steps = [440.0, 523.25, 659.25, 880.0, 659.25, 523.25, 493.88, 587.33]
    step = seconds / 16
    for i in range(16):
        n = note(steps[i % len(steps)], step * 1.5, attack=0.005, release=step)
        start = int(i * step * RATE)
        end = min(len(out), start + len(n))
        out[start:end] += 0.35 * n[: end - start]
    return normalize(out, 0.5)


def beep():
    """A short interface blip, two quick tones."""
    return normalize(np.concatenate([note(1320, 0.06, 0.002, 0.03), note(1760, 0.09, 0.002, 0.06)]), 0.6)


def chime():
    """A bell chord with a long ring."""
    x = t(2.5)
    out = np.zeros(len(x))
    for f, amp in ((523.25, 1.0), (659.25, 0.7), (783.99, 0.6), (1046.5, 0.4)):
        out += amp * np.sin(2 * np.pi * f * x) * np.exp(-x * 2.2)
        out += 0.2 * amp * np.sin(2 * np.pi * f * 2.76 * x) * np.exp(-x * 5)
    return normalize(out * envelope(len(x), 0.003, 0.05), 0.6)


def voice():
    """A synthetic "ah, oh" vowel pair, standing in for a line of dialogue."""
    seconds = 1.6
    x = t(seconds)
    pitch = 140 + 25 * np.sin(2 * np.pi * 1.3 * x)
    phase = 2 * np.pi * np.cumsum(pitch) / RATE
    out = np.zeros(len(x))
    half = len(x) // 2
    formants = [((800, 1150, 2900), 0), ((450, 800, 2830), half)]  # "ah" then "oh"
    for (f1, f2, f3), start in formants:
        seg = slice(start, start + half)
        for k in range(1, 30):
            f = k * pitch[seg]
            gain = sum(np.exp(-((f - fc) / 120) ** 2) for fc in (f1, f2, f3)) + 0.02
            out[seg] += gain * np.sin(k * phase[seg]) / k
    return normalize(out * envelope(len(x), 0.05, 0.25), 0.6)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sf.write(OUT / "music.ogg", music_loop(), RATE, format="OGG", subtype="VORBIS")
    sf.write(OUT / "beep.wav", beep(), RATE, subtype="PCM_16")
    sf.write(OUT / "chime.flac", chime(), RATE, format="FLAC")
    sf.write(OUT / "voice.mp3", voice(), RATE, format="MP3")
    for f in sorted(OUT.iterdir()):
        print(f"{f.name}: {f.stat().st_size} bytes")


if __name__ == "__main__":
    main()
