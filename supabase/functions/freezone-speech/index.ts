import {
  authorizeFreezonePlayer,
  corsHeaders,
  errorResponse,
  FreezoneFunctionError,
  limitedText,
  readJsonBody
} from '../_shared/freezone.ts';

const openAIVoices = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'
]);
const geminiVoiceByCharacter: Record<string, string> = {
  alloy: 'Kore',
  ash: 'Fenrir',
  ballad: 'Puck',
  coral: 'Aoede',
  echo: 'Charon',
  fable: 'Puck',
  onyx: 'Charon',
  nova: 'Aoede',
  sage: 'Kore',
  shimmer: 'Aoede'
};
const qwenVoiceByCharacter: Record<string, string> = {
  alloy: 'Cherry',
  ash: 'Ethan',
  ballad: 'Ryan',
  coral: 'Serena',
  echo: 'Vincent',
  fable: 'Momo',
  onyx: 'Moon',
  nova: 'Bella',
  sage: 'Eldric Sage',
  shimmer: 'Vivian'
};
const qwenVoiceIds = new Set([
  'Cherry', 'Serena', 'Ethan', 'Chelsie', 'Momo', 'Vivian', 'Moon', 'Maia',
  'Kai', 'Bella', 'Jennifer', 'Ryan', 'Katerina', 'Aiden', 'Eldric Sage',
  'Mia', 'Mochi', 'Bellona', 'Vincent', 'Bunny', 'Neil', 'Elias', 'Arthur',
  'Nini', 'Seren', 'Pip', 'Stella', 'Bodega', 'Sonrisa', 'Alek', 'Dolce',
  'Sohee', 'Ono Anna', 'Lenn', 'Emilien', 'Andre', 'Radio Gol'
]);
const kokoroVoiceIds = new Set([
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam',
  'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx',
  'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis', 'ef_dora', 'em_alex',
  'em_santa', 'pf_dora', 'pm_alex', 'pm_santa'
]);
const voiceEvents = new Set([
  'entry', 'move', 'capture', 'death', 'allyDeath', 'purchase', 'upgrade',
  'inactivity', 'inspection', 'victory', 'defeat', 'vulnerable'
]);
const requestTimes = new Map<string, number>();

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toWav(pcm: Uint8Array, sampleRate = 24000) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header));
  wav.set(pcm, 44);
  return wav;
}

function generateGeminiLiveSpeech(
  apiKey: string,
  text: string,
  voice: string,
  language: string,
  personality: string,
  model: string
) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    const socket = new WebSocket(url);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let outputMimeType = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // The socket may already be closed by the provider.
      }
      if (error) {
        reject(error);
        return;
      }
      if (!chunks.length) {
        reject(new FreezoneFunctionError('Gemini Live returned no audio.', 502));
        return;
      }
      const audio = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(outputMimeType.includes('wav') ? audio : toWav(audio));
    };
    const timeout = setTimeout(
      () => finish(new FreezoneFunctionError('Gemini Live voice timed out.', 504)),
      25000
    );

    socket.onopen = () => {
      socket.send(JSON.stringify({
        setup: {
          model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
            }
          },
          systemInstruction: {
            parts: [{
              text: [
                `Speak in ${language}.`,
                personality ? `Character style: ${personality}.` : '',
                'Say the supplied character line faithfully, with natural emotion, and do not add a greeting or extra dialogue.'
              ].filter(Boolean).join(' ')
            }]
          }
        }
      }));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        finish(new FreezoneFunctionError('Gemini Live returned an unreadable message.', 502));
        return;
      }
      let message: {
        setupComplete?: unknown;
        error?: { message?: unknown };
        serverContent?: {
          modelTurn?: { parts?: Array<{ inlineData?: { data?: unknown; mimeType?: unknown } }> };
          turnComplete?: unknown;
        };
      };
      try {
        message = JSON.parse(event.data);
      } catch {
        finish(new FreezoneFunctionError('Gemini Live returned invalid data.', 502));
        return;
      }
      if (message.error) {
        finish(new FreezoneFunctionError('Gemini Live could not generate this voice.', 502));
        return;
      }
      if (message.setupComplete) {
        socket.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true
          }
        }));
      }
      for (const part of message.serverContent?.modelTurn?.parts || []) {
        const data = part.inlineData?.data;
        if (typeof data !== 'string') continue;
        const bytes = decodeBase64(data);
        totalBytes += bytes.length;
        if (totalBytes > 4 * 1024 * 1024) {
          finish(new FreezoneFunctionError('Gemini Live audio exceeded the size limit.', 502));
          return;
        }
        outputMimeType = typeof part.inlineData?.mimeType === 'string'
          ? part.inlineData.mimeType.toLowerCase()
          : outputMimeType;
        chunks.push(bytes);
      }
      if (message.serverContent?.turnComplete) finish();
    };
    socket.onerror = () => {
      finish(new FreezoneFunctionError('Could not connect to Gemini Live.', 502));
    };
    socket.onclose = () => {
      if (!settled) finish(new FreezoneFunctionError('Gemini Live closed before finishing the voice.', 502));
    };
  });
}

