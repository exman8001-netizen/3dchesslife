const FREEZONE_AI_VOICE_IDS = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'
]);
const FREEZONE_SPEECH_PROVIDERS = new Set([
  'gemini-live', 'gemini-tts', 'openai-tts', 'google-tts', 'qwen3-tts', 'kokoro'
]);
export const FREEZONE_AI_IDLE_GRACE_MS = 20000;
export const FREEZONE_AMBIENT_DIALOGUE_IDLE_MS = 45000;

const FREEZONE_LOCAL_DIALOGUE_TEMPLATES = {
  'pt-BR': {
    move: [
      ({ speaker }) => `${speaker.name} avança com cuidado; esse espaço pode abrir o próximo lance.`,
      ({ speaker }) => `${speaker.name} mudou de posição. Vou manter a formação e observar o tabuleiro.`,
      ({ speaker }) => `${speaker.name} chegou a uma nova casa. Cada passo precisa ajudar a equipe.`
    ],
    capture: [
      ({ speaker, capturedName, orbType }) =>
        `${speaker.name} tirou ${capturedName} do caminho${orbType ? ` e ainda encontrou o orbe ${orbType}` : ''}. Vamos aproveitar a abertura.`,
      ({ speaker, capturedName }) =>
        `${speaker.name} venceu a disputa contra ${capturedName}. Agora temos espaço para avançar.`,
      ({ speaker, capturedName }) =>
        `${speaker.name} capturou ${capturedName}; a equipe precisa cobrir essa nova frente.`
    ],
    orb: [
      ({ speaker, orbType }) =>
        `${speaker.name} coletou o orbe ${orbType}. Esse recurso pode fazer diferença depois.`,
      ({ speaker, orbType }) =>
        `${speaker.name} encontrou o orbe ${orbType}; coleta confirmada, sem deixar a formação descoberta.`,
      ({ speaker, orbType }) =>
        `Orbe ${orbType} recolhido por ${speaker.name}. Vamos decidir juntos como aproveitar o ganho.`
    ],
    ambient: [
      ({ speaker, listener }) => [
        `${speaker.name}: Como está o caminho pelo centro?`,
        `${listener.name}: Livre por enquanto. Vou proteger a retaguarda enquanto você avança.`
      ],
      ({ speaker, listener }) => [
        `${speaker.name}: Você vê alguma abertura segura?`,
        `${listener.name}: Sim. Se mantivermos a formação, podemos avançar sem nos separar.`
      ],
      ({ speaker, listener }) => [
        `${speaker.name}: O tabuleiro está quieto. Qual deve ser nosso próximo plano?`,
        `${listener.name}: Vamos observar as casas livres e agir quando surgir uma chance.`
      ]
    ]
  },
  'en-US': {
    move: [
      ({ speaker }) => `${speaker.name} moved carefully; this space could open the next play.`,
      ({ speaker }) => `${speaker.name} changed position. I'll hold formation and watch the board.`,
      ({ speaker }) => `${speaker.name} reached a new square. Every step should help the team.`
    ],
    capture: [
      ({ speaker, capturedName, orbType }) =>
        `${speaker.name} cleared ${capturedName}${orbType ? ` and found the ${orbType} orb` : ''}. Let's use the opening.`,
      ({ speaker, capturedName }) =>
        `${speaker.name} won the exchange with ${capturedName}. We have room to advance now.`,
      ({ speaker, capturedName }) =>
        `${speaker.name} captured ${capturedName}; the team should cover this new front.`
    ],
    orb: [
      ({ speaker, orbType }) =>
        `${speaker.name} collected the ${orbType} orb. That resource may matter later.`,
      ({ speaker, orbType }) =>
        `${speaker.name} secured the ${orbType} orb without leaving the formation exposed.`,
      ({ speaker, orbType }) =>
        `${speaker.name} picked up the ${orbType} orb. Let's decide how to use the gain.`
    ],
    ambient: [
      ({ speaker, listener }) => [
        `${speaker.name}: How does the center look?`,
        `${listener.name}: Clear for now. I'll guard the rear while you move up.`
      ],
      ({ speaker, listener }) => [
        `${speaker.name}: Do you see a safe opening?`,
        `${listener.name}: Yes. If we hold formation, we can advance without splitting up.`
      ],
      ({ speaker, listener }) => [
        `${speaker.name}: The board is quiet. What's our next plan?`,
        `${listener.name}: Let's watch the open squares and move when a chance appears.`
      ]
    ]
  },
  'es-ES': {
    move: [
      ({ speaker }) => `${speaker.name} avanza con cuidado; esta posición puede abrir la siguiente jugada.`,
      ({ speaker }) => `${speaker.name} cambió de posición. Mantendré la formación y vigilaré el tablero.`,
      ({ speaker }) => `${speaker.name} llegó a una nueva casilla. Cada paso debe ayudar al equipo.`
    ],
    capture: [
      ({ speaker, capturedName, orbType }) =>
        `${speaker.name} apartó a ${capturedName}${orbType ? ` y encontró el orbe ${orbType}` : ''}. Aprovechemos la oportunidad.`,
      ({ speaker, capturedName }) =>
        `${speaker.name} ganó el intercambio con ${capturedName}. Ahora tenemos espacio para avanzar.`,
      ({ speaker, capturedName }) =>
        `${speaker.name} capturó a ${capturedName}; el equipo debe cubrir este nuevo frente.`
    ],
    orb: [
      ({ speaker, orbType }) =>
        `${speaker.name} recogió el orbe ${orbType}. Ese recurso puede ser útil más adelante.`,
      ({ speaker, orbType }) =>
        `${speaker.name} aseguró el orbe ${orbType} sin dejar expuesta la formación.`,
      ({ speaker, orbType }) =>
        `${speaker.name} encontró el orbe ${orbType}. Decidamos cómo aprovecharlo.`
    ],
    ambient: [
      ({ speaker, listener }) => [
        `${speaker.name}: ¿Qué tal está el centro?`,
        `${listener.name}: Despejado por ahora. Protegeré la retaguardia mientras avanzas.`
      ],
      ({ speaker, listener }) => [
        `${speaker.name}: ¿Ves una oportunidad segura?`,
        `${listener.name}: Sí. Si mantenemos la formación, podremos avanzar sin separarnos.`
      ],
      ({ speaker, listener }) => [
        `${speaker.name}: El tablero está tranquilo. ¿Cuál es el siguiente plan?`,
        `${listener.name}: Vigilemos las casillas libres y actuemos cuando aparezca una oportunidad.`
      ]
    ]
  }
};

