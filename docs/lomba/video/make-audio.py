#!/usr/bin/env python3
"""
Adds voice-over and background music to the demo videos.

  python3 make-audio.py <silent.mp4> <cut: full|short> <out.mp4> <tts.py>

- VO lines come from vo.json (edge-tts, one voice). Each line is fitted to
  its slot by raising the rate in steps (max +12%); a line that still does
  not fit is reported and the build stops.
- BGM is synthesised here (numpy): an original, royalty-free soft pad +
  plucked arpeggio + light kick/shaker at 92 BPM, Cmaj7-Am7-Fmaj7-G6.
- ffmpeg places the VO, ducks the music under it (sidechaincompress), then
  loudnorm to -15 LUFS / -2.2 dBTP (about -1.5 after AAC). The video stream is copied.
"""
import json, os, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48000


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def tts_fit(line, voice, tts, work):
    slot = line['end'] - line['start'] - 0.3
    text = line.get('say', line['text'])
    for rate in (0, 4, 8, 12):
        raw = os.path.join(work, f"{line['id']}.mp3")
        out = os.path.join(work, f"{line['id']}.wav")
        run(['python3', tts, text, voice, raw, f'+{rate}%'])
        # edge-tts pads both ends with silence; trim it so lines sit on their cue
        run(['ffmpeg', '-y', '-i', raw, '-af',
             'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.12',
             '-ar', str(SR), out])
        d = duration(out)
        if d <= slot:
            return out, d, rate
    raise SystemExit(f"VO '{line['id']}' is {d:.2f}s at +12% but the slot is {slot:.2f}s; shorten the text.")


# ----------------------------------------------------------------- music

