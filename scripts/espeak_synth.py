"""Offline text-to-speech with eSpeak NG (pip package `espeakng-loader`).

Usage: python3 scripts/espeak_synth.py <phrases.json> <out_dir>
phrases.json: [{"lang": "zh-CN", "id": "issue.late-contact.now", "text": "..."}]
Writes <out_dir>/<lang>/<id>.mp3 (mono, 40 kbit/s; encoded with `lameenc`).
Runs entirely offline: the voice data ships inside the Python package, and
nothing is sent anywhere.
"""
import ctypes
import json
import os
import sys

import espeakng_loader
import lameenc

VOICES = {"zh-CN": "cmn", "en-US": "en-us"}
AUDIO_OUTPUT_SYNCHRONOUS = 2
espeakCHARS_UTF8 = 1

lib = ctypes.cdll.LoadLibrary(espeakng_loader.get_library_path())
rate = lib.espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, espeakng_loader.get_data_path().encode(), 0)
if rate <= 0:
    sys.exit("espeak-ng initialisation failed")

SynthCallback = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
buffer = bytearray()


@SynthCallback
def on_audio(wav, numsamples, _events):
    if numsamples > 0:
        buffer.extend(ctypes.string_at(wav, numsamples * 2))
    return 0


lib.espeak_SetSynthCallback(on_audio)
lib.espeak_Synth.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_uint, ctypes.c_int,
                             ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
espeakRATE = 1


def synth(text: str, voice: str, speed: int) -> bytes:
    buffer.clear()
    if lib.espeak_SetVoiceByName(voice.encode()) != 0:
        raise RuntimeError(f"voice {voice} not available")
    lib.espeak_SetParameter(espeakRATE, speed, 0)
    data = text.encode("utf-8") + b"\0"
    lib.espeak_Synth(data, len(data), 0, 0, 0, espeakCHARS_UTF8, None, None)
    lib.espeak_Synchronize()
    return bytes(buffer)


def main() -> None:
    phrases = json.load(open(sys.argv[1], encoding="utf-8"))
    out_dir = sys.argv[2]
    for p in phrases:
        pcm = synth(p["text"], VOICES[p["lang"]], 200 if p["lang"] == "zh-CN" else 170)
        if len(pcm) < rate // 4:  # < 0.125 s of audio means synthesis failed
            raise RuntimeError(f"no audio for {p['lang']} {p['id']}")
        os.makedirs(os.path.join(out_dir, p["lang"]), exist_ok=True)
        enc = lameenc.Encoder()
        enc.set_bit_rate(40)
        enc.set_in_sample_rate(rate)
        enc.set_channels(1)
        enc.set_quality(2)
        mp3 = enc.encode(pcm) + enc.flush()
        with open(os.path.join(out_dir, p["lang"], p["id"] + ".mp3"), "wb") as f:
            f.write(mp3)
    print(f"[voice-clips] synthesized {len(phrases)} clips at {rate} Hz")


main()
