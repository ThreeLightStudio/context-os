# Context OS Voice Capture helper

This package is a macOS-only Native helper used by the Raycast extension. It keeps the newest 15 minutes of 16 kHz mono audio in memory, stores no persistent audio buffer, and exposes a local Unix socket for Raycast commands.

The helper requires:

- a local `whisper.cpp` `whisper-cli` executable;
- a multilingual GGML model such as `ggml-large-v3-turbo.bin`;
- macOS microphone permission.

The Raycast extension preferences provide the executable and model paths. Audio is written to a temporary WAV only while transcription runs. The helper deletes temporary files after success or failure and removes stale `context-voice-*` files on startup and Clear.

Build and test from this directory:

```sh
pnpm test
pnpm build
```
