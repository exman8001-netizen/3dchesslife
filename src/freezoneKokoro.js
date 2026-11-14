let worker;
let nextRequestId = 0;
const pendingRequests = new Map();

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined') {
    throw new Error('Kokoro local speech is not supported in this browser.');
  }

  worker = new Worker(new URL('./freezoneKokoro.worker.js', import.meta.url), {
    type: 'module'
  });
  worker.addEventListener('message', ({ data }) => {
    const pending = pendingRequests.get(data?.requestId);
    if (!pending) return;
    if (data.status === 'loading' || data.status === 'generating') {
      pending.onStatus?.(data.message);
    } else {
      pendingRequests.delete(data.requestId);
      if (data.status === 'complete' && data.audio instanceof Blob) {
        pending.resolve(data.audio);
      } else if (data.status === 'ready') {
        pending.resolve(null);
      } else if (data.status === 'cancelled') {
        const error = new Error(data.message || 'Kokoro speech was replaced by a newer line.');
        error.name = 'AbortError';
        pending.reject(error);
      } else {
        pending.reject(new Error(data.message || 'Kokoro speech could not be generated.'));
      }
    }
  });
  worker.addEventListener('error', (event) => {
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error(event.message || 'Kokoro speech worker failed.'));
    }
    pendingRequests.clear();
    worker?.terminate();
    worker = undefined;
  });
  return worker;
}

/**
 * @param {string} text
 * @param {string} voice
 * @param {(message: string) => void} [onStatus]
 * @returns {Promise<Blob>}
 */
export function generateFreezoneKokoroSpeech(text, voice, onStatus) {
  const requestId = ++nextRequestId;
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject, onStatus });
    try {
      getWorker().postMessage({ requestId, text, voice });
    } catch (error) {
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error('Kokoro speech could not be started.'));
    }
  });
}

/**
 * @param {(message: string) => void} [onStatus]
 * @returns {Promise<null>}
 */
export function preloadFreezoneKokoroSpeech(onStatus) {
  const requestId = ++nextRequestId;
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject, onStatus });
    try {
      getWorker().postMessage({ requestId, type: 'preload' });
    } catch (error) {
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error('Kokoro model could not be loaded.'));
    }
  });
}