const FREEZONE_ORB_DIALOGUE_NAMES = {
  xp: { 'pt-BR': 'XP', 'en-US': 'XP', 'es-ES': 'XP' },
  red: { 'pt-BR': 'vermelho', 'en-US': 'red', 'es-ES': 'rojo' },
  blue: { 'pt-BR': 'azul', 'en-US': 'blue', 'es-ES': 'azul' },
  yellow: { 'pt-BR': 'amarelo', 'en-US': 'yellow', 'es-ES': 'amarillo' },
  purple: { 'pt-BR': 'roxo', 'en-US': 'purple', 'es-ES': 'morado' },
  white: { 'pt-BR': 'branco', 'en-US': 'white', 'es-ES': 'blanco' },
  bot: { 'pt-BR': 'de bot', 'en-US': 'bot', 'es-ES': 'de bot' },
  movement: { 'pt-BR': 'de movimento', 'en-US': 'movement', 'es-ES': 'de movimiento' }
};

function chooseFreezoneDialogueTemplate(templates, history, random, context) {
  const recentTexts = new Set(
    history.slice(-12).map((entry) => entry?.text?.trim().toLocaleLowerCase()).filter(Boolean)
  );
  const fresh = templates.filter((template) => {
    const result = template(context);
    const texts = Array.isArray(result) ? result : [result];
    return !texts.some((text) => recentTexts.has(text.toLocaleLowerCase()));
  });
  const choices = fresh.length ? fresh : templates;
  const value = Number(random());
  const index = Number.isFinite(value)
    ? Math.max(0, Math.min(choices.length - 1, Math.floor(value * choices.length)))
    : 0;
  return choices[index];
}