def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def bgm(seconds, seed=7):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    mix = np.zeros(n)
    bpm = 92
    beat = 60 / bpm
    bar = 4 * beat
    # Cmaj7 - Am7 - Fmaj7 - G6 (voicings around middle C)
    chords = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 52, 59]]
    t_bar = np.arange(int(bar * SR)) / SR

    def tri(freq, t):
        return 2 * np.abs(2 * ((t * freq) % 1) - 1) - 1

    bars = int(np.ceil(seconds / bar))
    for b in range(bars):
        start = int(b * bar * SR)
        chord = chords[b % 4]
        # pad: detuned sines + soft triangle, slow attack/release
        env = np.minimum(1, t_bar / 0.9) * np.minimum(1, (bar - t_bar) / 0.6 + 0.15)
        pad = np.zeros_like(t_bar)
        for m in chord:
            f = note(m)
            pad += 0.5 * np.sin(2 * np.pi * f * t_bar) + 0.25 * np.sin(2 * np.pi * f * 1.003 * t_bar) + 0.12 * tri(f / 2, t_bar)
        pad *= env * 0.05
        # bass on the root, half notes
        bass = np.zeros_like(t_bar)
        for k in range(2):
            s0 = int(k * 2 * beat * SR)
            tt = t_bar[: int(2 * beat * SR)]
            bass[s0:s0 + len(tt)] += np.sin(2 * np.pi * note(chord[0] - 12) * tt) * np.exp(-tt * 1.6) * 0.11
        # plucked arpeggio, eighth notes, one octave up
        arp = np.zeros_like(t_bar)
        pattern = [0, 1, 2, 3, 2, 1, 2, 3]
        for k, idx in enumerate(pattern):
            s0 = int(k * beat / 2 * SR)
            ln = int(beat * 1.5 * SR)
            tt = np.arange(ln) / SR
            f = note(chord[idx] + 12)
            tone = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt)) * np.exp(-tt * 5.5)
            seg = arp[s0:s0 + ln]
            seg += tone[: len(seg)] * 0.045
        # soft kick on 1 and 3, shaker on off-beats
        perc = np.zeros_like(t_bar)
        for k in (0, 2):
            s0 = int(k * beat * SR)
            tt = np.arange(int(0.35 * SR)) / SR
            kick = np.sin(2 * np.pi * (50 + 60 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 9) * 0.10
            seg = perc[s0:s0 + len(kick)]
            seg += kick[: len(seg)]
        for k in range(8):
            s0 = int((k + 0.5) * beat / 2 * SR)
            tt = np.arange(int(0.07 * SR)) / SR
            sh = rng.normal(0, 1, len(tt)) * np.exp(-tt * 60) * 0.012
            seg = perc[s0:s0 + len(sh)]
            seg += sh[: len(seg)]
        piece = pad + bass + arp + perc
        end = min(n, start + len(piece))
        mix[start:end] += piece[: end - start]

    # light room reverb: convolve with a decaying noise impulse
    ir_len = int(1.6 * SR)
    ir = rng.normal(0, 1, ir_len) * np.exp(-np.arange(ir_len) / SR * 3.2)
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = np.fft.irfft(np.fft.rfft(mix, n + ir_len) * np.fft.rfft(ir, n + ir_len))[:n]
    out = 0.82 * mix + 0.18 * wet
    # fades
    fi, fo = int(2 * SR), int(3 * SR)
    out[:fi] *= np.linspace(0, 1, fi)
    out[-fo:] *= np.linspace(1, 0, fo)
    out /= max(1e-9, np.max(np.abs(out))) / 0.7
    # tiny stereo width: delay the right channel by 9 ms
    d = int(0.009 * SR)
    right = np.concatenate([np.zeros(d), out[:-d]])
    return np.stack([out, right], axis=1)


def write_wav(path, stereo):
    pcm = (np.clip(stereo, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ----------------------------------------------------------------- main

def main():
    src, cut, out, tts = sys.argv[1:5]
    cfg = json.load(open(os.path.join(HERE, 'vo.json')))
    lines = cfg[cut]
    work = os.path.join(HERE, 'out', f'audio-{cut}')
    os.makedirs(work, exist_ok=True)
    total = duration(src)

    placed = []
    for ln in lines:
        path, d, rate = tts_fit(ln, cfg['voice'], tts, work)
        placed.append((ln, path, d, rate))
        print(f"  {ln['id']:>5}  {ln['start']:6.2f}s  {d:5.2f}s / slot {ln['end'] - ln['start'] - 0.3:5.2f}s  rate +{rate}%")

    music = os.path.join(work, 'bgm.wav')
    write_wav(music, bgm(total + 0.5))

    # VO bus: each line delayed to its start, mixed, normalised to about -16 LUFS
    args = ['ffmpeg', '-y']
    for _, path, _, _ in placed:
        args += ['-i', path]
    parts = []
    for i, (ln, _, _, _) in enumerate(placed):
        ms = int(ln['start'] * 1000)
        parts.append(f"[{i}:a]aresample={SR},aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{i}]")
    parts.append(''.join(f'[v{i}]' for i in range(len(placed))) + f"amix=inputs={len(placed)}:normalize=0,apad=whole_dur={total:.3f},loudnorm=I=-16:TP=-2:LRA=9[vo]")
    vo = os.path.join(work, 'vo.wav')
    run(args + ['-filter_complex', ';'.join(parts), '-map', '[vo]', '-ar', str(SR), '-t', f'{total:.3f}', vo])

    # Music at about -21 LUFS, ducked under the VO, then the whole mix to -15 LUFS / -2.2 dBTP
    mixed = os.path.join(work, 'mix.wav')
    graph = (
        "[1:a]loudnorm=I=-21:TP=-4:LRA=7,volume=1.0[m];"
        "[0:a]asplit=2[vo1][vo2];"
        "[m][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=450:makeup=1[duck];"
        "[duck][vo2]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-2.2:LRA=9[out]"
    )
    run(['ffmpeg', '-y', '-i', vo, '-i', music, '-filter_complex', graph, '-map', '[out]', '-ar', str(SR), '-t', f'{total:.3f}', mixed])

    run(['ffmpeg', '-y', '-i', src, '-i', mixed, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
         '-c:a', 'aac', '-b:a', '192k', '-ar', str(SR), '-shortest', '-movflags', '+faststart', out])
    print(f'wrote {out} ({duration(out):.1f}s)')


if __name__ == '__main__':
    main()
