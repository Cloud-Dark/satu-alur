#!/usr/bin/env python3
"""Text-to-speech for make-audio.py: tts.py "<text>" <voice> <out.mp3> [rate, e.g. +5%]"""
import asyncio, os, sys

import certifi

# Behind a TLS-inspecting proxy, trust its CA bundle (set SATUALUR_CA_BUNDLE or use the sandbox default).
_ca = os.environ.get('SATUALUR_CA_BUNDLE', '/root/.ccr/ca-bundle.crt')
if os.path.exists(_ca):
    certifi.where = lambda: _ca

import edge_tts  # noqa: E402


async def main(text, voice, out, rate):
    await edge_tts.Communicate(text, voice, rate=rate).save(out)


asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else '+0%'))