export function createFreezoneLocalDialogue({
  event,
  language = 'en-US',
  speaker,
  listener,
  capturedName = '',
  orbType = '',
  history = [],
  createdAt = Date.now(),
  id = `local-${createdAt}`,
  random = Math.random
} = {}) {
  const safeLanguage = Object.prototype.hasOwnProperty.call(
    FREEZONE_LOCAL_DIALOGUE_TEMPLATES,
    language
  ) ? language : 'en-US';
  const templates = FREEZONE_LOCAL_DIALOGUE_TEMPLATES[safeLanguage];
  const safeSpeaker = {
    id: typeof speaker?.id === 'string' ? speaker.id : '',
    name: typeof speaker?.name === 'string' && speaker.name.trim()
      ? speaker.name.trim().slice(0, 32)
      : 'Piece'
  };
  const safeListener = {
    id: typeof listener?.id === 'string' ? listener.id : '',
    name: typeof listener?.name === 'string' && listener.name.trim()
      ? listener.name.trim().slice(0, 32)
      : 'Teammate'
  };
  const safeOrbType = FREEZONE_ORB_DIALOGUE_NAMES[orbType]?.[language] ||
    FREEZONE_ORB_DIALOGUE_NAMES[orbType]?.['en-US'] ||
    (typeof orbType === 'string' && orbType ? orbType.slice(0, 32) : '');
  const context = {
    speaker: safeSpeaker,
    listener: safeListener,
    capturedName: typeof capturedName === 'string' && capturedName.trim()
      ? capturedName.trim().slice(0, 32)
      : 'an opponent',
    orbType: safeOrbType
  };
  let lines;
  if (event === 'ambient') {
    if (!safeSpeaker.id || !safeListener.id || safeSpeaker.id === safeListener.id) return null;
    const template = chooseFreezoneDialogueTemplate(templates.ambient, history, random, context);
    lines = template(context).map((text, index) => ({
      pieceId: index === 0 ? safeSpeaker.id : safeListener.id,
      text,
      language: safeLanguage
    }));
  } else {
    const eventTemplates = templates[event];
    if (!eventTemplates || !safeSpeaker.id) return null;
    const template = chooseFreezoneDialogueTemplate(eventTemplates, history, random, context);
    lines = [{
      pieceId: safeSpeaker.id,
      text: template(context),
      language: safeLanguage
    }];
  }
  return {
    id: typeof id === 'string' ? id.slice(0, 128) : `local-${createdAt}`,
    createdAt: Number.isSafeInteger(createdAt) && createdAt >= 0 ? createdAt : Date.now(),
    lines
  };
}

export function freezoneAICandidateId(pieceId, from, to, kind = 'move') {
  return JSON.stringify([pieceId, from.r, from.c, to.r, to.c, kind]);
}

export function hasFreezoneAIActions(player, now = Date.now()) {
  const remainingActions = Number(player?.movesPerCycle || 0) - Number(player?.movesUsed || 0);
  const remainingSteps = Number(player?.stepBudget || 0) - Number(player?.stepsUsed || 0);
  return Number.isFinite(now) &&
    Number(player?.cooldownUntil || 0) <= now &&
    remainingActions > 0 &&
    remainingSteps > 0;
}

