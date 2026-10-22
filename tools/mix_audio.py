"""Offline sound mix for a director recording, from the page's audio_log.json.

Mirrors the in-game Web Audio design: rain bed (distance to the cloud), wind (+gusts),
night crickets, and one pentatonic chime per opened flower, with a small room reverb.

usage: python3 tools/mix_audio.py <audio_log.json> <out.wav> [seconds=30]
"""
import json
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000


def envelope(times, values, n):
    t = np.arange(n) / SR
    return np.interp(t, times, values, left=values[0], right=values[-1])


def smooth(x, seconds):
    k = max(1, int(seconds * SR))
    return np.convolve(x, np.ones(k) / k, mode="same")


def main():
    log_path, out_path = sys.argv[1], sys.argv[2]
    dur = float(sys.argv[3]) if len(sys.argv) > 3 else 30.0
    n = int(dur * SR)
    log = json.load(open(log_path))
    s = np.array(log["samples"], dtype=float)
    t, rain_v, night_v, gust_v = s[:, 0], s[:, 1], s[:, 2], s[:, 3]
    rng = np.random.default_rng(7)

    rain_g = smooth(envelope(t, rain_v, n), 0.25)
    night_g = envelope(t, night_v, n)
    gust_g = smooth(envelope(t, gust_v, n), 0.3)

    out = np.zeros((n, 2))

    # rain: bright patter, decorrelated per channel
    band = butter(4, [900, 6500], btype="bandpass", fs=SR, output="sos")
    for c in range(2):
        out[:, c] += sosfilt(band, rng.standard_normal(n)) * rain_g * 0.55

    # wind: brown noise, low-passed, swells with gusts
    low = butter(2, 420, btype="lowpass", fs=SR, output="sos")
    for c in range(2):
        brown = np.cumsum(rng.standard_normal(n))
        brown -= np.convolve(brown, np.ones(SR) / SR, mode="same")  # remove drift
        brown /= np.max(np.abs(brown)) + 1e-9
        out[:, c] += sosfilt(low, brown) * (0.10 + 0.55 * gust_g) * 2.2

    # crickets at night
    tt = np.arange(n) / SR
    for c, (rate, ph) in enumerate([(1.6, 0.0), (1.47, 1.3)]):
        pulse = (np.sin(2 * np.pi * rate * tt + ph) > 0.2).astype(float)
        pulse = smooth(pulse, 0.01)
        chirp = np.sin(2 * np.pi * (4300 + 60 * c) * tt) * (0.5 + 0.5 * np.sin(2 * np.pi * 28 * tt))
        out[:, c] += chirp * pulse * np.clip((night_g - 0.3) / 0.7, 0, 1) * 0.018

    # flower chimes + room
    bus = np.zeros((n, 2))
    for when, midi in log["chimes"]:
        i0 = int(when * SR)
        if i0 >= n:
            continue
        f = 440.0 * 2 ** ((midi - 69) / 12)
        L = min(int(2.4 * SR), n - i0)
        k = np.arange(L) / SR
        env = np.minimum(k / 0.01, 1.0) * np.exp(-k / 0.55)
        tone = (np.sin(2 * np.pi * f * k) + 0.25 * np.sin(2 * np.pi * f * 2.01 * k)) * env * (0.10 + 0.05 * rng.random())
        pan = rng.uniform(-0.35, 0.35)
        bus[i0:i0 + L, 0] += tone * (1 - pan)
        bus[i0:i0 + L, 1] += tone * (1 + pan)
    ir_len = int(2.5 * SR)
    decay = (1 - np.arange(ir_len) / ir_len) ** 3
    verb = np.stack([fftconvolve(bus[:, c], rng.standard_normal(ir_len) * decay)[:n] for c in range(2)], axis=1)
    verb /= np.max(np.abs(verb)) + 1e-9
    out += bus + verb * np.max(np.abs(bus)) * 0.55

    # fades + peak normalise
    fade_in, fade_out = int(0.6 * SR), int(1.8 * SR)
    out[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    out[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
    out *= 0.89 / (np.max(np.abs(out)) + 1e-9)
    wavfile.write(out_path, SR, (out * 32767).astype(np.int16))
    print(f"wrote {out_path}: {dur:.1f}s, {len(log['chimes'])} chimes")


if __name__ == "__main__":
    main()
