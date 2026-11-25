"""Persistent speech-to-text worker for MockingBird.

Protocol: one JSON object per line on stdin, one JSON reply per line on stdout.
The model stays loaded between requests so repeated transcriptions are fast.

Design adapted from OpenCluely's whisper worker (Apache-2.0); see NOTICE.
"""
import gc
import json
import sys
import traceback
import wave

import numpy as np

try:
    import torch
    import whisper
except ImportError as exc:  # reported to the app as a clear error
    sys.stdout.write(json.dumps({"event": "fatal", "error": f"Missing Python package: {exc.name}"}) + "\n")
    sys.stdout.flush()
    sys.exit(2)

state = {"model": None, "key": None}


def send(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def pick_device(requested):
    if requested in (None, "", "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but this PyTorch build has no CUDA support")
    return requested


def unload():
    state["model"] = None
    state["key"] = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def ensure_model(req):
    device = pick_device(req.get("device"))
    key = (req.get("model") or "small", req.get("model_dir") or None, device)
    if state["model"] is None or state["key"] != key:
        unload()
        state["model"] = whisper.load_model(key[0], device=device, download_root=key[1])
        state["key"] = key
    return state["model"], device


def read_wav(path):
    """Read 16-bit PCM WAV into float32 mono at Whisper's sample rate (no ffmpeg needed)."""
    with wave.open(path, "rb") as wf:
        channels, width, rate = wf.getnchannels(), wf.getsampwidth(), wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    if width != 2:
        raise ValueError("Only 16-bit PCM WAV is supported")
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    target = whisper.audio.SAMPLE_RATE
    if rate != target and samples.size:
        size = max(1, round(samples.size * target / rate))
        samples = np.interp(np.linspace(0, samples.size - 1, size), np.arange(samples.size), samples).astype(np.float32)
    return samples


def transcribe(req):
    model, device = ensure_model(req)
    language = req.get("language")
    if language in (None, "", "auto", "detect"):
        language = None
    result = model.transcribe(
        read_wav(req["audio_path"]),
        language=language,
        task="transcribe",
        fp16=device == "cuda",
        temperature=0,
        condition_on_previous_text=False,
        verbose=None,
    )
    return {"text": (result.get("text") or "").strip(), "language": result.get("language"), "device": device}


def main():
    send({"event": "ready", "cuda": bool(torch.cuda.is_available())})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            action = req.get("action")
            if action == "transcribe":
                send({"id": req_id, "ok": True, **transcribe(req)})
            elif action == "warmup":
                _, device = ensure_model(req)
                send({"id": req_id, "ok": True, "device": device})
            elif action == "unload":
                unload()
                send({"id": req_id, "ok": True})
            elif action == "shutdown":
                unload()
                send({"id": req_id, "ok": True})
                break
            else:
                raise ValueError(f"Unsupported action: {action}")
        except Exception as exc:  # noqa: BLE001 - report every failure to the caller
            send({"id": req_id, "ok": False, "error": str(exc), "traceback": traceback.format_exc()})


if __name__ == "__main__":
    main()
