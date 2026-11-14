import hmac
import io
import os
import threading
from typing import Literal

import numpy as np
import soundfile as sf
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from kokoro import KPipeline
from pydantic import BaseModel, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
pipeline_lock = threading.Lock()
active_pipeline: KPipeline | None = None
active_language: str | None = None

VOICE_LANGUAGES = {
    **{voice: "a" for voice in (
        "af_heart af_alloy af_aoede af_bella af_jessica af_kore af_nicole "
        "af_nova af_river af_sarah af_sky am_adam am_echo am_eric am_fenrir "
        "am_liam am_michael am_onyx am_puck am_santa"
    ).split()},
    **{voice: "b" for voice in (
        "bf_alice bf_emma bf_isabella bf_lily bm_daniel bm_fable bm_george bm_lewis"
    ).split()},
    **{voice: "e" for voice in ("ef_dora em_alex em_santa").split()},
    **{voice: "p" for voice in ("pf_dora pm_alex pm_santa").split()},
}


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=120)
    voice: str = Field(min_length=3, max_length=32)
    language: Literal["en-US", "en-GB", "es-ES", "pt-BR"]


def pipeline_for(language: str) -> KPipeline:
    global active_language, active_pipeline
    if active_language != language or active_pipeline is None:
        active_pipeline = KPipeline(lang_code=language)
        active_language = language
    return active_pipeline


@app.post("/v1/speech")
def generate_speech(
    payload: SpeechRequest,
    authorization: str | None = Header(default=None),
) -> Response:
    configured_key = os.environ.get("KOKORO_API_KEY", "")
    if not configured_key:
        raise HTTPException(status_code=503, detail="Kokoro service key is not configured.")
    if not authorization or not hmac.compare_digest(
        authorization, f"Bearer {configured_key}"
    ):
        raise HTTPException(status_code=401, detail="Invalid bearer token.")

    voice_language = VOICE_LANGUAGES.get(payload.voice)
    if not voice_language:
        raise HTTPException(status_code=400, detail="Unsupported Kokoro voice.")
    language_by_code = {
        "a": "en-US",
        "b": "en-GB",
        "e": "es-ES",
        "p": "pt-BR",
    }
    if language_by_code[voice_language] != payload.language:
        raise HTTPException(status_code=400, detail="Voice and language do not match.")

    with pipeline_lock:
        chunks = [
            np.asarray(audio.detach().cpu().numpy() if hasattr(audio, "detach") else audio)
            for _, _, audio in pipeline_for(voice_language)(
                payload.text,
                voice=payload.voice,
            )
        ]
    if not chunks:
        raise HTTPException(status_code=502, detail="Kokoro returned no audio.")

    audio_buffer = io.BytesIO()
    sf.write(audio_buffer, np.concatenate(chunks), 24000, format="WAV", subtype="PCM_16")
    audio = audio_buffer.getvalue()
    if not audio or len(audio) > 4 * 1024 * 1024:
        raise HTTPException(status_code=502, detail="Generated audio exceeded the size limit.")
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )
