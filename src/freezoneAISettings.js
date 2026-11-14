import {
  FREEZONE_KOKORO_VOICES,
  FREEZONE_QWEN_VOICES
} from './freezoneCustomization.js';

const TEXT_PROVIDERS = new Set(['openrouter', 'gemini', 'openai', 'deepseek']);
const DEFAULT_TEXT_MODELS = {
  openrouter: 'deepseek/deepseek-v4.1-flash',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-flash'
};
const VOICE_PROVIDERS = new Set([
  'gemini-live',
  'gemini-tts',
  'openai-tts',
  'google-tts',
  'qwen3-tts',
  'kokoro'
]);
const DEFAULT_VOICE_MODELS = {
  'gemini-live': 'models/gemini-3.8-live',
  'gemini-tts': 'gemini-3.8-flash-tts',
  'openai-tts': 'gpt-4o-mini-tts',
  'google-tts': '',
  'qwen3-tts': 'qwen3-tts-flash',
  kokoro: 'kokoro-82m'
};
const API_KEY_PROVIDERS = new Set([
  'openrouter', 'gemini', 'openai', 'deepseek', 'google', 'dashscope', 'kokoro'
]);
const QWEN_VOICE_IDS = new Set(FREEZONE_QWEN_VOICES.map(({ id }) => id));
const KOKORO_VOICE_IDS = new Set(FREEZONE_KOKORO_VOICES.map(({ id }) => id));
const QWEN_LANGUAGE_IDS = new Set(['piece', 'pt-BR', 'en-US', 'es-ES']);
const SERVICE_NAMES = new Set(['movement', 'dialogue', 'speech']);

const settings = {
  movementProvider: 'openrouter',
  movementModel: 'deepseek/deepseek-v4.1-flash',
  dialogueProvider: 'openrouter',
  dialogueModel: 'deepseek/deepseek-v4.1-flash',
  dialogueEnabled: true,
  voiceProvider: 'gemini-live',
  voiceModel: 'models/gemini-3.8-live',
  qwenVoice: '',
  qwenLanguage: 'piece',
  kokoroVoice: 'af_heart',
  serviceApiKeys: {
    movement: '',
    dialogue: '',
    speech: ''
  },
  apiKeys: {
    openrouter: '',
    gemini: '',
    openai: '',
    deepseek: '',
    google: '',
    dashscope: '',
    kokoro: ''
  }
};

function boundedSecret(value) {
  return typeof value === 'string' ? value.trim().slice(0, 512) : '';
}

function boundedModel(value) {
  return typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9._:/-]/g, '').slice(0, 128) : '';
}

function providerKey(provider, service) {
  const serviceKey = settings.serviceApiKeys[service];
  if (serviceKey) return serviceKey;
  return settings.apiKeys[provider] || '';
}