function audioResponse(audio: Uint8Array, contentType: string) {
  if (!audio.byteLength || audio.byteLength > 4 * 1024 * 1024) {
    throw new FreezoneFunctionError('Generated character audio was empty or too large.', 502);
  }
  const body = new ArrayBuffer(audio.byteLength);
  new Uint8Array(body).set(audio);
  return new Response(body, {
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Content-Length': String(audio.byteLength)
    }
  });
}

async function generateQwen3Speech(
  apiKey: string,
  text: string,
  voice: string,
  language: string,
  model: string
) {
  const languageType = language === 'pt-BR' ? 'Portuguese'
    : language === 'es-ES' ? 'Spanish' : 'English';
  const response = await fetch(
    'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'qwen3-tts-flash',
        input: {
          text,
          voice,
          language_type: languageType
        }
      })
    }
  );
  if (!response.ok) {
    throw new FreezoneFunctionError(`Qwen3-TTS request failed (${response.status}).`, 502);
  }
  const result = await response.json();
  const audioUrl = result?.output?.audio?.url;
  if (typeof audioUrl !== 'string') {
    throw new FreezoneFunctionError('Qwen3-TTS returned no audio.', 502);
  }
  let parsedAudioUrl: URL;
  try {
    parsedAudioUrl = new URL(audioUrl);
  } catch {
    throw new FreezoneFunctionError('Qwen3-TTS returned an invalid audio URL.', 502);
  }
  if (!['http:', 'https:'].includes(parsedAudioUrl.protocol) ||
      !parsedAudioUrl.hostname.endsWith('.aliyuncs.com') ||
      parsedAudioUrl.username || parsedAudioUrl.password) {
    throw new FreezoneFunctionError('Qwen3-TTS returned an untrusted audio URL.', 502);
  }
  const audioResponseFromProvider = await fetch(parsedAudioUrl, { redirect: 'error' });
  if (!audioResponseFromProvider.ok) {
    throw new FreezoneFunctionError('Could not download Qwen3-TTS audio.', 502);
  }
  const contentLength = Number(audioResponseFromProvider.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 4 * 1024 * 1024) {
    throw new FreezoneFunctionError('Qwen3-TTS audio exceeded the size limit.', 502);
  }
  const audio = new Uint8Array(await audioResponseFromProvider.arrayBuffer());
  if (audio.byteLength > 4 * 1024 * 1024) {
    throw new FreezoneFunctionError('Qwen3-TTS audio exceeded the size limit.', 502);
  }
  return audio;
}

