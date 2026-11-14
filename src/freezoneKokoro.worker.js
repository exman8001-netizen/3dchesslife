import { KokoroTTS } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let ttsPromise;
let activeGeneration = false;
let queuedGeneration = null;
let activeDevice = 'wasm';

function createTTS(device, requestId) {
  const useWebGPU = device === 'webgpu';
  return KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: useWebGPU ? 'fp32' : 'q8',
    device,
    progress_callback: (progress) => {
      if (progress?.status === 'progress' && Number.isFinite(progress.progress)) {
        self.postMessage({
          requestId,
          status: 'loading',
          message: `Downloading Kokoro model: ${Math.round(progress.progress)}%`
        });
      }
    }
  });
}

async function getTTS(requestId) {
  if (!ttsPromise) {
    self.postMessage({ requestId, status: 'loading', message: 'Loading Kokoro model…' });
    ttsPromise = (async () => {
      let useWebGPU = false;
      try {
        useWebGPU = Boolean(await self.navigator.gpu?.requestAdapter());
      } catch {
        useWebGPU = false;
      }
      if (useWebGPU) {
        try {
          const gpuTTS = await createTTS('webgpu', requestId);
          activeDevice = 'webgpu';
          return gpuTTS;
        } catch {
          self.postMessage({
            requestId,
            status: 'loading',
            message: 'WebGPU is unavailable; loading the smaller CPU model…'
          });
        }
      }
      activeDevice = 'wasm';
      return createTTS('wasm', requestId);
    })().catch((error) => {
      ttsPromise = undefined;
      throw error;
    });
  }
  return ttsPromise;
}

async function generate(data) {
  const { requestId, text, voice } = data || {};
  let audio;
  try {
    let tts = await getTTS(requestId);
    self.postMessage({ requestId, status: 'generating', message: 'Generating Kokoro speech…' });
    try {
      audio = await tts.generate(text, { voice });
    } catch (error) {
      if (activeDevice !== 'webgpu') throw error;
      self.postMessage({
        requestId,
        status: 'generating',
        message: 'Switching to CPU mode for this device…'
      });
      activeDevice = 'wasm';
      ttsPromise = createTTS('wasm', requestId);
      tts = await ttsPromise;
      audio = await tts.generate(text, { voice });
    }
  } catch (error) {
    self.postMessage({
      requestId,
      status: 'error',
      message: error instanceof Error ? error.message : 'Kokoro speech could not be generated.'
    });
    return;
  }
  if (queuedGeneration) {
    self.postMessage({
      requestId,
      status: 'cancelled',
      message: 'A newer character line replaced this one.'
    });
    return;
  }
  self.postMessage({ requestId, status: 'complete', audio: audio.toBlob() });
}

async function drainGenerationQueue() {
  if (activeGeneration || !queuedGeneration) return;
  activeGeneration = true;
  const request = queuedGeneration;
  queuedGeneration = null;
  try {
    await generate(request);
  } finally {
    activeGeneration = false;
    void drainGenerationQueue();
  }
}

self.addEventListener('message', ({ data }) => {
  if (data?.type === 'preload') {
    void getTTS(data.requestId).then(() => {
      self.postMessage({ requestId: data.requestId, status: 'ready' });
    }).catch((error) => {
      self.postMessage({
        requestId: data.requestId,
        status: 'error',
        message: error instanceof Error ? error.message : 'Kokoro model could not be loaded.'
      });
    });
    return;
  }
  if (queuedGeneration) {
    self.postMessage({
      requestId: queuedGeneration.requestId,
      status: 'cancelled',
      message: 'A newer character line replaced this one.'
    });
  }
  queuedGeneration = data;
  void drainGenerationQueue();
});
