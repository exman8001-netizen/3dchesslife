# Kokoro speech service

This optional service runs the open Kokoro model outside Supabase. It exposes the
authenticated `POST /v1/speech` endpoint used by the Freezone speech function and
supports American/British English, Spanish, and Brazilian Portuguese voices.

## Run locally

Install `espeak-ng` and `libsndfile`, then install the Python dependencies:

```powershell
python -m pip install -r requirements.txt
$env:KOKORO_API_KEY = "use-a-long-random-secret"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

The first request downloads and initializes the Kokoro weights. The service keeps
one language pipeline in memory at a time and serializes generation requests;
switching language can require a pipeline reload.

## Connect Supabase

Deploy this service to a trusted HTTPS host, then set the same secret in the
Supabase Edge Function environment:

- `KOKORO_TTS_URL`: the service URL ending in `/v1/speech`
- `KOKORO_API_KEY`: the bearer secret configured on the service

Select **Kokoro-82M · self-hosted** in Freezone AI & APIs. The browser sends the
voice request to the existing `freezone-speech` function; it does not call the
Kokoro host directly. Keep the service URL and key out of room state and client
configuration.

## Browser-only fallback

The separate Kokoro browser fallback uses `kokoro-js` and downloads quantized
model files from the ONNX Community Hugging Face repository on first use. The
current JavaScript implementation provides English voices only; use the
self-hosted service for Portuguese and Spanish.