async function generateKokoroSpeech(text: string, voice: string, suppliedApiKey: string) {
  const endpoint = Deno.env.get('KOKORO_TTS_URL');
  if (!endpoint) {
    throw new FreezoneFunctionError('Configure KOKORO_TTS_URL for the self-hosted Kokoro service.', 503);
  }
  const apiKey = suppliedApiKey || Deno.env.get('KOKORO_API_KEY') || '';
  if (!apiKey) {
    throw new FreezoneFunctionError('Configure KOKORO_API_KEY for the self-hosted Kokoro service.', 503);
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new FreezoneFunctionError('KOKORO_TTS_URL is not a valid URL.', 503);
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) ||
      url.username || url.password || url.hash || url.search) {
    throw new FreezoneFunctionError('KOKORO_TTS_URL must use HTTPS and cannot include credentials, a query, or a fragment.', 503);
  }
  const language = voice.startsWith('p') ? 'pt-BR'
    : voice.startsWith('e') ? 'es-ES'
      : voice.startsWith('b') ? 'en-GB' : 'en-US';
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'audio/wav'
    },
    body: JSON.stringify({ text, voice, language })
  });
  if (!response.ok) {
    throw new FreezoneFunctionError(`Kokoro server request failed (${response.status}).`, 502);
  }
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!['audio/wav', 'audio/x-wav'].includes(contentType || '')) {
    throw new FreezoneFunctionError('Kokoro server returned an unsupported audio type.', 502);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 4 * 1024 * 1024) {
    throw new FreezoneFunctionError('Kokoro server audio exceeded the size limit.', 502);
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  if (!audio.byteLength || audio.byteLength > 4 * 1024 * 1024) {
    throw new FreezoneFunctionError('Kokoro server audio was empty or too large.', 502);
  }
  return audio;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST is required.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await readJsonBody(request, 16 * 1024);
    const { roomCode, playerToken, state } = await authorizeFreezonePlayer(body);
    const isTest = body.action === 'test';
    const dialogueId = limitedText(body.dialogueId, 128);
    const pieceId = isTest ? 'connection-test' : limitedText(body.pieceId, 256);
    const text = isTest
      ? limitedText(body.text, 120) || 'The Freezone voice connection is working.'
      : limitedText(body.text, 120);
    if (!pieceId || !text) {
      throw new FreezoneFunctionError('A piece and non-empty speech line are required.');
    }
    const piece = !isTest && Array.isArray(state.pieces)
      ? state.pieces.find((candidate) => candidate?.id === pieceId)
      : null;
    if (!isTest) {
      if (!piece) throw new FreezoneFunctionError('Character profile was not found.', 404);
      const event = limitedText(body.event, 24);
      const validDialogue = Boolean(
        state.aiDialogue &&
        state.aiDialogue.id === dialogueId &&
        Array.isArray(state.aiDialogue.lines) &&
        state.aiDialogue.lines.some((line) => line?.pieceId === pieceId && line?.text === text)
      );
      const profileLine = piece.voiceLines?.[event] ?? piece.freeVoiceLines?.[event];
      const validEventLine = Boolean(
        voiceEvents.has(event) && typeof profileLine === 'string' && profileLine === text
      );
      if (!validDialogue && !validEventLine) {
        throw new FreezoneFunctionError('This line is not present in the synchronized room state.', 409);
      }
    }

    const provider = typeof body.provider === 'string' ? body.provider : 'gemini-live';
    if (!['gemini-live', 'gemini-tts', 'openai-tts', 'google-tts', 'qwen3-tts', 'kokoro'].includes(provider)) {
      throw new FreezoneFunctionError('Choose a supported speech provider, including Kokoro.');
    }
    const rateKey = `${roomCode}:${playerToken}:${isTest ? 'connection-test' : pieceId}`;
    const now = Date.now();
    if (now - (requestTimes.get(rateKey) || 0) < 1500) {
      throw new FreezoneFunctionError('Please wait before requesting another character voice.', 429);
    }
    requestTimes.set(rateKey, now);
    if (provider === 'kokoro') {
      const pieceVoice = limitedText(piece?.kokoroVoice, 32);
      const requestedVoice = limitedText(body.kokoroVoice, 32);
      const kokoroVoice = kokoroVoiceIds.has(pieceVoice) ? pieceVoice
        : kokoroVoiceIds.has(requestedVoice) ? requestedVoice : 'af_heart';
      return audioResponse(
        await generateKokoroSpeech(text, kokoroVoice, limitedText(body.apiKey, 512)),
        'audio/wav'
      );
    }
    const keySetting = provider === 'openai-tts' ? 'OPENAI_API_KEY'
      : provider === 'google-tts' ? 'GOOGLE_TTS_API_KEY'
        : provider === 'qwen3-tts' ? 'DASHSCOPE_API_KEY'
          : 'GEMINI_API_KEY';
    const apiKey = limitedText(body.apiKey, 512) || Deno.env.get(keySetting);
    if (!apiKey) {
      throw new FreezoneFunctionError(`Add a ${provider} API key in Freezone settings or configure it on the server.`, 503);
    }
    const model = limitedText(body.model, 128).replace(/[^a-zA-Z0-9._:/-]/g, '');

    const requestedLanguage = limitedText(body.language, 16);
    const profileLanguage = limitedText(piece?.language, 16);
    const language = ['pt-BR', 'en-US', 'es-ES'].includes(requestedLanguage)
      ? requestedLanguage
      : isTest ? 'pt-BR'
        : ['pt-BR', 'en-US', 'es-ES'].includes(profileLanguage)
          ? profileLanguage
          : 'en-US';
    const personality = isTest ? '' : limitedText(piece?.personality, 160);
    const voice = isTest ? limitedText(body.voiceId, 32) || 'alloy' : limitedText(piece?.aiVoice, 32);
    const geminiVoice = geminiVoiceByCharacter[voice] || 'Kore';
    if (provider === 'qwen3-tts') {
      const pieceQwenVoice = limitedText(piece?.qwenVoice, 64);
      const requestedQwenVoice = limitedText(body.qwenVoice, 64);
      const qwenVoice = qwenVoiceIds.has(pieceQwenVoice) ? pieceQwenVoice
        : qwenVoiceIds.has(requestedQwenVoice) ? requestedQwenVoice
          : qwenVoiceByCharacter[voice] || 'Cherry';
      const requestedQwenLanguage = limitedText(body.qwenLanguage, 16);
      const qwenLanguage = ['pt-BR', 'en-US', 'es-ES'].includes(requestedQwenLanguage)
        ? requestedQwenLanguage
        : language;
      return audioResponse(
        await generateQwen3Speech(
          apiKey,
          text,
          qwenVoice,
          qwenLanguage,
          model || 'qwen3-tts-flash'
        ),
        'audio/wav'
      );
    }
    if (provider === 'gemini-live') {
      return audioResponse(
        await generateGeminiLiveSpeech(
          apiKey,
          text,
          geminiVoice,
          language,
          personality,
          model || 'models/gemini-3.8-live'
        ),
        'audio/wav'
      );
    }

    if (provider === 'gemini-tts') {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || 'gemini-3.8-flash-tts',
          input: [{
            type: 'user_input',
            content: [{
              type: 'text',
              text,
              annotations: [{
                type: 'speech_metadata',
                style: personality ? `${language}; ${personality}` : language
              }]
            }]
          }],
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: [{ voice: geminiVoice }]
          }
        })
      });
      if (!response.ok) {
        throw new FreezoneFunctionError(`Gemini TTS request failed (${response.status}).`, 502);
      }
      const result = await response.json();
      const base64Audio = result?.output_audio?.data ||
        result?.steps?.flatMap((step: { content?: Array<{ type?: string; data?: string }> }) =>
          step?.content || []).find((part: { type?: string; data?: string }) =>
          part?.type === 'audio' && typeof part.data === 'string')?.data;
      if (typeof base64Audio !== 'string') {
        throw new FreezoneFunctionError('Gemini TTS returned no audio.', 502);
      }
      return audioResponse(decodeBase64(base64Audio), 'audio/wav');
    }

    if (provider === 'google-tts') {
      const languageCode = /^[a-z]{2}-[A-Z]{2}$/.test(language) ? language : 'en-US';
      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: {
              languageCode,
              name: `${languageCode}-Neural2-A`
            },
            audioConfig: { audioEncoding: 'MP3' }
          })
        }
      );
      if (!response.ok) {
        throw new FreezoneFunctionError(`Google Cloud TTS request failed (${response.status}).`, 502);
      }
      const result = await response.json();
      if (typeof result?.audioContent !== 'string') {
        throw new FreezoneFunctionError('Google Cloud TTS returned no audio.', 502);
      }
      return audioResponse(decodeBase64(result.audioContent), 'audio/mpeg');
    }

    if (!openAIVoices.has(voice)) {
      throw new FreezoneFunctionError('This piece does not have a supported OpenAI voice.', 400);
    }
    const instructions = [
      `Speak in ${language}.`,
      personality ? `Character style: ${personality}.` : ''
    ].filter(Boolean).join(' ');
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini-tts',
        voice,
        input: text,
        instructions,
        response_format: 'mp3'
      })
    });
    if (!response.ok) {
      throw new FreezoneFunctionError(`OpenAI TTS request failed (${response.status}).`, 502);
    }
    return audioResponse(new Uint8Array(await response.arrayBuffer()), 'audio/mpeg');
  } catch (error) {
    const response = errorResponse(error);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  }
});