export function chooseFreezoneFallbackMove(candidates, boardSize, lastPlayerMove = null) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const coordinates = candidates.flatMap((candidate) => [
    candidate?.from?.r,
    candidate?.from?.c,
    candidate?.to?.r,
    candidate?.to?.c
  ]).filter(Number.isSafeInteger);
  const size = Number.isSafeInteger(boardSize) && boardSize > 1
    ? boardSize
    : coordinates.length ? Math.max(...coordinates) + 1 : 0;
  if (size <= 1) return null;
  const center = (size - 1) / 2;
  const distance = (point, target) =>
    Math.abs(point.r - target.r) + Math.abs(point.c - target.c);
  const target = Number.isSafeInteger(lastPlayerMove?.to?.r) &&
      Number.isSafeInteger(lastPlayerMove?.to?.c)
    ? lastPlayerMove.to
    : null;
  const score = (candidate) => {
    const centerGain = distance(candidate.from, { r: center, c: center }) -
      distance(candidate.to, { r: center, c: center });
    const supportGain = target
      ? distance(candidate.from, target) - distance(candidate.to, target)
      : 0;
    return (candidate.enemyCapture ? 20000 : candidate.capture ? 10000 : 0) +
      centerGain * 100 +
      supportGain * 5 -
      (Number(candidate.stepCost) || 1) * 0.01;
  };
  return candidates.reduce((best, candidate) => {
    if (!candidate || typeof candidate.id !== 'string' ||
        !candidate.from || !candidate.to) return best;
    if (!best) return candidate;
    const scoreDifference = score(candidate) - score(best);
    return scoreDifference > 0 ||
      (scoreDifference === 0 && candidate.id.localeCompare(best.id) < 0)
      ? candidate
      : best;
  }, null);
}

export function isFreezoneAIMoveProviderFailure(error) {
  const status = Number(error?.status);
  const message = error instanceof Error ? error.message : String(error || '');
  return [408, 425, 429, 500, 502, 503, 504].includes(status) ||
    error?.name === 'AbortError' ||
    /failed to fetch|networkerror|network request failed|timed out/i.test(message);
}

export function isFreezoneAIMoveStateConflict(error) {
  const status = Number(error?.status);
  const message = error instanceof Error ? error.message : String(error || '');
  return (status === 409 &&
      !/army is resting|no actions left this cycle|no legal bot-controlled piece/i.test(message)) ||
    (status === 409 &&
      /selected piece has not been synchronized yet|position changed/i.test(message)) ||
    /AI move canceled because the position changed|AI selected a move that is no longer legal/i
      .test(message);
}

export function shouldRequestFreezoneAIVoice(enabled, text, voiceId, provider = 'openai-tts') {
  return enabled === true && typeof text === 'string' && text.trim().length > 0 &&
    FREEZONE_SPEECH_PROVIDERS.has(provider) &&
    (provider !== 'openai-tts' || FREEZONE_AI_VOICE_IDS.has(voiceId));
}

export function normalizeFreezoneAIDecision(response, candidates, allowedPieceIds) {
  if (!response || typeof response !== 'object' ||
      typeof response.moveId !== 'string') {
    return { ok: false, error: 'The AI returned an invalid move.' };
  }
  const candidate = candidates.find(({ id }) => id === response.moveId);
  if (!candidate) {
    return { ok: false, error: 'The AI selected a move that is no longer legal.' };
  }
  const allowedSpeakers = new Set(allowedPieceIds);
  let lines = (Array.isArray(response.lines) ? response.lines : [])
    .slice(0, 2)
    .filter((line) => line && allowedSpeakers.has(line.pieceId) &&
      typeof line.text === 'string')
    .map((line) => ({
      pieceId: line.pieceId,
      text: line.text.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120)
    }))
    .filter((line) => line.text.length > 0);
  if (lines.length > 1 && lines[0].pieceId === lines[1].pieceId) {
    lines = lines.slice(0, 1);
  }
  return { ok: true, candidate, lines };
}