export function updateFreezoneAISettings(update = {}) {
  if (TEXT_PROVIDERS.has(update.textProvider)) {
    if (!TEXT_PROVIDERS.has(update.movementProvider)) {
      settings.movementProvider = update.textProvider;
      if (typeof update.movementModel !== 'string' && typeof update.textModel !== 'string') {
        settings.movementModel = DEFAULT_TEXT_MODELS[update.textProvider];
      }
    }
    if (!TEXT_PROVIDERS.has(update.dialogueProvider)) {
      settings.dialogueProvider = update.textProvider;
      if (typeof update.dialogueModel !== 'string' && typeof update.textModel !== 'string') {
        settings.dialogueModel = DEFAULT_TEXT_MODELS[update.textProvider];
      }
    }
  }
  if (TEXT_PROVIDERS.has(update.movementProvider)) {
    if (settings.movementProvider !== update.movementProvider &&
        typeof update.movementModel !== 'string') {
      settings.movementModel = DEFAULT_TEXT_MODELS[update.movementProvider];
    }
    settings.movementProvider = update.movementProvider;
  }
  if (TEXT_PROVIDERS.has(update.dialogueProvider)) {
    if (settings.dialogueProvider !== update.dialogueProvider &&
        typeof update.dialogueModel !== 'string') {
      settings.dialogueModel = DEFAULT_TEXT_MODELS[update.dialogueProvider];
    }
    settings.dialogueProvider = update.dialogueProvider;
  }
  if (typeof update.movementModel === 'string') {
    settings.movementModel = boundedModel(update.movementModel);
  } else if (typeof update.textModel === 'string') {
    settings.movementModel = boundedModel(update.textModel);
  }
  if (typeof update.dialogueModel === 'string') {
    settings.dialogueModel = boundedModel(update.dialogueModel);
  } else if (typeof update.textModel === 'string') {
    settings.dialogueModel = boundedModel(update.textModel);
  }
  if (typeof update.dialogueEnabled === 'boolean') {
    settings.dialogueEnabled = update.dialogueEnabled;
  }
  if (VOICE_PROVIDERS.has(update.voiceProvider)) {
    settings.voiceProvider = update.voiceProvider;
    if (typeof update.voiceModel !== 'string') {
      settings.voiceModel = DEFAULT_VOICE_MODELS[update.voiceProvider];
    }
  }
  if (typeof update.voiceModel === 'string') {
    settings.voiceModel = boundedModel(update.voiceModel);
  }
  if (typeof update.qwenVoice === 'string' &&
      (!update.qwenVoice || QWEN_VOICE_IDS.has(update.qwenVoice))) {
    settings.qwenVoice = update.qwenVoice;
  }
  if (typeof update.kokoroVoice === 'string' &&
      KOKORO_VOICE_IDS.has(update.kokoroVoice)) {
    settings.kokoroVoice = update.kokoroVoice;
  }
  if (QWEN_LANGUAGE_IDS.has(update.qwenLanguage)) {
    settings.qwenLanguage = update.qwenLanguage;
  }
  if (update.serviceApiKeys && typeof update.serviceApiKeys === 'object') {
    for (const [service, key] of Object.entries(update.serviceApiKeys)) {
      if (SERVICE_NAMES.has(service)) {
        settings.serviceApiKeys[service] = boundedSecret(key);
      }
    }
  }
  if (update.apiKeys && typeof update.apiKeys === 'object') {
    for (const [provider, key] of Object.entries(update.apiKeys)) {
      if (API_KEY_PROVIDERS.has(provider)) {
        settings.apiKeys[provider] = boundedSecret(key);
      }
    }
  }
}

export function clearFreezoneAIKeys() {
  for (const provider of API_KEY_PROVIDERS) settings.apiKeys[provider] = '';
  for (const service of SERVICE_NAMES) settings.serviceApiKeys[service] = '';
}

export function getFreezoneAIRequestSettings() {
  const movementProvider = settings.movementProvider;
  const dialogueProvider = settings.dialogueProvider;
  return {
    movementProvider,
    movementModel: settings.movementModel,
    movementApiKey: providerKey(movementProvider, 'movement'),
    dialogueEnabled: settings.dialogueEnabled,
    dialogueProvider,
    dialogueModel: settings.dialogueModel,
    dialogueApiKey: providerKey(dialogueProvider, 'dialogue'),
    textProvider: movementProvider,
    textApiKey: providerKey(movementProvider, 'movement'),
    voiceProvider: settings.voiceProvider,
    voiceModel: settings.voiceModel,
    qwenVoice: settings.qwenVoice,
    qwenLanguage: settings.qwenLanguage,
    kokoroVoice: settings.kokoroVoice,
    voiceApiKey: providerKey(
      settings.voiceProvider === 'google-tts' ? 'google'
        : settings.voiceProvider === 'openai-tts' ? 'openai'
          : settings.voiceProvider === 'qwen3-tts' ? 'dashscope'
            : settings.voiceProvider === 'kokoro' ? 'kokoro'
          : 'gemini',
      'speech'
    )
  };
}

export function getFreezoneAISettings() {
  return {
    movementProvider: settings.movementProvider,
    movementModel: settings.movementModel,
    dialogueProvider: settings.dialogueProvider,
    dialogueModel: settings.dialogueModel,
    dialogueEnabled: settings.dialogueEnabled,
    voiceProvider: settings.voiceProvider,
    voiceModel: settings.voiceModel,
    qwenVoice: settings.qwenVoice,
    qwenLanguage: settings.qwenLanguage,
    kokoroVoice: settings.kokoroVoice,
    serviceApiKeys: { ...settings.serviceApiKeys },
    textProvider: settings.movementProvider,
    apiKeys: { ...settings.apiKeys }
  };
}

export function getFreezoneAIKeyPresence() {
  return Object.fromEntries(
    Array.from(API_KEY_PROVIDERS, (provider) => [
      provider,
      Boolean(settings.apiKeys[provider])
    ])
  );
}
