import { useEffect, useRef, useState, type FormEvent } from 'react';
import FreezoneAppearancePreview from './FreezoneAppearancePreview';
import {
  FREEZONE_AI_LANGUAGES,
  FREEZONE_AI_VOICES,
  FREEZONE_APPEARANCES,
  FREEZONE_VOICE_EVENTS,
  formatFreezoneSessionAge,
  resolveFreezoneVoice,
  shouldSpeakFreezoneVoice,
  shouldUseCompactFreezoneLeaderboard
} from './freezoneCustomization.js';
import { shouldRequestFreezoneAIVoice } from './freezoneAi.js';
import {
  requestFreezoneSpeech,
  testFreezoneAIService,
  testFreezoneSpeechService
} from './multiplayerSupabase.js';
import {
  clearFreezoneAIKeys,
  getFreezoneAISettings,
  updateFreezoneAISettings
} from './freezoneAISettings.js';
import {
  FREEZONE_ENVELOPE_ORB_COST,
  FREEZONE_ENVELOPE_OPTIONS,
  FREEZONE_MOVEMENT_ORB_COST,
  canUpgradeFreezoneEnvelope,
  getFreezoneEnvelopeUpgradeCost,
  validateFreezoneAudioFile,
  validateFreezoneAudioUrl
} from './freezoneRules.js';

function getFreezoneAudioPlaybackError(error?: unknown) {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'The browser blocked audio playback. Press “Enable audio here” to try again.';
  }
  return 'This URL could not be streamed as audio. The server may offer it as a download or use an unsupported audio type. Download the MP3 and load it as a local file; local playback is only on this device.';
}

type PieceType = 'pawn' | 'rook' | 'knight' | 'bishop' | 'queen';
type MoveOffset = [number, number];
type VoiceEventKey =
  | 'entry' | 'move' | 'capture' | 'death' | 'allyDeath' | 'purchase' | 'upgrade'
  | 'inactivity' | 'inspection' | 'victory' | 'defeat' | 'vulnerable';
type PieceVoiceLines = Record<VoiceEventKey, string>;
type FreezoneTextProvider = 'openrouter' | 'gemini' | 'openai' | 'deepseek';
type FreezoneSpeechProvider = 'gemini-live' | 'gemini-tts' | 'openai-tts' | 'google-tts';

type FreezoneRoom = {
  id: string;
  code: string;
  status: string;
  kind: string;
  name: string;
  format?: string | null;
  publication?: {
    description: string;
    thumbnailUrl: string;
    tags: string[];
  } | null;
  isMainArena: boolean;
  joined: number;
  capacity: number;
  online?: number;
  reconnecting?: number;
  bots?: number;
  staleClaims?: number;
};

export type FreezonePattern = {
  id: string;
  name: string;
  title: string;
  catchphrase: string;
  appearance: string;
  description: string;
  personality: string;
  language: string;
  aiVoice: string;
  voiceLines: PieceVoiceLines;
  type: PieceType;
  moves: MoveOffset[];
  jumps: MoveOffset[];
  teleports: MoveOffset[];
  slide: boolean;
};

type FreezoneOwnedPiece = {
  id: string;
  name: string;
  title: string;
  catchphrase: string;
  description: string;
  personality: string;
  language: string;
  aiVoice: string;
  appearance: string;
  eliminations: number;
  moves: MoveOffset[];
  jumps: MoveOffset[];
  teleports: MoveOffset[];
  unlockedMoves: MoveOffset[];
  movementLimit: { rows: number; cols: number };
  slide: boolean;
  voiceLines: PieceVoiceLines;
  type: PieceType | 'king';
};
type FreezoneInspectedPiece = FreezoneOwnedPiece & {
  side: number;
  x: number;
  y: number;
};
type FreezoneSpeechBubble = { text: string; x: number; y: number };

type FreezoneOrbEffect = {
  type: 'xp' | 'red' | 'blue' | 'yellow' | 'purple' | 'white' | 'bot' | 'movement';
  label: string;
  description: string;
  color: string;
};
type FreezoneUpgrade = Exclude<FreezoneOrbEffect['type'], 'xp' | 'bot' | 'movement'>;
type FreezoneAllyRole = 'strategic' | 'offensive' | 'defensive' | 'guardian' | 'collector';
type FreezoneAlly = { id: string; pieceId: string; name: string; role: FreezoneAllyRole };
type FreezoneOnlinePlayer = {
  side: number;
  name: string;
  bot: boolean;
  online: true;
  playing: boolean;
  kills?: number;
  xp?: number;
  orbsCollected?: number;
  pieces?: number;
  sessionStartedAt?: number;
  timeLabel?: string;
};

type FreezoneRoomRankingEntry = FreezoneOnlinePlayer & {
  position: number;
  leader: boolean;
  crown: boolean;
};
type FreezoneShopTab = 'shop' | 'bots' | 'resources' | 'profile' | 'api';
type FreezonePurchaseOrb = Exclude<FreezoneOrbEffect['type'], 'xp' | 'bot'>;
type FreezoneAIService = 'movement' | 'dialogue' | 'speech';
type FreezoneAIServiceStatus = {
  state: 'idle' | 'checking' | 'ok' | 'error';
  message: string;
};

function waitForFreezoneAITestResult(requestId: string, timeoutMs: number) {
  return new Promise<{ message: string }>((resolve, reject) => {
    let timeout = 0;
    const handleResult = (event: Event) => {
      const detail = (event as CustomEvent<{
        requestId?: string;
        ok?: boolean;
        message?: string;
      }>).detail;
      if (detail?.requestId !== requestId) return;
      window.removeEventListener('wizard-chess-freezone-ai-test-result', handleResult);
      window.clearTimeout(timeout);
      if (detail.ok) resolve({ message: detail.message || 'Test completed.' });
      else reject(new Error(detail.message || 'The Freezone test action failed.'));
    };
    timeout = window.setTimeout(() => {
      window.removeEventListener('wizard-chess-freezone-ai-test-result', handleResult);
      reject(new Error('The Freezone test action timed out.'));
    }, timeoutMs);
    window.addEventListener('wizard-chess-freezone-ai-test-result', handleResult);
  });
}

const FREEZONE_TEXT_MODEL_DEFAULTS = {
  openrouter: 'deepseek/deepseek-v4.1-flash',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-flash'
} as const;
const FREEZONE_SPEECH_MODEL_DEFAULTS = {
  'gemini-live': 'models/gemini-3.8-live',
  'gemini-tts': 'gemini-3.8-flash-tts',
  'openai-tts': 'gpt-4o-mini-tts',
  'google-tts': ''
} as const;

type FreezoneHud = {
  enabled: boolean;
  isPlayer: boolean;
  playerName: string;
  selectedPieceName: string;
  xp: number;
  xpCost: number;
  xpProgress: number;
  capacity: number;
  maxCapacity: number;
  pieces: number;
  movesPerCycle: number;
  cooldownDurationMs: number;
  editorRange: number;
  envelopeRows: number;
  envelopeCols: number;
  stepBudget: number;
  stepsUsed: number;
  mutantZone?: { shape: 'diamond' | 'triangle' | 'circle'; remainingMs: number } | null;
  sharedMusicUrl?: string;
  sharedMusicPlaying: boolean;
  sharedMusicStartedAt: number;
  maxPatternOffsets: number;
  upgradeLevels: { red: number; blue: number; yellow: number; purple: number; white: number };
  orbBalances: Record<FreezoneOrbEffect['type'], number>;
  allies: FreezoneAlly[];
  alliedBots: Array<FreezoneAlly & { side: number; playing: boolean }>;
  aiBotsEnabled?: boolean;
  allyCost: number;
  canUpgrade: Record<FreezoneUpgrade, boolean>;
  ownedPieces: FreezoneOwnedPiece[];
  orbEffects: FreezoneOrbEffect[];
  movesUsed: number;
  cooldownMs: number;
  cooldownUntil: number;
  boardSize: number;
  maxPlayers: number;
  roomCode?: string;
  pieceOptions: FreezonePattern[];
  publicPieces: FreezoneOwnedPiece[];
  eliminationLeaders: { count: number; leaders: Array<{ id: string; name: string }> };
  playerEliminationLeaderboard: Array<{
    side: number;
    name: string;
    bot: boolean;
    eliminations: number;
  }>;
  onlinePlayers: FreezoneOnlinePlayer[];
  teamPieces: Array<{
    id: string;
    name: string;
    type: FreezoneOwnedPiece['type'];
    ally: boolean;
    cooldownDurationMs: number;
    readyAt: number;
    cooldownMs: number;
  }>;
  economy: {
    pieceCostXP: number;
    allyCostXP: number;
    orbCosts: Record<string, number>;
    eliminationXP: Record<string, number>;
  };
  roomLeaderboard?: FreezoneRoomRankingEntry[];
  botsEnabled: boolean;
};

type FreezoneApiResult = { ok: boolean; code?: string; error?: string };
type FreezonePatternInput = Omit<FreezonePattern, 'id'> | FreezonePattern;
type FreezonePanelProps = { mainMenuOpen: boolean };

function readLocalSetting(key: string, fallback = '') {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function readLocalVolume() {
  const parsed = Number(readLocalSetting('freezone-music-volume', '0.55'));
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.55;
}

const PIECE_TYPES: { type: PieceType; label: string }[] = [
  { type: 'pawn', label: 'Pawn' },
  { type: 'rook', label: 'Rook' },
  { type: 'knight', label: 'Knight' },
  { type: 'bishop', label: 'Bishop' },
  { type: 'queen', label: 'Queen' }
];
const FREEZONE_UPGRADES: { type: Exclude<FreezoneUpgrade, 'white'>; label: string; description: string }[] = [
  { type: 'red', label: 'Move actions', description: '+1 move action per cycle' },
  { type: 'blue', label: 'Unit-step budget', description: '+2 unit steps per cycle' },
  { type: 'yellow', label: 'Cooldown', description: 'Reduce rest by 0.3 seconds' },
  { type: 'purple', label: 'Army capacity', description: '+1 piece slot' }
];
const FREEZONE_ALLY_LABELS: Record<FreezoneAllyRole, string> = {
  strategic: 'Strategic',
  offensive: 'Offensive',
  defensive: 'Defensive',
  guardian: 'Guardian',
  collector: 'Orb collector'
};
const FREEZONE_ALLY_DESCRIPTIONS: Record<FreezoneAllyRole, string> = {
  strategic: 'Balances valuable orbs, captures, and safe progress.',
  offensive: 'Presses toward opponents and favors legal captures.',
  defensive: 'Stays near your team and responds to nearby threats.',
  guardian: 'Stays close to your king and moves to meet nearby threats.',
  collector: 'Prioritizes bot orbs, then seeks other nearby orbs.'
};

function movementText(
  moves: MoveOffset[],
  jumps: MoveOffset[],
  teleports: MoveOffset[],
  slide: boolean
) {
  const directions = moves
    .map(([row, col], index) => {
      const jump = jumps.some(([jumpRow, jumpCol]) => jumpRow === row && jumpCol === col);
      const teleport = teleports.some(([moveRow, moveCol]) => moveRow === row && moveCol === col);
      return `${index + 1} ${teleport ? 'teleport' : jump ? 'jump' : 'drag'}: ${row > 0 ? '+' : ''}${row},${col > 0 ? '+' : ''}${col}`;
    })
    .join(' · ');
  return `${slide ? 'Sliding' : 'Step'}: ${directions}`;
}

export default function FreezonePanel({ mainMenuOpen }: FreezonePanelProps) {
  const [hud, setHud] = useState<FreezoneHud | null>(null);
  const [open, setOpen] = useState(false);
  const activeFreezoneHudRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('');
  const [rooms, setRooms] = useState<FreezoneRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [feedback, setFeedback] = useState('');
  const [radioOpen, setRadioOpen] = useState(false);
  const [rankingCollapsed, setRankingCollapsed] = useState(false);
  const [activeShopTab, setActiveShopTab] = useState<FreezoneShopTab>('shop');
  const [allyNameDraft, setAllyNameDraft] = useState('');
  const [editingPieceId, setEditingPieceId] = useState('');
  const [cooldownNow, setCooldownNow] = useState(Date.now);
  const [compactLeaderboard, setCompactLeaderboard] = useState(
    () => (typeof window === 'undefined' ? false : shouldUseCompactFreezoneLeaderboard(window.innerWidth))
  );
  const [botsBusy, setBotsBusy] = useState(false);
  const [allyRole, setAllyRole] = useState<FreezoneAllyRole>('strategic');
  const [designMode, setDesignMode] = useState(false);
  const [pieceType, setPieceType] = useState<PieceType>('knight');
  const [pieceName, setPieceName] = useState('');
  const [pieceTitle, setPieceTitle] = useState('');
  const [pieceDescription, setPieceDescription] = useState('');
  const [piecePersonality, setPiecePersonality] = useState('');
  const [pieceLanguage, setPieceLanguage] = useState('en-US');
  const [pieceAIVoice, setPieceAIVoice] = useState('alloy');
  const [pieceCatchphrase, setPieceCatchphrase] = useState('');
  const [appearance, setAppearance] = useState(FREEZONE_APPEARANCES[0].id);
  const [voiceLines, setVoiceLines] = useState<PieceVoiceLines>({
    entry: '', move: '', capture: '', death: '', allyDeath: '', purchase: '', upgrade: '',
    inactivity: '', inspection: '', victory: '', defeat: '', vulnerable: ''
  });
  const [inspectedPiece, setInspectedPiece] = useState<FreezoneInspectedPiece | null>(null);
  const [speechBubble, setSpeechBubble] = useState<FreezoneSpeechBubble | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(
    () => readLocalSetting('freezone-voice-enabled') === 'true'
  );
  const [aiVoiceEnabled, setAIVoiceEnabled] = useState(
    () => readLocalSetting('freezone-ai-voice-enabled') === 'true'
  );
  const [aiAssistEnabled, setAIAssistEnabled] = useState(
    () => readLocalSetting('freezone-ai-assist-enabled') === 'true'
  );
  const [aiBotsEnabled, setAIBotsEnabled] = useState(
    () => readLocalSetting('freezone-ai-bots-enabled') === 'true'
  );
  const [aiSettings, setAISettings] = useState(() => {
    try {
      const saved = JSON.parse(readLocalSetting('freezone-ai-preferences', '{}'));
      updateFreezoneAISettings(saved);
    } catch {
      updateFreezoneAISettings({});
    }
    return getFreezoneAISettings();
  });
  const [aiServiceStatuses, setAIServiceStatuses] = useState<
    Partial<Record<FreezoneAIService, FreezoneAIServiceStatus>>
  >({});
  const [aiVoiceStatus, setAIVoiceStatus] = useState('');
  const [aiVoiceReady, setAIVoiceReady] = useState(false);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(
    () => readLocalSetting('freezone-voice-uri')
  );
  const [musicSource, setMusicSource] = useState(() => readLocalSetting('freezone-music-url'));
  const [musicUrl, setMusicUrl] = useState(() => readLocalSetting('freezone-music-url'));
  const [musicVolume, setMusicVolume] = useState(readLocalVolume);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [sharedMusicPlaying, setSharedMusicPlaying] = useState(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<FreezonePatternInput | null>(null);
  const [selectedMoves, setSelectedMoves] = useState<MoveOffset[]>([]);
  const [selectedJumps, setSelectedJumps] = useState<MoveOffset[]>([]);
  const [selectedTeleports, setSelectedTeleports] = useState<MoveOffset[]>([]);
  const [targetEnvelope, setTargetEnvelope] = useState({ rows: 1, cols: 2 });
  const [targetMovementScope, setTargetMovementScope] = useState({ rows: 1, cols: 1 });
  const [targetMovementA, setTargetMovementA] = useState(1);
  const [selectedMovementPieceId, setSelectedMovementPieceId] = useState('');
  const [movementKind, setMovementKind] = useState<'drag' | 'jump' | 'teleport'>('drag');
  const [slide, setSlide] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const localMusicUrl = useRef('');
  const aiVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const aiVoiceUrlRef = useRef('');
  const aiVoiceQueueRef = useRef(Promise.resolve());
  const aiVoiceEnabledRef = useRef(aiVoiceEnabled);
  const voiceCooldowns = useRef(new Map<string, number>());

  useEffect(() => {
    try {
      window.localStorage.setItem('freezone-ai-assist-enabled', String(aiAssistEnabled));
    } catch {}
    window.dispatchEvent(new CustomEvent('wizard-chess-freezone-ai-assist', {
      detail: aiAssistEnabled
    }));
  }, [aiAssistEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem('freezone-ai-bots-enabled', String(aiBotsEnabled));
    } catch {}
  }, [aiBotsEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem('freezone-ai-preferences', JSON.stringify({
        movementProvider: aiSettings.movementProvider,
        movementModel: aiSettings.movementModel,
        dialogueProvider: aiSettings.dialogueProvider,
        dialogueModel: aiSettings.dialogueModel,
        dialogueEnabled: aiSettings.dialogueEnabled,
        voiceProvider: aiSettings.voiceProvider,
        voiceModel: aiSettings.voiceModel
      }));
    } catch {}
  }, [aiSettings]);

  const updateAISettings = (change: Partial<ReturnType<typeof getFreezoneAISettings>>) => {
    const next = {
      ...aiSettings,
      ...change,
      apiKeys: { ...aiSettings.apiKeys, ...(change.apiKeys || {}) },
      serviceApiKeys: { ...aiSettings.serviceApiKeys, ...(change.serviceApiKeys || {}) }
    };
    setAISettings(next);
    updateFreezoneAISettings(next);
    const changed: FreezoneAIService[] = [];
    if ('movementProvider' in change || 'movementModel' in change ||
        change.serviceApiKeys?.movement !== undefined) changed.push('movement');
    if ('dialogueProvider' in change || 'dialogueModel' in change ||
        change.serviceApiKeys?.dialogue !== undefined) changed.push('dialogue');
    if ('voiceProvider' in change || 'voiceModel' in change ||
        change.serviceApiKeys?.speech !== undefined) changed.push('speech');
    if (changed.length) {
      setAIServiceStatuses((current) => ({
        ...current,
        ...Object.fromEntries(changed.map((service) => [
          service,
          { state: 'idle', message: 'Configuração alterada; teste novamente.' }
        ]))
      }));
    }
  };

  const clearAIKeys = () => {
    clearFreezoneAIKeys();
    const apiKeys = { openrouter: '', gemini: '', openai: '', deepseek: '', google: '' };
    const serviceApiKeys = { movement: '', dialogue: '', speech: '' };
    const next = { ...aiSettings, apiKeys, serviceApiKeys };
    setAISettings(next);
    updateFreezoneAISettings(next);
    setAIServiceStatuses({
      movement: { state: 'idle', message: 'Chaves limpas; teste novamente.' },
      dialogue: { state: 'idle', message: 'Chaves limpas; teste novamente.' },
      speech: { state: 'idle', message: 'Chaves limpas; teste novamente.' }
    });
    setAIVoiceStatus('API keys cleared from this session.');
  };

  const updateAIServiceKey = (service: FreezoneAIService, value: string) => {
    updateAISettings({
      serviceApiKeys: { ...aiSettings.serviceApiKeys, [service]: value }
    });
  };

  const updateAITextProvider = (
    service: 'movement' | 'dialogue',
    provider: FreezoneTextProvider
  ) => {
    updateAISettings(service === 'movement'
      ? { movementProvider: provider, movementModel: FREEZONE_TEXT_MODEL_DEFAULTS[provider] }
      : { dialogueProvider: provider, dialogueModel: FREEZONE_TEXT_MODEL_DEFAULTS[provider] });
  };

  const updateAISpeechProvider = (provider: FreezoneSpeechProvider) => {
    updateAISettings({
      voiceProvider: provider,
      voiceModel: FREEZONE_SPEECH_MODEL_DEFAULTS[provider]
    });
  };

  const testAIService = async (service: FreezoneAIService) => {
    const currentRoomCode = hud?.roomCode || roomCode;
    const playerToken = readLocalSetting('wizard_chess_token');
    if (!currentRoomCode || !playerToken) {
      setAIServiceStatuses((current) => ({
        ...current,
        [service]: { state: 'error', message: 'Entre em uma sala antes de testar a API.' }
      }));
      return;
    }

    const provider = service === 'movement' ? aiSettings.movementProvider
      : service === 'dialogue' ? aiSettings.dialogueProvider
        : aiSettings.voiceProvider;
    const model = service === 'movement' ? aiSettings.movementModel
      : service === 'dialogue' ? aiSettings.dialogueModel
        : aiSettings.voiceModel;
    const keyProvider: keyof typeof aiSettings.apiKeys = service === 'speech'
      ? provider === 'google-tts' ? 'google'
        : provider === 'openai-tts' ? 'openai' : 'gemini'
      : provider as FreezoneTextProvider;
    const apiKey = aiSettings.serviceApiKeys[service] || aiSettings.apiKeys[keyProvider] || '';
    setAIServiceStatuses((current) => ({
      ...current,
      [service]: {
        state: 'checking',
        message: service === 'movement' ? 'Executando jogada de teste…'
          : service === 'dialogue' ? 'Gerando texto de teste…'
            : 'Gerando e reproduzindo áudio…'
      }
    }));

    try {
      const request = { roomCode: currentRoomCode, playerToken, provider, model, apiKey };
      let successMessage = '';
      if (service === 'speech') {
        const audio = await testFreezoneSpeechService(request);
        if (aiVoiceUrlRef.current) URL.revokeObjectURL(aiVoiceUrlRef.current);
        aiVoiceUrlRef.current = URL.createObjectURL(audio);
        if (aiVoiceAudioRef.current) {
          aiVoiceAudioRef.current.src = aiVoiceUrlRef.current;
          aiVoiceAudioRef.current.load();
          try {
            await aiVoiceAudioRef.current.play();
            successMessage = 'Áudio de teste gerado e reproduzido.';
          } catch {
            successMessage = 'Áudio gerado; use “Play latest voice preview” para reproduzir.';
            setAIVoiceStatus(successMessage);
          }
        } else {
          successMessage = 'Áudio de teste gerado.';
        }
        setAIVoiceReady(true);
      } else if (service === 'dialogue') {
        const piece = hud?.ownedPieces[0];
        if (!piece) throw new Error('Nenhuma peça sua está disponível para o teste de texto.');
        const result = await testFreezoneAIService({ ...request, service, pieceId: piece.id });
        if (!result || typeof result.text !== 'string' || !result.text.trim()) {
          throw new Error('A API não retornou texto para exibir.');
        }
        const requestId = `text-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const displayResult = waitForFreezoneAITestResult(requestId, 5000);
        window.dispatchEvent(new CustomEvent('wizard-chess-freezone-ai-test-text', {
          detail: {
            requestId,
            pieceId: typeof result.pieceId === 'string' ? result.pieceId : piece.id,
            text: result.text
          }
        }));
        successMessage = (await displayResult).message;
      } else {
        const requestId = `move-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const movementResult = waitForFreezoneAITestResult(requestId, 90000);
        window.dispatchEvent(new CustomEvent('wizard-chess-freezone-ai-test', {
          detail: { requestId }
        }));
        successMessage = (await movementResult).message;
      }
      setAIServiceStatuses((current) => ({
        ...current,
        [service]: {
          state: 'ok',
          message: successMessage || `Teste concluído · ${model || provider}.`
        }
      }));
    } catch (error) {
      const message = service === 'speech' && error instanceof TypeError &&
          /failed to fetch/i.test(error.message)
        ? 'Voz indisponível: verifique se a função freezone-speech está publicada e se o CORS está ativo. Movimento e texto não são afetados.'
        : error instanceof Error ? error.message : 'Falha ao testar o serviço de IA.';
      setAIServiceStatuses((current) => ({
        ...current,
        [service]: {
          state: 'error',
          message: (apiKey ? message.replace(apiKey, '[chave ocultada]') : message).slice(0, 180)
        }
      }));
    }
  };

  const renderAIServiceStatus = (service: FreezoneAIService) => {
    const result = aiServiceStatuses[service] || {
      state: 'idle' as const,
      message: 'Ainda não testada.'
    };
    const label = result.state === 'checking' ? 'Testando'
      : result.state === 'ok' ? 'Conectada'
        : result.state === 'error' ? 'Erro'
          : 'Não testada';
    return (
      <div
        className={`freezone-ai-status is-${result.state}`}
        role="status"
        aria-live="polite"
      >
        <span className="freezone-ai-status-label">
          <i aria-hidden="true" />
          {label}
        </span>
        <span className="freezone-ai-status-message">{result.message}</span>
      </div>
    );
  };

  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined;
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoices);
  }, []);

  useEffect(() => {
    const speak = (pieceId: string, eventKey: VoiceEventKey, lines: PieceVoiceLines) => {
      if (!('speechSynthesis' in window)) return;
      const line = lines?.[eventKey];
      const voice = resolveFreezoneVoice(voices, selectedVoiceURI);
      const available = selectedVoiceURI ? Boolean(voice) : voices.length > 0;
      if (!shouldSpeakFreezoneVoice(voiceEnabled, line, available)) return;
      const cooldownKey = `${pieceId}:${eventKey}`;
      const now = Date.now();
      const cooldown = eventKey === 'inspection' ? 12000 : 30000;
      if (now - (voiceCooldowns.current.get(cooldownKey) || 0) < cooldown) return;
      voiceCooldowns.current.set(cooldownKey, now);
      const utterance = new SpeechSynthesisUtterance(line.trim().slice(0, 120));
      utterance.voice = voice || voices[0] || null;
      window.speechSynthesis.speak(utterance);
    };
    const reportAIVoiceStatus = (message: string) => {
      setAIVoiceStatus(message);
      window.dispatchEvent(new CustomEvent('wizard-chess-freezone-notice', {
        detail: message
      }));
    };
    const queueGeneratedVoice = (detail: {
      roomCode?: string;
      dialogueId?: string;
      pieceId: string;
      event?: VoiceEventKey;
      text: string;
      voiceId?: string;
    }) => {
      if (!detail.roomCode ||
          !shouldRequestFreezoneAIVoice(
            aiVoiceEnabled, detail.text, detail.voiceId, aiSettings.voiceProvider
          )) return;
      const cooldownKey = `ai:${detail.dialogueId || detail.event || 'line'}:${detail.pieceId}`;
      const now = Date.now();
      if (now - (voiceCooldowns.current.get(cooldownKey) || 0) < 30000) return;
      voiceCooldowns.current.set(cooldownKey, now);
      if (voiceCooldowns.current.size > 512) {
        const oldestKey = voiceCooldowns.current.keys().next().value;
        if (oldestKey) voiceCooldowns.current.delete(oldestKey);
      }
      aiVoiceQueueRef.current = aiVoiceQueueRef.current.then(async () => {
        if (!aiVoiceEnabledRef.current) return;
        const playerToken = readLocalSetting('wizard_chess_token');
        if (!playerToken) {
          reportAIVoiceStatus('Join the Freezone room before requesting character voice.');
          return;
        }
        try {
          const blob = await requestFreezoneSpeech({
            roomCode: detail.roomCode,
            playerToken,
            dialogueId: detail.dialogueId,
            pieceId: detail.pieceId,
            event: detail.event,
            text: detail.text
          });
          if (!aiVoiceEnabledRef.current) return;
          if (aiVoiceUrlRef.current) URL.revokeObjectURL(aiVoiceUrlRef.current);
          const url = URL.createObjectURL(blob);
          aiVoiceUrlRef.current = url;
          setAIVoiceReady(true);
          setAIVoiceStatus('Character voice is ready.');
          const audio = aiVoiceAudioRef.current;
          if (audio) {
            audio.src = url;
            audio.load();
            try {
              await audio.play();
            } catch {
              reportAIVoiceStatus('Autoplay was blocked. Use “Play latest voice” to listen.');
            }
          }
        } catch (error) {
          const message = error instanceof TypeError && /failed to fetch/i.test(error.message)
            ? 'Generated voice is unavailable: the freezone-speech function has a deployment or CORS problem. AI movement and text are unaffected.'
            : error instanceof Error ? error.message : 'Character voice could not be generated.';
          reportAIVoiceStatus(message);
        }
      }).catch((error: unknown) => {
        const message = error instanceof TypeError && /failed to fetch/i.test(error.message)
          ? 'Generated voice is unavailable: the freezone-speech function has a deployment or CORS problem. AI movement and text are unaffected.'
          : error instanceof Error ? error.message : 'Character voice could not be generated.';
        reportAIVoiceStatus(message);
      });
    };
    const handleVoice = (event: Event) => {
      const detail = (event as CustomEvent<{
        roomCode?: string;
        pieceId: string;
        event: VoiceEventKey;
        text?: string;
        voiceId?: string;
        voiceLines: PieceVoiceLines;
      }>).detail;
      if (!detail) return;
      if (!aiVoiceEnabled) speak(detail.pieceId, detail.event, detail.voiceLines);
      if (detail.text) {
        queueGeneratedVoice({
          roomCode: detail.roomCode,
          pieceId: detail.pieceId,
          event: detail.event,
          text: detail.text,
          voiceId: detail.voiceId
        });
      }
    };
    const handleInspect = (event: Event) => {
      const detail = (event as CustomEvent<FreezoneInspectedPiece | null>).detail;
      setInspectedPiece(detail);
    };
    const handleSpeech = (event: Event) => {
      const detail = (event as CustomEvent<FreezoneSpeechBubble | null>).detail;
      setSpeechBubble(detail);
    };
    const handleAIVoice = (event: Event) => {
      const detail = (event as CustomEvent<{
        roomCode: string;
        dialogueId: string;
        pieceId: string;
        text: string;
        voiceId: string;
      } | null>).detail;
      if (detail) queueGeneratedVoice(detail);
    };
    window.addEventListener('wizard-chess-freezone-voice', handleVoice);
    window.addEventListener('wizard-chess-freezone-inspect', handleInspect);
    window.addEventListener('wizard-chess-freezone-speech', handleSpeech);
    window.addEventListener('wizard-chess-freezone-ai-voice', handleAIVoice);
    return () => {
      window.removeEventListener('wizard-chess-freezone-voice', handleVoice);
      window.removeEventListener('wizard-chess-freezone-inspect', handleInspect);
      window.removeEventListener('wizard-chess-freezone-speech', handleSpeech);
      window.removeEventListener('wizard-chess-freezone-ai-voice', handleAIVoice);
    };
  }, [aiSettings.voiceProvider, aiVoiceEnabled, selectedVoiceURI, voiceEnabled, voices]);

  useEffect(() => {
    aiVoiceEnabledRef.current = aiVoiceEnabled;
    if (!aiVoiceEnabled) aiVoiceAudioRef.current?.pause();
  }, [aiVoiceEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem('freezone-voice-enabled', String(voiceEnabled));
      window.localStorage.setItem('freezone-ai-voice-enabled', String(aiVoiceEnabled));
      window.localStorage.setItem('freezone-voice-uri', selectedVoiceURI);
      window.localStorage.setItem('freezone-music-url', /^https?:\/\//i.test(musicSource) ? musicSource : '');
      window.localStorage.setItem('freezone-music-volume', String(musicVolume));
    } catch {
      setStatus('Browser storage is unavailable; audio preferences will last only for this visit.');
    }
  }, [aiVoiceEnabled, musicSource, musicVolume, selectedVoiceURI, voiceEnabled]);

  useEffect(() => {
    const audio = musicRef.current;
    if (!audio) return;
    audio.pause();
    audio.volume = musicVolume;
    setMusicPlaying(false);
    if (musicSource) {
      audio.src = musicSource;
      audio.load();
    } else {
      audio.removeAttribute('src');
      audio.load();
    }
  }, [musicSource]);

  useEffect(() => {
    const audio = musicRef.current;
    if (!audio || !hud?.sharedMusicUrl || musicSource !== hud.sharedMusicUrl) return;
    if (!sharedMusicPlaying) {
      audio.pause();
      return;
    }
    const seekToSharedPosition = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0 ||
          !Number.isSafeInteger(hud.sharedMusicStartedAt)) return;
      const elapsed = Math.max(0, (Date.now() - hud.sharedMusicStartedAt) / 1000);
      audio.currentTime = elapsed % audio.duration;
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekToSharedPosition();
    } else {
      audio.addEventListener('loadedmetadata', seekToSharedPosition, { once: true });
    }
    if (!audio.paused) return;
    void audio.play().catch((error: unknown) => {
      setMusicPlaying(false);
      setStatus(getFreezoneAudioPlaybackError(error));
    });
  }, [hud?.sharedMusicStartedAt, hud?.sharedMusicUrl, musicSource, sharedMusicPlaying]);

  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = musicVolume;
  }, [musicVolume]);

  useEffect(() => {
    if (!voiceEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [voiceEnabled]);

  useEffect(() => () => {
    musicRef.current?.pause();
    aiVoiceAudioRef.current?.pause();
    if (localMusicUrl.current) URL.revokeObjectURL(localMusicUrl.current);
    if (aiVoiceUrlRef.current) URL.revokeObjectURL(aiVoiceUrlRef.current);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    const handleFreezoneState = (event: Event) => {
      const detail = (event as CustomEvent<FreezoneHud>).detail;
      const enabled = detail?.enabled === true;
      const wasEnabled = activeFreezoneHudRef.current;
      activeFreezoneHudRef.current = enabled;
      setHud(enabled ? detail : null);
      if (enabled !== wasEnabled) setOpen(false);
      if (typeof detail?.aiBotsEnabled === 'boolean') {
        setAIBotsEnabled(detail.aiBotsEnabled);
      }
      if (detail?.roomCode) setRoomCode(detail.roomCode);
      if (detail?.sharedMusicUrl !== undefined) setMusicUrl(detail.sharedMusicUrl);
      if (detail?.sharedMusicPlaying !== undefined) {
        setSharedMusicPlaying(detail.sharedMusicPlaying);
      }
    };
    const handleOpenArena = () => {
      setStatus('');
      setOpen(true);
    };
    const handleNotice = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (!message) return;
      setNotice(message);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(''), 3500);
    };
    const handleFeedback = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (!message) return;
      setFeedback(message);
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = window.setTimeout(() => setFeedback(''), 2500);
    };
    const handleSharedMusic = (event: Event) => {
      const detail = (event as CustomEvent<string | {
        url?: string;
        playing?: boolean;
      }>).detail;
      const url = typeof detail === 'string' ? detail : detail?.url || '';
      setMusicUrl(url);
      setMusicSource(url);
      setSharedMusicPlaying(typeof detail === 'object' && detail?.playing === true);
    };
    window.addEventListener('wizard-chess-freezone-state', handleFreezoneState);
    window.addEventListener('wizard-chess-open-freezone', handleOpenArena);
    window.addEventListener('wizard-chess-freezone-notice', handleNotice);
    window.addEventListener('wizard-chess-freezone-feedback', handleFeedback);
    window.addEventListener('wizard-chess-freezone-music', handleSharedMusic);
    return () => {
      window.removeEventListener('wizard-chess-freezone-state', handleFreezoneState);
      window.removeEventListener('wizard-chess-open-freezone', handleOpenArena);
      window.removeEventListener('wizard-chess-freezone-notice', handleNotice);
      window.removeEventListener('wizard-chess-freezone-feedback', handleFeedback);
      window.removeEventListener('wizard-chess-freezone-music', handleSharedMusic);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open || hud) return;
    let active = true;
    let refreshing = false;
    let mainRoomEnsured = false;
    const refreshRooms = async (ensureMain = false) => {
      if (refreshing) return;
      refreshing = true;
      const api = window.wizardChess;
      if (!api?.listFreezoneRooms) {
        if (active) {
          setStatus('Freezone is still starting. Try again in a moment.');
          if (ensureMain) setRoomsLoading(false);
        }
        refreshing = false;
        return;
      }
      try {
        if (!mainRoomEnsured && api.ensureFreezoneMainRoom) {
          await api.ensureFreezoneMainRoom();
          mainRoomEnsured = true;
        }
        const nextRooms = await api.listFreezoneRooms();
        if (active) {
          setRooms(nextRooms);
          setStatus((current) =>
            current === 'Freezone is still starting. Try again in a moment.' ? '' : current
          );
        }
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : 'Could not load Freezone rooms.');
      } finally {
        if (active && ensureMain) setRoomsLoading(false);
        refreshing = false;
      }
    };
    const handleApiReady = () => void refreshRooms(true);
    window.addEventListener('wizard-chess-api-ready', handleApiReady);
    setRoomsLoading(true);
    void refreshRooms(true);
    const timer = window.setInterval(() => void refreshRooms(), 8000);
    return () => {
      active = false;
      window.removeEventListener('wizard-chess-api-ready', handleApiReady);
      window.clearInterval(timer);
    };
  }, [open, hud]);

  useEffect(() => {
    if (!hud?.enabled) return;
    const timer = window.setInterval(() => {
      setHud((current) => current
        ? {
          ...current,
          cooldownMs: Math.max(0, current.cooldownMs - 250),
          movesUsed: current.cooldownMs <= 250 ? 0 : current.movesUsed,
          mutantZone: current.mutantZone
            ? {
              ...current.mutantZone,
              remainingMs: Math.max(0, current.mutantZone.remainingMs - 250)
            }
            : null
        }
        : current);
    }, 250);
    return () => window.clearInterval(timer);
  }, [hud?.enabled]);

  useEffect(() => {
    if (!hud) return;
    const choices = FREEZONE_ENVELOPE_OPTIONS.filter((option) =>
      canUpgradeFreezoneEnvelope(hud.envelopeRows, hud.envelopeCols, option.rows, option.cols)
    );
    setTargetEnvelope((current) =>
      choices.some((option) => option.rows === current.rows && option.cols === current.cols)
        ? current
        : choices[0] || current
    );
  }, [hud?.envelopeRows, hud?.envelopeCols]);

  useEffect(() => {
    if (!hud) return;
    const piece = hud.ownedPieces.find((owned) => owned.id === selectedMovementPieceId) ||
      hud.ownedPieces[0];
    const maxRows = Math.min(hud.envelopeRows, piece?.movementLimit.rows || hud.envelopeRows);
    const maxCols = Math.min(hud.envelopeCols, piece?.movementLimit.cols || hud.envelopeCols);
    const scopes = FREEZONE_ENVELOPE_OPTIONS.filter((option) =>
      option.rows <= maxRows && option.cols <= maxCols
    );
    setTargetMovementScope((current) =>
      scopes.some((option) => option.rows === current.rows && option.cols === current.cols)
        ? current
        : scopes[scopes.length - 1] || { rows: 1, cols: 1 }
    );
    setSelectedMovementPieceId((current) =>
      hud.ownedPieces.some((piece) => piece.id === current)
        ? current
        : hud.ownedPieces[0]?.id || ''
    );
  }, [hud?.envelopeRows, hud?.envelopeCols, hud?.ownedPieces, selectedMovementPieceId]);

  const createArena = async () => {
    const action = window.wizardChess?.createFreezoneRoom;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    setBusy(true);
    setStatus('Creating a Freezone arena...');
    try {
      const result = await action();
      if (!result.ok) {
        setStatus(result.error || 'Could not create a Freezone arena.');
        return;
      }
      if (result.code) setRoomCode(result.code);
      setStatus(result.code ? `Arena ${result.code} is ready.` : 'Freezone arena ready.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create a Freezone arena.');
    } finally {
      setBusy(false);
    }
  };

  const joinArena = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await joinArenaCode(joinCode);
  };

  const joinArenaCode = async (input: string) => {
    const action = window.wizardChess?.joinFreezoneRoom;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    const code = input.trim().toUpperCase();
    setBusy(true);
    setStatus(`Joining arena ${code}...`);
    try {
      const result = await action(code);
      if (!result.ok) {
        setStatus(result.error || 'Could not join this Freezone arena.');
        return;
      }
      if (result.code) setRoomCode(result.code);
      setStatus(`Joined Freezone arena ${result.code || code}.`);
      setRooms([]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not join this Freezone arena.');
    } finally {
      setBusy(false);
    }
  };

  const acquirePiece = async (pattern: FreezonePatternInput, replacementId = '') => {
    const action = window.wizardChess?.buyFreezonePiece;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    if (hud && hud.pieces >= hud.capacity && !replacementId) {
      setPendingReplacement(pattern);
      setStatus(`Army full. Choose a piece to replace; this costs ${hud.xpCost} XP.`);
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(pattern, replacementId);
      if (result.ok) {
        setPendingReplacement(null);
        setStatus(replacementId
          ? `${pattern.name} acquired; the selected piece was replaced.`
          : `${pattern.name} acquired. It has joined your army.`);
        emitTeamVoiceEvent('purchase');
      } else {
        setStatus(result.error || 'Could not acquire this piece.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not acquire this piece.');
    } finally {
      setPurchaseBusy(false);
    }
  };

  const emitTeamVoiceEvent = (eventKey: 'purchase' | 'upgrade') => {
    const speaker = hud?.ownedPieces.find((piece) => piece.voiceLines?.[eventKey]);
    const text = speaker?.voiceLines?.[eventKey];
    if (!speaker || !text) return;
    window.dispatchEvent(new CustomEvent('wizard-chess-freezone-voice', {
      detail: {
        roomCode: hud?.roomCode || roomCode,
        pieceId: speaker.id,
        event: eventKey,
        text,
        voiceId: speaker.aiVoice,
        voiceLines: speaker.voiceLines
      }
    }));
  };

  const configuredPattern = (pattern: FreezonePatternInput): FreezonePatternInput => ({
    ...pattern,
    appearance,
    name: pieceName.trim() || pattern.name,
    title: pieceTitle.trim() || pattern.title,
    description: pieceDescription.trim() || pattern.description,
    personality: piecePersonality.trim() || pattern.personality,
    language: pieceLanguage || pattern.language,
    aiVoice: pieceAIVoice || pattern.aiVoice,
    catchphrase: pieceCatchphrase.trim() || pattern.catchphrase,
    voiceLines
  });

  const loadMusicUrl = async () => {
    const validation = validateFreezoneAudioUrl(musicUrl);
    if (!validation.ok) {
      setStatus(validation.error || 'Enter a valid direct audio URL.');
      return;
    }
    const action = window.wizardChess?.setFreezoneSharedMusicUrl;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    const sharedUrl = validation.url || '';
    try {
      const result = await action(sharedUrl);
      if (!result.ok) {
        setStatus(result.error || 'Could not share this music URL with the room.');
        return;
      }
      if (localMusicUrl.current) {
        URL.revokeObjectURL(localMusicUrl.current);
        localMusicUrl.current = '';
      }
      setMusicUrl(sharedUrl);
      setMusicSource(sharedUrl);
      setStatus('Audio URL shared. Use “Play for room” to synchronize playback.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not share this music URL with the room.');
    }
  };

  const clearSharedMusic = async () => {
    const action = window.wizardChess?.setFreezoneSharedMusicUrl;
    if (!action) return setStatus('Freezone is still starting. Try again in a moment.');
    try {
      const result = await action('');
      if (!result.ok) {
        setStatus(result.error || 'Could not clear the shared music URL.');
        return;
      }
      setStatus('Shared audio URL cleared.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not clear the shared music URL.');
    }
  };

  const loadMusicFile = (file?: File) => {
    if (!file) return;
    const validation = validateFreezoneAudioFile(file);
    if (!validation.ok) {
      setStatus(validation.error || 'Choose a valid MP3 audio file no larger than 20 MB.');
      return;
    }
    if (localMusicUrl.current) URL.revokeObjectURL(localMusicUrl.current);
    localMusicUrl.current = URL.createObjectURL(file);
    setMusicUrl('');
    setMusicSource(localMusicUrl.current);
    setStatus('Local MP3 loaded. It is available only on this device and is not shared.');
  };

  const toggleMusic = async (source = musicSource) => {
    const audio = musicRef.current;
    if (!audio || !source) {
      setStatus('Choose a local MP3 or load a direct audio URL first.');
      return;
    }
    const localOnly = Boolean(localMusicUrl.current) && source === localMusicUrl.current;
    if (hud?.sharedMusicUrl && !localOnly) {
      const action = window.wizardChess?.setFreezoneSharedMusicPlaying;
      if (!action) {
        setStatus('Freezone is still starting. Try again in a moment.');
        return;
      }
      if (sharedMusicPlaying && audio.paused) {
        try {
          await audio.play();
        } catch (error) {
          setStatus(getFreezoneAudioPlaybackError(error));
        }
        return;
      }
      const nextPlaying = !sharedMusicPlaying;
      setMusicBusy(true);
      try {
        if (nextPlaying && audio.src !== source) {
          audio.src = source;
          audio.load();
        }
        if (nextPlaying) {
          try {
            await audio.play();
          } catch (error) {
            setMusicPlaying(false);
            setStatus(getFreezoneAudioPlaybackError(error));
            return;
          }
        }
        const result = await action(nextPlaying);
        if (!result.ok) {
          if (nextPlaying) audio.pause();
          setStatus(result.error || 'Could not change shared music playback.');
          return;
        }
        if (!nextPlaying) audio.pause();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not change shared music playback.');
      } finally {
        setMusicBusy(false);
      }
      return;
    }
    if (!audio.paused) {
      audio.pause();
      setMusicPlaying(false);
      return;
    }
    try {
      await audio.play();
      setMusicPlaying(true);
    } catch (error) {
      setMusicPlaying(false);
      setStatus(getFreezoneAudioPlaybackError(error));
    }
  };

  const toggleBots = async (enabled: boolean) => {
    const action = window.wizardChess?.setFreezoneBotsEnabled;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    setBotsBusy(true);
    try {
      const result = await action(enabled);
      if (!result.ok) setStatus(result.error || 'Could not change adversary bots.');
      else setStatus(enabled ? 'Adversary bots joined available seats.' : 'Adversary bots removed.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not change adversary bots.');
    } finally {
      setBotsBusy(false);
    }
  };

  const recruitAlly = async () => {
    const action = window.wizardChess?.buyFreezoneAlly;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(allyRole, allyNameDraft);
      setStatus(result.ok
        ? `${FREEZONE_ALLY_LABELS[allyRole]} joined your team.`
        : result.error || 'Could not recruit an allied bot.');
      if (result.ok) {
        setAllyNameDraft('');
        setActiveShopTab('bots');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not recruit an allied bot.');
    } finally {
      setPurchaseBusy(false);
    }
  };

  const buyOrb = async (type: FreezonePurchaseOrb) => {
    const action = window.wizardChess?.buyFreezoneOrb;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(type);
      setStatus(result.ok ? `${type} orb purchased.` : result.error || 'Could not buy this orb.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not buy this orb.');
    } finally {
      setPurchaseBusy(false);
    }
  };

  const selectPieceForEditing = (pieceId: string) => {
    const fullPiece = hud?.teamPieces.find((current) => current.id === pieceId);
    if (!fullPiece) return;
    const profile = hud?.publicPieces.find((current) => current.id === pieceId) ||
      hud?.ownedPieces.find((current) => current.id === pieceId);
    if (!profile) return;
    setEditingPieceId(fullPiece.id);
    setPieceName(profile.name);
    setPieceTitle(profile.title);
    setPieceDescription(profile.description);
    setPiecePersonality(profile.personality);
    setPieceLanguage(profile.language);
    setPieceAIVoice(profile.aiVoice);
    setPieceCatchphrase(profile.catchphrase);
    setAppearance(profile.appearance || FREEZONE_APPEARANCES[0].id);
    setVoiceLines(profile.voiceLines);
  };

  const saveEditedPiece = async () => {
    const action = window.wizardChess?.updateFreezonePieceProfile;
    if (!action || !editingPieceId) {
      setStatus('Choose one of your units to edit first.');
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(editingPieceId, {
        name: pieceName,
        title: pieceTitle,
        description: pieceDescription,
        personality: piecePersonality,
        language: pieceLanguage,
        aiVoice: pieceAIVoice,
        catchphrase: pieceCatchphrase,
        appearance,
        voiceLines
      });
      setStatus(result.ok
        ? 'Unit profile updated without a purchase.'
        : result.error || 'Could not save this unit profile.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save this unit profile.');
    } finally {
      setPurchaseBusy(false);
    }
  };

  const previewPieceVoice = () => {
    if (!('speechSynthesis' in window)) {
      setStatus('Speech preview is not supported in this browser.');
      return;
    }
    const text = pieceCatchphrase.trim() || voiceLines.move.trim() || voiceLines.entry.trim();
    if (!text) {
      setStatus('Add a public phrase or voice line before previewing.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 120));
    utterance.lang = pieceLanguage;
    utterance.voice = resolveFreezoneVoice(voices, selectedVoiceURI) || null;
    window.speechSynthesis.speak(utterance);
    setStatus('Playing a local voice preview on this device only.');
  };

  const purchaseUpgrade = async (type: FreezoneUpgrade) => {
    const action = window.wizardChess?.upgradeFreezoneSkill;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(type);
      setStatus(result.ok
        ? `${FREEZONE_UPGRADES.find((upgrade) => upgrade.type === type)?.label} upgraded.`
        : result.error || 'Could not purchase this upgrade.');
      if (result.ok) emitTeamVoiceEvent('upgrade');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not purchase this upgrade.');
    } finally {
      setPurchaseBusy(false);
    }
  };

  const toggleMove = (row: number, col: number) => {
    const exists = selectedMoves.some(([r, c]) => r === row && c === col);
    const isJump = selectedJumps.some(([r, c]) => r === row && c === col);
    const isTeleport = selectedTeleports.some(([r, c]) => r === row && c === col);
    if (!exists) {
      if (selectedMoves.length >= (hud?.maxPatternOffsets || 48)) {
        setStatus(`A pattern can have at most ${hud?.maxPatternOffsets || 48} offsets.`);
        return;
      }
      setSelectedMoves((current) => [...current, [row, col]]);
      if (row === 0 && col === 0) setSelectedTeleports((current) => [...current, [row, col]]);
      return;
    }
    if (!isJump && !isTeleport) {
      setSelectedJumps((current) => [...current, [row, col]]);
      return;
    }
    if (isJump) {
      setSelectedJumps((current) => current.filter(([r, c]) => r !== row || c !== col));
      setSelectedTeleports((current) => [...current, [row, col]]);
      return;
    }
    setSelectedMoves((current) => current.filter(([r, c]) => r !== row || c !== col));
    setSelectedTeleports((current) => current.filter(([r, c]) => r !== row || c !== col));
  };

  const copyRoomCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setStatus('Arena code copied.');
    } catch {
      setStatus('Could not access the clipboard. Select and copy the arena code.');
    }
  };

  const canAcquire = Boolean(hud?.isPlayer && hud.xp >= hud.xpCost);
  const previewName = pieceName.trim() || `Custom ${pieceType}`;
  const editorRows = (hud?.envelopeRows || 2) * 2 + 1;
  const editorCols = (hud?.envelopeCols || 2) * 2 + 1;
  const upgradeableEnvelopes = hud
    ? FREEZONE_ENVELOPE_OPTIONS.filter((option) =>
      canUpgradeFreezoneEnvelope(
        hud.envelopeRows, hud.envelopeCols, option.rows, option.cols
      )
    )
    : [];
  const effectiveTargetEnvelope = upgradeableEnvelopes.some((option) =>
    option.rows === targetEnvelope.rows && option.cols === targetEnvelope.cols
  ) ? targetEnvelope : upgradeableEnvelopes[0] || targetEnvelope;
  const targetEnvelopeCost = hud
    ? getFreezoneEnvelopeUpgradeCost(
      hud.envelopeRows,
      hud.envelopeCols,
      effectiveTargetEnvelope.rows,
      effectiveTargetEnvelope.cols
    )
    : FREEZONE_ENVELOPE_ORB_COST;
  const selectedMovementPiece = hud?.ownedPieces.find(
    (piece) => piece.id === selectedMovementPieceId
  );
  const movementScopes = hud
    ? FREEZONE_ENVELOPE_OPTIONS.filter((option) =>
      option.rows <= Math.min(hud.envelopeRows, selectedMovementPiece?.movementLimit.rows || hud.envelopeRows) &&
      option.cols <= Math.min(hud.envelopeCols, selectedMovementPiece?.movementLimit.cols || hud.envelopeCols)
    )
    : [];
  const effectiveMovementScope = movementScopes.some((option) =>
    option.rows === targetMovementScope.rows && option.cols === targetMovementScope.cols
  ) ? targetMovementScope : movementScopes[0] || targetMovementScope;
  const movementGridRows = effectiveMovementScope.rows * 2 + 1;
  const movementGridCols = effectiveMovementScope.cols * 2 + 1;
  const movementOffsetCount = selectedMovementPiece?.unlockedMoves.length || 0;
  const movementOffsetKeys = new Set(
    selectedMovementPiece?.moves.map(([row, col]) => `${row},${col}`) || []
  );
  const movementExtraKeys = new Set(
    selectedMovementPiece?.unlockedMoves.map(([row, col]) => `${row},${col}`) || []
  );
  const purchaseEnvelopeUpgrade = async () => {
    const action = window.wizardChess?.upgradeFreezoneEnvelope;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(effectiveTargetEnvelope.rows, effectiveTargetEnvelope.cols);
      setStatus(result.ok
        ? `Movement envelope upgraded to ${effectiveTargetEnvelope.rows}×${effectiveTargetEnvelope.cols}.`
        : result.error || 'Could not upgrade the movement envelope.');
      if (result.ok) emitTeamVoiceEvent('upgrade');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not upgrade the movement envelope.');
    } finally {
      setPurchaseBusy(false);
    }
  };
  const purchaseMovementOffset = async (row: number, col: number) => {
    const action = window.wizardChess?.unlockFreezoneMovement;
    if (!action || !selectedMovementPiece) {
      setStatus('Choose one of your pieces first.');
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(
        selectedMovementPiece.id,
        row,
        col,
        movementKind,
        effectiveMovementScope.rows,
        effectiveMovementScope.cols,
        targetMovementA
      );
      setStatus(result.ok
        ? `${movementKind} offset ${row}, ${col} ${result.addedOffset ? 'unlocked' : 'updated'} for ${selectedMovementPiece.name}.`
        : result.error || 'Could not unlock this movement offset.');
      if (result.ok) emitTeamVoiceEvent('upgrade');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not unlock this movement offset.');
    } finally {
      setPurchaseBusy(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateCompactLeaderboard = () => {
      setCompactLeaderboard(shouldUseCompactFreezoneLeaderboard(window.innerWidth));
    };
    updateCompactLeaderboard();
    window.addEventListener('resize', updateCompactLeaderboard);
    return () => window.removeEventListener('resize', updateCompactLeaderboard);
  }, []);

  useEffect(() => {
    if (!hud?.enabled) return undefined;
    const timer = window.setInterval(() => setCooldownNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [hud?.enabled]);

  const roomLeaderboard: FreezoneRoomRankingEntry[] = hud?.roomLeaderboard?.length
    ? hud.roomLeaderboard
    : (hud?.onlinePlayers || []).map((player, index) => ({
      ...player,
      position: index + 1,
      leader: index === 0,
      crown: index === 0
    }));

  return (
    <>
      {!mainMenuOpen && hud?.enabled ? (
        <>
          <aside
            className={`freezone-room-ranking ${compactLeaderboard ? 'compact' : ''} ${rankingCollapsed ? 'collapsed' : ''}`}
            aria-label="Freezone room ranking"
          >
            <div className="freezone-room-ranking-header">
              <strong>Room rank</strong>
              {compactLeaderboard && (
                <button
                  type="button"
                  className="freezone-room-ranking-toggle"
                  onClick={() => setRankingCollapsed((value) => !value)}
                >
                  {rankingCollapsed ? 'Expand' : 'Collapse'}
                </button>
              )}
            </div>
            {!rankingCollapsed && (
              <div className="freezone-room-ranking-list">
                {roomLeaderboard.length ? roomLeaderboard.map((player) => (
                  <div
                    key={player.side}
                    className={`freezone-room-ranking-row ${player.leader ? 'leader' : ''}`}
                  >
                    <span className="freezone-room-ranking-position">{player.position || 1}</span>
                    <span className="freezone-room-ranking-name">
                      {player.leader ? '👑 ' : ''}{player.name}
                    </span>
                    <span className="freezone-room-ranking-metric">K {player.kills ?? 0}</span>
                    <span className="freezone-room-ranking-metric">XP {player.xp ?? 0}</span>
                    <span className="freezone-room-ranking-metric">Orb {player.orbsCollected ?? 0}</span>
                    <span className="freezone-room-ranking-metric">Pieces {player.pieces ?? 0}</span>
                    <span className="freezone-room-ranking-time">
                      {player.timeLabel || formatFreezoneSessionAge(player.sessionStartedAt || Date.now())}
                    </span>
                  </div>
                )) : (
                  <div className="freezone-room-empty">No players online.</div>
                )}
              </div>
            )}
          </aside>
          <aside className="freezone-piece-cooldowns" aria-label="Your pieces and cooldown energy">
            <strong>My pieces</strong>
            {hud.teamPieces.length ? hud.teamPieces.map((piece) => {
              const remaining = Math.max(0, piece.readyAt - cooldownNow);
              const duration = Math.max(1, piece.cooldownDurationMs);
              const energy = Math.max(0, Math.min(100, 100 * (1 - remaining / duration)));
              const icon = {
                pawn: '♟',
                knight: '♞',
                bishop: '♝',
                rook: '♜',
                queen: '♛',
                king: '♚'
              }[piece.type] || '♟';
              return (
                <div className="freezone-piece-cooldown" key={piece.id}>
                  <span className="freezone-piece-cooldown-name" title={piece.name}>
                    <i aria-hidden="true">{icon}</i>{piece.name}
                    {piece.ally ? <small>Bot</small> : null}
                  </span>
                  <span
                    className="freezone-energy-track"
                    role="progressbar"
                    aria-label={`${piece.name} cooldown energy`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(energy)}
                  >
                    <i style={{ width: `${energy}%` }} />
                  </span>
                  <small>{remaining ? `${(remaining / 1000).toFixed(1)}s` : 'Ready'}</small>
                </div>
              );
            }) : <span className="freezone-piece-cooldown-empty">No pieces</span>}
          </aside>
          <div className="freezone-hud" aria-live="polite">
          <span className="freezone-hud-stats">
            XP {hud.xp} · Army {hud.pieces}/{hud.capacity} ·
            🔴 {hud.orbBalances.red} · 🔵 {hud.orbBalances.blue} ·
            🟡 {hud.orbBalances.yellow} · ⚪ {hud.orbBalances.white} ·
            🟣 {hud.orbBalances.purple} · 🟠 {hud.orbBalances.movement} ·
            🟢 {hud.orbBalances.bot} · Bots {hud.allies.length}
          </span>
          <span className="freezone-hud-player">
            {hud.playerName}{hud.selectedPieceName ? ` · Selected: ${hud.selectedPieceName}` : ''}
          </span>
          <div className="freezone-online-roster" aria-label="Players currently online">
            <strong>Online {hud.onlinePlayers.length} · Max {hud.maxPlayers}</strong>
            {hud.onlinePlayers.map((player) => (
              <span key={player.side}>
                {player.name} · Team {player.side + 1}{player.bot ? ' · Bot' : ''} · Online · {player.playing ? 'Playing' : 'Not playing'}
              </span>
            ))}
            {hud.alliedBots.map((ally) => (
              <span key={ally.id}>
                {ally.name} · Team {ally.side + 1} · Allied bot · {FREEZONE_ALLY_LABELS[ally.role]} · {ally.playing ? 'Playing' : 'Not playing'}
              </span>
            ))}
          </div>
          {roomCode && hud.isPlayer && (
            <label className="freezone-hud-bots">
              <input
                type="checkbox"
                role="switch"
                checked={hud.botsEnabled}
                disabled={botsBusy}
                onChange={(event) => void toggleBots(event.target.checked)}
              />
              <span>Adversary bots · {hud.onlinePlayers.filter((player) => player.bot).length}/2</span>
            </label>
          )}
          <button
            type="button"
            className={`hud-btn freezone-radio-toggle ${sharedMusicPlaying ? 'playing' : ''}`}
            aria-label="Configure shared Freezone radio"
            aria-expanded={radioOpen}
            onClick={() => {
              setStatus('');
              setRadioOpen((value) => !value);
            }}
          >
            ♫ {sharedMusicPlaying ? 'On' : 'Radio'}
          </button>
          {radioOpen && (
            <div className="freezone-radio-popover" role="group" aria-label="Shared room radio">
              <label>
                Shared radio / audio URL
                <input
                  value={musicUrl}
                  maxLength={2048}
                  placeholder="https://example.com/radio.mp3"
                  onChange={(event) => setMusicUrl(event.target.value)}
                />
              </label>
              <div>
                <button type="button" onClick={() => void loadMusicUrl()}>Share URL</button>
                {hud.sharedMusicUrl && (
                  <button type="button" onClick={() => void clearSharedMusic()}>Clear</button>
                )}
                <button
                  type="button"
                  disabled={!hud.sharedMusicUrl || musicBusy}
                  onClick={() => void toggleMusic(hud.sharedMusicUrl)}
                >
                  {sharedMusicPlaying
                    ? musicPlaying ? 'Pause for room' : 'Enable audio here'
                    : 'Play for room'}
                </button>
              </div>
              <p>{hud.sharedMusicUrl
                ? sharedMusicPlaying
                  ? 'Room playback is on. A player may need to enable audio on their device.'
                  : 'Room playback is paused.'
                : 'No shared radio URL is configured.'}</p>
              {status && <p role="status" aria-live="polite">{status}</p>}
            </div>
          )}
          <button
            type="button"
            className="hud-btn freezone-open"
            onClick={() => {
              setStatus('');
              setOpen(true);
            }}
          >
            Piece Shop
          </button>
        </div>
      </>
      ) : null}

      <div
        className={`freezone-overlay ${open ? 'open' : ''}`}
        aria-hidden={!open}
        onClick={() => setOpen(false)}
      >
        <section
          className="freezone-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="freezone-title"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="freezone-close"
            onClick={() => setOpen(false)}
            aria-label="Close Freezone"
          >
            ×
          </button>
          <p className="freezone-eyebrow">SHARED REAL-TIME ARENA · UP TO 10 PLAYERS</p>
          <h2 id="freezone-title">{hud ? 'Freezone Piece Shop' : 'Freezone Arena'}</h2>
          {status && <p className="freezone-hint" role="status" aria-live="polite">{status}</p>}

          {hud ? (
            <>
              <nav className="freezone-shop-nav" aria-label="Freezone shop sections">
                {([
                  ['shop', 'Shop'],
                  ['bots', 'My bots'],
                  ['resources', 'Resources'],
                  ['profile', 'My profile'],
                  ['api', 'AI & APIs']
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    aria-current={activeShopTab === tab ? 'page' : undefined}
                    className={activeShopTab === tab ? 'selected' : ''}
                    onClick={() => setActiveShopTab(tab)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {activeShopTab === 'shop' && (
                <>
              <p className="freezone-description">
                Landing on an orb stores that resource; pickups never change your skills automatically.
                Spend XP on pieces, upgrade orbs, or robots. Bought orbs and upgrades are separate choices.
                Allied bots have their own pieces and do not take room seats or regular army slots.
              </p>
              <div className="freezone-summary">
                <span><strong>{hud.xp}</strong> XP</span>
                <span><strong>{hud.orbBalances.bot}</strong> bot orbs</span>
                <span><strong>{hud.allies.length}</strong> allied bots</span>
                <span><strong>{hud.pieces}/{hud.capacity}</strong> pieces</span>
                <span><strong>{hud.xpCost}</strong> XP per piece</span>
                <span>
                  <strong>
                    {hud.cooldownMs > 0
                      ? `${Math.ceil(hud.cooldownMs / 1000)}s`
                      : `${Math.max(0, hud.movesPerCycle - hud.movesUsed)}/${hud.movesPerCycle}`}
                  </strong>
                  {hud.cooldownMs > 0 ? ' resting' : ' actions left'}
                </span>
                <span><strong>{(hud.cooldownDurationMs / 1000).toFixed(1)}s</strong> cooldown</span>
                <span><strong>{hud.envelopeRows}×{hud.envelopeCols}</strong> movement envelope</span>
                <span><strong>{Math.max(0, hud.stepBudget - hud.stepsUsed)}/{hud.stepBudget}</strong> unit steps left</span>
                {hud.mutantZone && (
                  <span className="freezone-mutant-summary">
                    <strong>{hud.mutantZone.shape}</strong> mutates · {Math.ceil(hud.mutantZone.remainingMs / 1000)}s left
                  </span>
                )}
                {roomCode && (
                  <button type="button" onClick={() => void copyRoomCode()}>
                    Arena {roomCode} · Copy
                  </button>
                )}
              </div>
              <div className="freezone-room-presence" aria-label="Room players and controls">
                <strong>Players online: {hud.onlinePlayers.length} · Maximum seats: {hud.maxPlayers}</strong>
                {hud.onlinePlayers.length ? hud.onlinePlayers.map((player) => (
                  <span key={player.side}>
                    Team {player.side + 1}: {player.name}{player.bot ? ' (Bot)' : ''} — Online · {player.playing ? 'Playing' : 'Not playing'}
                  </span>
                )) : <span>No other players are online.</span>}
                {hud.alliedBots.map((ally) => (
                  <span key={ally.id}>
                    Team {ally.side + 1}: {ally.name} (Allied bot · {FREEZONE_ALLY_LABELS[ally.role]}) — {ally.playing ? 'Playing' : 'Not playing'}
                  </span>
                ))}
              </div>
              {roomCode && hud.isPlayer && (
                <div className="freezone-bot-controls">
                  <button
                    type="button"
                    aria-pressed={aiAssistEnabled}
                    onClick={() => setAIAssistEnabled((enabled) => !enabled)}
                  >
                    AI for my moves: {aiAssistEnabled ? 'On' : 'Off'}
                  </button>
                </div>
              )}
              <section className="freezone-allies" aria-label="Recruit allied bots">
                <h3>Recruit a robot · {hud.allyCost} XP</h3>
                <label>
                  Unit name (optional)
                  <input
                    value={allyNameDraft}
                    maxLength={32}
                    placeholder="Default role name"
                    onChange={(event) => setAllyNameDraft(event.target.value)}
                  />
                </label>
                <label>
                  Bot role
                  <select
                    value={allyRole}
                    onChange={(event) => setAllyRole(event.target.value as FreezoneAllyRole)}
                    disabled={!hud.isPlayer || purchaseBusy}
                  >
                    {Object.entries(FREEZONE_ALLY_LABELS).map(([role, label]) => (
                      <option key={role} value={role}>{label}</option>
                    ))}
                  </select>
                </label>
                <p>{FREEZONE_ALLY_DESCRIPTIONS[allyRole]}</p>
                <button
                  type="button"
                  disabled={!hud.isPlayer || purchaseBusy ||
                    hud.xp < hud.allyCost}
                  onClick={() => void recruitAlly()}
                >
                  Recruit robot · {hud.allyCost} XP
                </button>
                {hud.allies.length > 0 ? (
                  <ul aria-label="Allied bots on your team">
                    {hud.allies.map((ally) => (
                      <li key={ally.id}>{ally.name} · {FREEZONE_ALLY_LABELS[ally.role]}</li>
                    ))}
                  </ul>
                ) : <p>No allied bots recruited yet.</p>}
                {hud.xp < hud.allyCost && (
                  <p className="freezone-hint">
                    You need {hud.allyCost - hud.xp} more XP to recruit a robot.
                  </p>
                )}
              </section>
              <div
                className="freezone-xp-progress"
                role="progressbar"
                aria-label="Progress toward the next piece purchase"
                aria-valuemin={0}
                aria-valuemax={hud.xpCost}
                aria-valuenow={hud.xpProgress}
              >
                <span style={{ width: `${(hud.xpProgress / hud.xpCost) * 100}%` }} />
              </div>
              <p className="freezone-hint">
                {hud.xpProgress}/{hud.xpCost} XP toward the next piece · {hud.movesPerCycle} actions per cycle
              </p>
              <p className="freezone-hint">
                Envelope {hud.envelopeRows}×{hud.envelopeCols} is independent from the {hud.stepBudget}-step cycle budget.
              </p>
              <p className="freezone-hint">
                Upgrade levels: Red {hud.upgradeLevels.red} · Blue {hud.upgradeLevels.blue} ·
                Yellow {hud.upgradeLevels.yellow} ·
                Purple {hud.upgradeLevels.purple} · White {hud.upgradeLevels.white}
              </p>
              {hud.playerEliminationLeaderboard.length > 0 && (
                <div className="freezone-leaderboard" aria-label="Player elimination ranking">
                  <strong>Eliminations</strong>
                  {hud.playerEliminationLeaderboard.map((player) => (
                    <span key={player.side}>
                      {player.name}{player.bot ? ' (Bot)' : ''}: {player.eliminations}
                    </span>
                  ))}
                </div>
              )}
              <section className="freezone-orb-market" aria-label="Buy upgrade orbs">
                <h3>Buy an orb with XP</h3>
                <p className="freezone-hint">
                  Buying adds one orb to your inventory; spend it separately to activate its upgrade.
                </p>
                <div className="freezone-orb-market-grid">
                  {hud.orbEffects.filter((orb) => orb.type !== 'bot').map((orb) => {
                    const cost = hud.economy.orbCosts[orb.type] ?? 0;
                    const balance = hud.orbBalances[orb.type] ?? 0;
                    return (
                      <article key={orb.type} className="freezone-orb-market-item">
                        <strong>{orb.label} orb · {cost} XP</strong>
                        <span>{orb.description}</span>
                        <small>Available: {balance} · Your XP: {hud.xp}</small>
                        <button
                          type="button"
                          disabled={!hud.isPlayer || purchaseBusy || hud.xp < cost}
                          onClick={() => void buyOrb(orb.type as FreezonePurchaseOrb)}
                        >
                          Buy 1 · {cost} XP
                        </button>
                        {hud.xp < cost && (
                          <small>You need {cost - hud.xp} more XP.</small>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
              {!hud.isPlayer ? (
                <p className="freezone-hint">Spectators cannot buy or upgrade pieces.</p>
              ) : hud.xp < hud.xpCost ? (
                <p className="freezone-hint">Collect {hud.xpCost - hud.xp} more XP to buy a piece.</p>
              ) : hud.pieces >= hud.capacity ? (
                <p className="freezone-hint">Army full: choose a non-king piece to replace or buy an army-capacity upgrade with a purple orb.</p>
              ) : null}
              <div className="freezone-orb-guide" aria-label="Orb effects">
                {hud.orbEffects.map((orb) => (
                  <span key={orb.type}>
                    <i style={{ backgroundColor: orb.color }} />
                    <strong>{orb.label}</strong> {orb.description}
                    <small>
                      Balance: {hud.orbBalances[orb.type]}
                      {orb.type !== 'xp' && orb.type !== 'bot' && orb.type !== 'movement' &&
                        ` · Lv ${hud.upgradeLevels[orb.type]}`}
                    </small>
                  </span>
                ))}
              </div>
              <div className="freezone-upgrades" aria-label="Explicit skill upgrades">
                <h3>Spend an orb to upgrade</h3>
                {FREEZONE_UPGRADES.map((upgrade) => (
                  <div className="freezone-upgrade" key={upgrade.type}>
                    <span>
                      <strong>{upgrade.label}</strong>
                      <small>{upgrade.description} · {hud.orbBalances[upgrade.type]} available</small>
                    </span>
                    <button
                      type="button"
                      disabled={!hud.isPlayer || purchaseBusy || !hud.canUpgrade[upgrade.type] ||
                        hud.orbBalances[upgrade.type] < 1}
                      onClick={() => void purchaseUpgrade(upgrade.type)}
                    >
                      {hud.canUpgrade[upgrade.type] ? 'Spend 1 orb' : 'Max level'}
                    </button>
                  </div>
                ))}
                <div className="freezone-upgrade">
                  <span>
                    <strong>Movement envelope</strong>
                    <small>Costs {FREEZONE_ENVELOPE_ORB_COST} white orbs per scope level · {hud.orbBalances.white} available</small>
                  </span>
                  <select
                    value={`${effectiveTargetEnvelope.rows}x${effectiveTargetEnvelope.cols}`}
                    onChange={(event) => {
                      const [rows, cols] = event.target.value.split('x').map(Number);
                      setTargetEnvelope({ rows, cols });
                    }}
                    disabled={!upgradeableEnvelopes.length}
                    aria-label="Choose movement envelope upgrade"
                  >
                    {upgradeableEnvelopes.map((option) => (
                      <option key={`${option.rows}x${option.cols}`} value={`${option.rows}x${option.cols}`}>
                        {option.rows}×{option.cols}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!hud.isPlayer || purchaseBusy || !upgradeableEnvelopes.length ||
                      hud.orbBalances.white < targetEnvelopeCost}
                    onClick={() => void purchaseEnvelopeUpgrade()}
                  >
                    {upgradeableEnvelopes.length
                      ? `Spend ${targetEnvelopeCost} white orb${targetEnvelopeCost === 1 ? '' : 's'}`
                      : 'Max envelope'}
                  </button>
                </div>
              </div>
              <section className="freezone-movement-shop" aria-label="Unlock piece movement cards">
                <h3>Unlock movement cards · {FREEZONE_MOVEMENT_ORB_COST} movement orb each</h3>
                <p className="freezone-hint">
                  A counts only extra offsets bought for the selected piece. Its standard movements stay free.
                  Changing an offset between drag, jump, and teleport replaces its type and does not increase A.
                </p>
                <div className="freezone-movement-controls">
                  <label>
                    Piece
                    <select
                      value={selectedMovementPieceId}
                      onChange={(event) => setSelectedMovementPieceId(event.target.value)}
                      disabled={!hud.isPlayer || purchaseBusy || !hud.ownedPieces.length}
                    >
                      {hud.ownedPieces.map((piece) => (
                        <option key={piece.id} value={piece.id}>
                          {piece.name} · {piece.type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Scope
                    <select
                      value={`${effectiveMovementScope.rows}x${effectiveMovementScope.cols}`}
                      onChange={(event) => {
                        const [rows, cols] = event.target.value.split('x').map(Number);
                        setTargetMovementScope({ rows, cols });
                      }}
                      disabled={!hud.isPlayer || purchaseBusy || !movementScopes.length}
                    >
                      {movementScopes.map((option) => (
                        <option key={`${option.rows}x${option.cols}`} value={`${option.rows}x${option.cols}`}>
                          {option.rows}×{option.cols}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Extra offsets (A)
                    <select
                      value={targetMovementA}
                      onChange={(event) => setTargetMovementA(Number(event.target.value))}
                      disabled={!hud.isPlayer || purchaseBusy}
                    >
                      {Array.from({ length: hud.maxPatternOffsets }, (_, index) => index + 1).map((count) => (
                        <option key={count} value={count}>{count}A</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Card type
                    <select
                      value={movementKind}
                      onChange={(event) => setMovementKind(event.target.value as typeof movementKind)}
                      disabled={!hud.isPlayer || purchaseBusy}
                    >
                      <option value="drag">Drag / slide</option>
                      <option value="jump">Jump</option>
                      <option value="teleport">Teleport</option>
                    </select>
                  </label>
                </div>
                <p className="freezone-hint">
                  {selectedMovementPiece
                    ? `${selectedMovementPiece.name}: ${movementOffsetCount}A unlocked · target ${targetMovementA}A · ${hud.orbBalances.movement} movement orbs`
                    : 'Acquire a piece to unlock movement cards.'}
                </p>
                {selectedMovementPiece && (
                  <div
                    className="freezone-movement-grid"
                    role="group"
                    aria-label={`${effectiveMovementScope.rows} by ${effectiveMovementScope.cols} movement cards`}
                    style={{ gridTemplateColumns: `repeat(${movementGridCols}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: movementGridRows * movementGridCols }, (_, index) => {
                      const row = effectiveMovementScope.rows - Math.floor(index / movementGridCols);
                      const col = index % movementGridCols - effectiveMovementScope.cols;
                      const key = `${row},${col}`;
                      const isCenter = row === 0 && col === 0;
                      const alreadyAvailable = movementOffsetKeys.has(key);
                      const isExtra = movementExtraKeys.has(key);
                      const currentKind = selectedMovementPiece.teleports.some(
                        ([moveRow, moveCol]) => moveRow === row && moveCol === col
                      ) ? 'teleport' : selectedMovementPiece.jumps.some(
                        ([moveRow, moveCol]) => moveRow === row && moveCol === col
                      ) ? 'jump' : 'drag';
                      const sameType = alreadyAvailable && currentKind === movementKind;
                      const needsA = !alreadyAvailable;
                      const canUnlock = hud.isPlayer && !purchaseBusy &&
                        hud.orbBalances.movement >= FREEZONE_MOVEMENT_ORB_COST &&
                        (!needsA || movementOffsetCount < targetMovementA) &&
                        (!isCenter || movementKind === 'teleport') &&
                        !sameType;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`freezone-movement-card ${isExtra ? 'extra' : ''} ${alreadyAvailable ? 'owned' : ''} ${movementKind}`}
                          aria-label={`${isCenter ? 'Same-square' : `${row}, ${col}`} ${movementKind} movement${alreadyAvailable ? `; currently ${currentKind}` : ''}`}
                          title={alreadyAvailable
                            ? `${isExtra ? 'Extra offset' : 'Standard movement'} · ${currentKind}${sameType ? '' : ` · change to ${movementKind}`}`
                            : `${movementKind} offset ${row}, ${col}`}
                          disabled={!canUnlock}
                          onClick={() => void purchaseMovementOffset(row, col)}
                        >
                          {sameType ? '✓' : alreadyAvailable ? '↻' : isCenter ? '0,0' : '+'}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
              <section className="freezone-customization" aria-label="Piece profile and local audio settings">
                <h3>Piece appearance & profile</h3>
                <div className="freezone-appearance-picker">
                  <label>
                    Appearance
                    <select value={appearance} onChange={(event) => setAppearance(event.target.value)}>
                      {FREEZONE_APPEARANCES.map((option) => (
                        <option value={option.id} key={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  {open && (
                    <FreezoneAppearancePreview
                      appearance={appearance}
                      label={FREEZONE_APPEARANCES.find((option) => option.id === appearance)?.label || appearance}
                    />
                  )}
                </div>
                <div className="freezone-designer-fields">
                  <label>
                    Piece name
                    <input value={pieceName} maxLength={32} placeholder="Stanley" onChange={(event) => setPieceName(event.target.value)} />
                  </label>
                  <label>
                    Role / title
                    <input value={pieceTitle} maxLength={32} placeholder="General" onChange={(event) => setPieceTitle(event.target.value)} />
                  </label>
                  <label className="freezone-field-wide">
                    Public description
                    <textarea value={pieceDescription} maxLength={160} placeholder="A short public profile" onChange={(event) => setPieceDescription(event.target.value)} />
                  </label>
                  <label className="freezone-field-wide">
                    Personality for AI lines and decisions
                    <textarea value={piecePersonality} maxLength={240} placeholder="Calm strategist who protects allies and taunts rivals" onChange={(event) => setPiecePersonality(event.target.value)} />
                  </label>
                  <label>
                    AI dialogue language
                    <select value={pieceLanguage} onChange={(event) => setPieceLanguage(event.target.value)}>
                      {FREEZONE_AI_LANGUAGES.map(({ id, label }) => (
                        <option value={id} key={id}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    AI character voice for this piece
                    <select value={pieceAIVoice} onChange={(event) => setPieceAIVoice(event.target.value)}>
                      {FREEZONE_AI_VOICES.map(({ id, label }) => (
                        <option value={id} key={id}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="freezone-field-wide">
                    Public phrase
                    <input value={pieceCatchphrase} maxLength={120} placeholder="Always defeats my opponents" onChange={(event) => setPieceCatchphrase(event.target.value)} />
                  </label>
                </div>
                <details className="freezone-audio-settings">
                  <summary>Optional piece voice lines (up to 120 characters each)</summary>
                  {!('speechSynthesis' in window) ? (
                    <p className="freezone-hint">Speech synthesis is not supported in this browser.</p>
                  ) : (
                    <>
                      <label className="freezone-local-toggle">
                        <input type="checkbox" checked={voiceEnabled} onChange={(event) => setVoiceEnabled(event.target.checked)} />
                        Enable local speech for public piece lines
                      </label>
                      <label>
                        Browser voice
                        <select value={selectedVoiceURI} onChange={(event) => setSelectedVoiceURI(event.target.value)}>
                          <option value="">Browser default voice</option>
                          {selectedVoiceURI && !resolveFreezoneVoice(voices, selectedVoiceURI) && (
                            <option value={selectedVoiceURI} disabled>Selected voice unavailable</option>
                          )}
                          {voices.map((voice) => (
                            <option key={voice.voiceURI} value={voice.voiceURI}>
                              {voice.name} · {voice.lang}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!voices.length && <p className="freezone-hint">No system voices are available yet. Speech stays silent until the browser provides one.</p>}
                      {selectedVoiceURI && !resolveFreezoneVoice(voices, selectedVoiceURI) && (
                        <p className="freezone-hint">The chosen voice is unavailable here. Choose another voice or turn speech off.</p>
                      )}
                    </>
                  )}
                  <div className="freezone-voice-lines">
                    {FREEZONE_VOICE_EVENTS.map((event) => (
                      <label key={event.id}>
                        {event.label}
                        <input
                          value={voiceLines[event.id as VoiceEventKey]}
                          maxLength={120}
                          onChange={(change) => setVoiceLines((current) => ({
                            ...current,
                            [event.id]: change.target.value.slice(0, 120)
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                </details>
                <details className="freezone-audio-settings">
                  <summary>Freezone music</summary>
                  <label>
                    Local MP3 (this device only)
                    <input type="file" accept=".mp3,audio/mpeg" onChange={(event) => loadMusicFile(event.target.files?.[0])} />
                  </label>
                  <label>
                    Share direct audio URL with room
                    <span className="freezone-audio-url">
                      <input value={musicUrl} maxLength={2048} placeholder="https://example.com/music.mp3" onChange={(event) => setMusicUrl(event.target.value)} />
                      <button type="button" onClick={() => void loadMusicUrl()}>Share</button>
                      {hud.sharedMusicUrl && (
                        <button type="button" onClick={() => void clearSharedMusic()}>Clear</button>
                      )}
                    </span>
                  </label>
                  <div className="freezone-music-controls">
                    <button
                      type="button"
                      disabled={musicBusy || (!musicSource && !hud.sharedMusicUrl)}
                      onClick={() => void toggleMusic(hud.sharedMusicUrl || musicSource)}
                    >
                      {hud.sharedMusicUrl
                        ? sharedMusicPlaying
                          ? musicPlaying ? 'Pause room music' : 'Enable audio here'
                          : 'Play for room'
                        : musicPlaying ? 'Stop local music' : 'Play local music'}
                    </button>
                    <label>
                      Volume
                      <input type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} />
                    </label>
                  </div>
                  <audio
                    ref={musicRef}
                    onPlay={() => setMusicPlaying(true)}
                    onPause={() => setMusicPlaying(false)}
                    onError={() => {
                      setMusicPlaying(false);
                      setStatus(getFreezoneAudioPlaybackError());
                    }}
                  />
                  <p className="freezone-hint">
                    {hud.sharedMusicUrl
                    ? sharedMusicPlaying
                      ? 'Shared playback is on; each participant may need to enable audio on their device.'
                      : 'Shared URL is synchronized and playback is paused.'
                      : 'No shared URL is set. A local MP3 cannot be shared across devices.'}
                  </p>
                </details>
              </section>
              <div className="freezone-tabs" role="tablist" aria-label="Piece options">
                <button
                  type="button"
                  className={!designMode ? 'selected' : ''}
                  aria-pressed={!designMode}
                  onClick={() => setDesignMode(false)}
                >
                  Available patterns
                </button>
                <button
                  type="button"
                  className={designMode ? 'selected' : ''}
                  aria-pressed={designMode}
                  onClick={() => setDesignMode(true)}
                >
                  Design a pattern
                </button>
              </div>

              {pendingReplacement && (
                <div className="freezone-replacement">
                  <p>
                    Choose a non-king piece to replace with {pendingReplacement.name}.
                    The purchase costs {hud.xpCost} XP.
                  </p>
                  {hud.ownedPieces.map((piece) => (
                    <button
                      type="button"
                      key={piece.id}
                      disabled={purchaseBusy || piece.type === 'king'}
                      onClick={() => void acquirePiece(pendingReplacement, piece.id)}
                    >
                      Replace {piece.name}{piece.title ? ` · ${piece.title}` : ''}
                      {piece.type === 'king' ? ' · King cannot be replaced' : ''}
                    </button>
                  ))}
                  <button type="button" onClick={() => setPendingReplacement(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {!designMode ? (
                <div className="freezone-pattern-list">
                  {hud.pieceOptions.map((pattern) => (
                    <article className="freezone-pattern" key={pattern.id}>
                      <div>
                        <strong>{pattern.name}</strong>
                        {pattern.title && <span>{pattern.title}</span>}
                        {pattern.personality && <span>Personality: {pattern.personality}</span>}
                        <span>{FREEZONE_AI_LANGUAGES.find(({ id }) => id === pattern.language)?.label || pattern.language} · {FREEZONE_AI_VOICES.find(({ id }) => id === pattern.aiVoice)?.label || pattern.aiVoice}</span>
                        {pattern.catchphrase && <span>“{pattern.catchphrase}”</span>}
                        <span>{movementText(pattern.moves, pattern.jumps, pattern.teleports, pattern.slide)}</span>
                      </div>
                      <button
                        type="button"
                        disabled={!canAcquire || purchaseBusy}
                        onClick={() => void acquirePiece(configuredPattern(pattern))}
                      >
                        {hud.pieces >= hud.capacity ? 'Replace' : 'Acquire'} · {hud.xpCost} XP
                      </button>
                    </article>
                  ))}
                  {!hud.pieceOptions.length && (
                    <p className="freezone-empty">No piece patterns are available in this arena.</p>
                  )}
                </div>
              ) : (
                <div className="freezone-designer">
                  <div className="freezone-designer-fields">
                    <label>
                      Piece model
                      <select value={pieceType} onChange={(event) => setPieceType(event.target.value as PieceType)}>
                        {PIECE_TYPES.map((piece) => (
                          <option key={piece.type} value={piece.type}>{piece.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Pattern name
                      <input
                        value={pieceName}
                        maxLength={32}
                        placeholder={`Custom ${pieceType}`}
                        onChange={(event) => setPieceName(event.target.value)}
                      />
                    </label>
                    <label>
                      Role / title
                      <input
                        value={pieceTitle}
                        maxLength={32}
                        placeholder="General"
                        onChange={(event) => setPieceTitle(event.target.value)}
                      />
                    </label>
                    <label>
                      Catchphrase
                      <input
                        value={pieceCatchphrase}
                        maxLength={120}
                        placeholder="Always defeats my opponents"
                        onChange={(event) => setPieceCatchphrase(event.target.value)}
                      />
                    </label>
                  </div>
                  <p className="freezone-hint">
                    Envelope {hud.envelopeRows}×{hud.envelopeCols}; actions spend up to {hud.stepBudget} unit steps per cycle.
                    This changes movement design only, not the physical board.
                  </p>
                  <div
                    className="freezone-preview-board"
                    role="group"
                    aria-label="Movement pattern preview"
                    style={{ gridTemplateColumns: `repeat(${editorCols}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: editorRows * editorCols }, (_, index) => {
                      const row = Math.floor(index / editorCols);
                      const col = index % editorCols;
                      const offsetRow = hud.envelopeRows - row;
                      const offsetCol = col - hud.envelopeCols;
                      const center = offsetRow === 0 && offsetCol === 0;
                      const selected = selectedMoves.some(
                        ([moveRow, moveCol]) => moveRow === offsetRow && moveCol === offsetCol
                      );
                      const step = selectedMoves.findIndex(
                        ([moveRow, moveCol]) => moveRow === offsetRow && moveCol === offsetCol
                      );
                      const jump = selectedJumps.some(
                        ([moveRow, moveCol]) => moveRow === offsetRow && moveCol === offsetCol
                      );
                      const teleport = selectedTeleports.some(
                        ([moveRow, moveCol]) => moveRow === offsetRow && moveCol === offsetCol
                      );
                      return (
                        <button
                          key={`${offsetRow},${offsetCol}`}
                          type="button"
                          className={`${center ? 'center' : ''} ${selected ? 'selected' : ''} ${jump ? 'jump' : ''} ${teleport ? 'teleport' : ''}`}
                          aria-label={center ? 'Teleport to the same square' : `Move ${offsetRow}, ${offsetCol}`}
                          aria-pressed={selected}
                          onClick={() => toggleMove(offsetRow, offsetCol)}
                        >
                          {center ? (teleport ? 'T' : '●') : selected ? String(step + 1) : ''}
                        </button>
                      );
                    })}
                  </div>
                  <p className="freezone-move-legend">
                    <span><i className="ordinary" /> Drag / slide (blue)</span>
                    <span><i className="jump" /> Path-checked jump (green)</span>
                    <span><i className="teleport" /> Teleport (red, no path)</span>
                  </p>
                  <p className="freezone-hint">Click a selected square to cycle drag → jump → teleport → remove.</p>
                  <label className="freezone-slide">
                    <input type="checkbox" checked={slide} onChange={(event) => setSlide(event.target.checked)} />
                    Slide along each selected direction
                  </label>
                  <p className="freezone-hint">
                    {selectedMoves.length
                      ? movementText(selectedMoves, selectedJumps, selectedTeleports, slide)
                      : 'Choose at least one reachable square.'}
                  </p>
                  <button
                    type="button"
                    className="freezone-design-acquire"
                    disabled={!canAcquire || purchaseBusy || selectedMoves.length === 0}
                    onClick={() => void acquirePiece(configuredPattern({
                      name: previewName,
                      title: pieceTitle.trim(),
                      catchphrase: pieceCatchphrase.trim(),
                      appearance,
                      description: pieceDescription.trim(),
                      personality: piecePersonality.trim(),
                      language: pieceLanguage,
                      aiVoice: pieceAIVoice,
                      voiceLines,
                      type: pieceType,
                      moves: selectedMoves,
                      jumps: selectedJumps,
                      teleports: selectedTeleports,
                      slide
                    }))}
                  >
                    {hud.pieces >= hud.capacity ? 'Design & replace' : 'Design & acquire'} · {hud.xpCost} XP
                  </button>
                </div>
              )}
            </>
              )}
              {activeShopTab === 'bots' && (
                <section className="freezone-shop-page" aria-label="My bots and units">
                  <h3>My bots and units</h3>
                  <p className="freezone-hint">
                    Recruitment costs XP once. Editing a unit profile never charges XP or orbs.
                  </p>
                  <label className="freezone-local-toggle">
                    <input type="checkbox" checked={voiceEnabled} onChange={(event) => setVoiceEnabled(event.target.checked)} />
                    Enable local speech for piece voice lines on this device
                  </label>
                  <p className="freezone-hint">
                    Text bubbles can appear while speech is off. Configure AI movement, dialogue, and voice separately in AI & APIs.
                  </p>
                  <button type="button" onClick={() => setActiveShopTab('api')}>
                    Configure AI & APIs
                  </button>
                  {hud.teamPieces.length ? (
                    <div className="freezone-my-bots">
                      {hud.teamPieces.map((piece) => (
                        <article key={piece.id} className="freezone-my-bot">
                          <span><strong>{piece.name}</strong> · {piece.type}{piece.ally ? ' · Allied robot' : ''}</span>
                          <button
                            type="button"
                            aria-pressed={editingPieceId === piece.id}
                            onClick={() => selectPieceForEditing(piece.id)}
                          >
                            Edit
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : <p className="freezone-empty">You do not control any units yet.</p>}
                  {!hud.teamPieces.length && (
                    <button type="button" onClick={() => setActiveShopTab('shop')}>
                      Open Shop
                    </button>
                  )}
                  {editingPieceId && (
                    <form
                      className="freezone-customization freezone-profile-editor"
                      aria-label="Edit unit profile"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveEditedPiece();
                      }}
                    >
                      <h4>Edit {hud.teamPieces.find((piece) => piece.id === editingPieceId)?.name || 'unit'}</h4>
                      <div className="freezone-designer-fields">
                        <label>
                          Unit name
                          <input value={pieceName} maxLength={32} onChange={(event) => setPieceName(event.target.value)} />
                        </label>
                        <label>
                          Role / title
                          <input value={pieceTitle} maxLength={32} onChange={(event) => setPieceTitle(event.target.value)} />
                        </label>
                        <label>
                          Appearance
                          <select value={appearance} onChange={(event) => setAppearance(event.target.value)}>
                            {FREEZONE_APPEARANCES.map((option) => (
                              <option value={option.id} key={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Dialogue language
                          <select value={pieceLanguage} onChange={(event) => setPieceLanguage(event.target.value)}>
                            {FREEZONE_AI_LANGUAGES.map(({ id, label }) => (
                              <option value={id} key={id}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Character voice
                          <select value={pieceAIVoice} onChange={(event) => setPieceAIVoice(event.target.value)}>
                            {FREEZONE_AI_VOICES.map(({ id, label }) => (
                              <option value={id} key={id}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="freezone-field-wide">
                          Public description
                          <textarea value={pieceDescription} maxLength={160} onChange={(event) => setPieceDescription(event.target.value)} />
                        </label>
                        <label className="freezone-field-wide">
                          Personality
                          <textarea value={piecePersonality} maxLength={240} onChange={(event) => setPiecePersonality(event.target.value)} />
                        </label>
                        <label className="freezone-field-wide">
                          Public phrase
                          <input value={pieceCatchphrase} maxLength={120} onChange={(event) => setPieceCatchphrase(event.target.value)} />
                        </label>
                        {FREEZONE_VOICE_EVENTS.map((event) => (
                          <label key={event.id}>
                            {event.label}
                            <input
                              value={voiceLines[event.id as VoiceEventKey]}
                              maxLength={120}
                              onChange={(change) => setVoiceLines((current) => ({
                                ...current,
                                [event.id]: change.target.value.slice(0, 120)
                              }))}
                            />
                          </label>
                        ))}
                      </div>
                      <div className="freezone-profile-actions">
                        <button type="button" onClick={previewPieceVoice}>Preview locally</button>
                        <button type="submit" disabled={purchaseBusy}>Save profile</button>
                      </div>
                    </form>
                  )}
                </section>
              )}
              {activeShopTab === 'resources' && (
                <section className="freezone-shop-page freezone-resources" aria-label="Your resources">
                  <h3>Resources</h3>
                  <div className="freezone-resource-xp"><strong>{hud.xp}</strong><span>XP</span></div>
                  <p>XP is the general game currency. Upgrade orbs remain separate and must be spent explicitly.</p>
                  <div className="freezone-resource-grid">
                    {hud.orbEffects.map((orb) => (
                      <article key={orb.type}>
                        <strong><i style={{ backgroundColor: orb.color }} />{orb.label} orb</strong>
                        <b>{hud.orbBalances[orb.type] ?? 0}</b>
                        <span>{orb.description}</span>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {activeShopTab === 'profile' && (
                <section className="freezone-shop-page freezone-player-profile" aria-label="My player profile">
                  <h3>{hud.playerName} · Player profile</h3>
                  <dl>
                    <div><dt>Army capacity</dt><dd>{hud.pieces}/{hud.capacity}</dd></div>
                    <div><dt>Actions per cycle</dt><dd>{hud.movesPerCycle}</dd></div>
                    <div><dt>Movement steps per cycle</dt><dd>{hud.stepBudget}</dd></div>
                    <div><dt>Cooldown</dt><dd>{(hud.cooldownDurationMs / 1000).toFixed(1)} seconds</dd></div>
                    <div><dt>Movement envelope</dt><dd>{hud.envelopeRows}×{hud.envelopeCols}</dd></div>
                    <div><dt>Remaining steps</dt><dd>{Math.max(0, hud.stepBudget - hud.stepsUsed)}</dd></div>
                  </dl>
                  <h4>Current upgrades</h4>
                  <p>Red {hud.upgradeLevels.red} · Blue {hud.upgradeLevels.blue} · Yellow {hud.upgradeLevels.yellow} · Purple {hud.upgradeLevels.purple} · White {hud.upgradeLevels.white}</p>
                  <h4>Unit movement patterns</h4>
                  {hud.ownedPieces.map((piece) => (
                    <article key={piece.id}>
                      <strong>{piece.name}</strong>
                      <span>{movementText(piece.moves, piece.jumps, piece.teleports, piece.slide)}</span>
                      <small>{piece.unlockedMoves.length} extra movement offsets</small>
                    </article>
                  ))}
                </section>
              )}
              {activeShopTab === 'api' && (
                <section className="freezone-shop-page freezone-ai-settings" aria-label="AI services and API settings">
                  <h3>AI services & APIs</h3>
                  <p className="freezone-hint">
                    Configure a separate provider, model, and optional key for each function. API keys stay in this browser session; testing a provider may use its API quota.
                  </p>
                  <div className="freezone-ai-services">
                    <article className="freezone-ai-service">
                      <h4>Movement decisions</h4>
                      <label className="freezone-local-toggle">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={aiAssistEnabled}
                          onChange={(event) => setAIAssistEnabled(event.target.checked)}
                        />
                        Allow AI to move my unselected pieces
                      </label>
                      <label className="freezone-local-toggle">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={aiBotsEnabled}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            setAIBotsEnabled(enabled);
                            window.dispatchEvent(new CustomEvent('wizard-chess-freezone-ai-bots', {
                              detail: enabled
                            }));
                          }}
                        />
                        Use AI for my purchased bots
                      </label>
                      <p className="freezone-hint">
                        Pieces tagged “AI” may be moved by the assistant. Select one to take control; the AI then waits 20 seconds after your last move or selection before moving another piece. Purchased bots can act as soon as they are ready.
                      </p>
                      <label>
                        Provider
                        <select
                          value={aiSettings.movementProvider}
                          onChange={(event) => updateAITextProvider('movement', event.target.value as FreezoneTextProvider)}
                        >
                          <option value="openrouter">OpenRouter</option>
                          <option value="gemini">Gemini</option>
                          <option value="openai">OpenAI</option>
                          <option value="deepseek">DeepSeek</option>
                        </select>
                      </label>
                      <label>
                        Model ID
                        <input
                          list="freezone-movement-models"
                          value={aiSettings.movementModel}
                          maxLength={128}
                          onChange={(event) => updateAISettings({ movementModel: event.target.value })}
                          placeholder="deepseek/deepseek-v4.1-flash"
                        />
                        <datalist id="freezone-movement-models">
                          <option value="deepseek/deepseek-v4.1-flash" />
                          <option value="openrouter/free" />
                          <option value="gemini-2.5-flash" />
                          <option value="gpt-4o-mini" />
                          <option value="deepseek-flash" />
                        </datalist>
                      </label>
                      <label>
                        API key (optional)
                        <input
                          type="password"
                          autoComplete="new-password"
                          maxLength={512}
                          value={aiSettings.serviceApiKeys.movement}
                          onChange={(event) => updateAIServiceKey('movement', event.target.value)}
                          placeholder="Vazio usa a chave configurada no servidor"
                        />
                      </label>
                      <div className="freezone-ai-test-row">
                        <button
                          type="button"
                          disabled={aiServiceStatuses.movement?.state === 'checking'}
                          onClick={() => void testAIService('movement')}
                        >
                          Test movement action
                        </button>
                        {renderAIServiceStatus('movement')}
                      </div>
                    </article>

                    <article className="freezone-ai-service">
                      <h4>Text generation & dialogue</h4>
                      <label className="freezone-local-toggle">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={aiSettings.dialogueEnabled}
                          onChange={(event) => updateAISettings({ dialogueEnabled: event.target.checked })}
                        />
                        Generate dialogue with AI
                      </label>
                      <p className="freezone-hint">
                        Turn this off to keep AI movement without making a separate dialogue request. If provider and model match movement, one request handles both.
                      </p>
                      <label>
                        Provider
                        <select
                          value={aiSettings.dialogueProvider}
                          onChange={(event) => updateAITextProvider('dialogue', event.target.value as FreezoneTextProvider)}
                        >
                          <option value="openrouter">OpenRouter</option>
                          <option value="gemini">Gemini</option>
                          <option value="openai">OpenAI</option>
                          <option value="deepseek">DeepSeek</option>
                        </select>
                      </label>
                      <label>
                        Model ID
                        <input
                          list="freezone-dialogue-models"
                          value={aiSettings.dialogueModel}
                          maxLength={128}
                          onChange={(event) => updateAISettings({ dialogueModel: event.target.value })}
                          placeholder="deepseek/deepseek-v4.1-flash"
                        />
                        <datalist id="freezone-dialogue-models">
                          <option value="deepseek/deepseek-v4.1-flash" />
                          <option value="openrouter/free" />
                          <option value="gemini-2.5-flash" />
                          <option value="gpt-4o-mini" />
                          <option value="deepseek-flash" />
                        </datalist>
                      </label>
                      <label>
                        API key (optional)
                        <input
                          type="password"
                          autoComplete="new-password"
                          maxLength={512}
                          value={aiSettings.serviceApiKeys.dialogue}
                          onChange={(event) => updateAIServiceKey('dialogue', event.target.value)}
                          placeholder="Vazio usa a chave configurada no servidor"
                        />
                      </label>
                      <div className="freezone-ai-test-row">
                        <button
                          type="button"
                          disabled={!aiSettings.dialogueEnabled || aiServiceStatuses.dialogue?.state === 'checking'}
                          onClick={() => void testAIService('dialogue')}
                        >
                          Test text & bubble
                        </button>
                        {renderAIServiceStatus('dialogue')}
                      </div>
                    </article>

                    <article className="freezone-ai-service">
                      <h4>Character speech</h4>
                      <label className="freezone-local-toggle">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={aiVoiceEnabled}
                          onChange={(event) => setAIVoiceEnabled(event.target.checked)}
                        />
                        Enable AI-generated speech on this device
                      </label>
                      <label>
                        Voice provider
                        <select
                          value={aiSettings.voiceProvider}
                          onChange={(event) => updateAISpeechProvider(event.target.value as FreezoneSpeechProvider)}
                        >
                          <option value="gemini-live">Gemini Live</option>
                          <option value="gemini-tts">Gemini TTS</option>
                          <option value="openai-tts">OpenAI TTS</option>
                          <option value="google-tts">Google Cloud TTS</option>
                        </select>
                      </label>
                      {aiSettings.voiceProvider !== 'google-tts' && (
                        <label>
                          Voice model ID
                          <input
                            value={aiSettings.voiceModel}
                            maxLength={128}
                            onChange={(event) => updateAISettings({ voiceModel: event.target.value })}
                            placeholder={FREEZONE_SPEECH_MODEL_DEFAULTS[aiSettings.voiceProvider as FreezoneSpeechProvider]}
                          />
                        </label>
                      )}
                      <label>
                        Voice API key (optional)
                        <input
                          type="password"
                          autoComplete="new-password"
                          maxLength={512}
                          value={aiSettings.serviceApiKeys.speech}
                          onChange={(event) => updateAIServiceKey('speech', event.target.value)}
                          placeholder="Vazio usa a chave configurada no servidor"
                        />
                      </label>
                      <div className="freezone-ai-test-row">
                        <button
                          type="button"
                          disabled={aiServiceStatuses.speech?.state === 'checking'}
                          onClick={() => void testAIService('speech')}
                        >
                          Test audio
                        </button>
                        {renderAIServiceStatus('speech')}
                      </div>
                      <button
                        type="button"
                        disabled={!aiVoiceReady}
                        onClick={() => void aiVoiceAudioRef.current?.play().catch(() => {
                          setAIVoiceStatus('The generated voice could not be played by this browser.');
                        })}
                      >
                        Play latest voice preview
                      </button>
                      <audio ref={aiVoiceAudioRef} onError={() => {
                        if (aiVoiceReady) setAIVoiceStatus('The generated voice audio could not be played.');
                      }} />
                      {aiVoiceStatus && <p className="freezone-hint" aria-live="polite">{aiVoiceStatus}</p>}
                    </article>
                  </div>
                  <p className="freezone-hint">
                    Leave a key blank to use the matching Supabase secret. Keys entered here are sent only to Supabase over HTTPS, stay in this session, and are not synchronized to the room. “Clear API keys” clears only browser-session keys, not server secrets.
                  </p>
                  <button type="button" onClick={clearAIKeys}>Clear API keys</button>
                </section>
              )}
            </>
          ) : (
            <>
              <p className="freezone-description">
                Create a persistent shared arena or join a friend. Players enter the same open world,
                collect XP, and build their own piece movement patterns.
              </p>
              <div className="freezone-room-list" aria-live="polite">
                <h3>Available Freezone rooms</h3>
                {roomsLoading && !rooms.length && <p className="freezone-empty">Finding the shared arena…</p>}
                {!roomsLoading && !rooms.length && <p className="freezone-empty">No active Freezone rooms found.</p>}
                {rooms.map((room) => (
                  <article className="freezone-room" key={room.id}>
                    {room.publication?.thumbnailUrl && (
                      <img
                        className="freezone-room-thumbnail"
                        src={room.publication.thumbnailUrl}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    <div>
                      <strong>{room.name}{room.isMainArena ? ' · Main' : ''}</strong>
                      {room.publication?.description && <span>{room.publication.description}</span>}
                      <span>
                        {room.format === 'triangle' ? 'Triangle arena · ' : room.format === 'hexagonal' ? 'Hexagonal arena · ' : 'Square arena · '}
                        {room.online ?? room.joined} online · {room.reconnecting ?? 0} reconnecting · {room.bots ?? 0} bots ·
                        {' '}{room.staleClaims ?? 0} stale claims to reclaim ·
                        {' '}{Math.max(0, room.capacity - room.joined)} slots available · Code {room.code}
                      </span>
                      {room.publication?.tags.length ? (
                        <small className="freezone-room-tags">{room.publication.tags.join(' · ')}</small>
                      ) : null}
                      <small className="freezone-room-state">
                        {room.joined >= room.capacity ? 'Full' : room.status === 'active' ? 'In progress' : 'Open'}
                      </small>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void joinArenaCode(room.code)}
                    >
                      {room.joined >= room.capacity ? 'Join / Rejoin' : 'Join'}
                    </button>
                  </article>
                ))}
              </div>
              <button
                type="button"
                className="freezone-create"
                disabled={busy}
                onClick={() => void createArena()}
              >
                {busy ? 'Connecting...' : 'Create a 10-player arena'}
              </button>
              <form className="freezone-join" onSubmit={(event) => void joinArena(event)}>
                <label htmlFor="freezone-code">Join an arena by code</label>
                <div>
                  <input
                    id="freezone-code"
                    value={joinCode}
                    maxLength={4}
                    autoComplete="off"
                    autoCapitalize="characters"
                    placeholder="ABCD"
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  />
                  <button type="submit" disabled={busy || joinCode.length !== 4}>
                    {busy ? 'Joining...' : 'Join'}
                  </button>
                </div>
              </form>
            </>
          )}
          <p className="freezone-status" aria-live="polite">{status}</p>
        </section>
      </div>
      <div className={`freezone-toast ${notice ? 'visible' : ''}`} role="status" aria-live="assertive">
        {notice}
      </div>
      <div className={`freezone-feedback ${feedback ? 'visible' : ''}`} role="status" aria-live="polite">
        {feedback}
      </div>
      {inspectedPiece && (
        <div
          className="freezone-piece-card"
          role="status"
          style={{
            left: Math.max(8, Math.min(inspectedPiece.x + 14, window.innerWidth - 280)),
            top: Math.max(8, Math.min(inspectedPiece.y + 14, window.innerHeight - 300))
          }}
        >
          <strong>{inspectedPiece.name}</strong>
          <span>{inspectedPiece.title || 'Piece'} · {inspectedPiece.type} · {FREEZONE_APPEARANCES.find(({ id }) => id === inspectedPiece.appearance)?.label || 'Classic'}</span>
          <span>
            Controlled by: {hud?.onlinePlayers.find((player) => player.side === inspectedPiece.side)?.name ||
              `Team ${inspectedPiece.side + 1}`}
          </span>
          {inspectedPiece.description && <p>{inspectedPiece.description}</p>}
          {inspectedPiece.personality && <p>Personality: {inspectedPiece.personality}</p>}
          <span>{FREEZONE_AI_LANGUAGES.find(({ id }) => id === inspectedPiece.language)?.label || inspectedPiece.language} · {FREEZONE_AI_VOICES.find(({ id }) => id === inspectedPiece.aiVoice)?.label || inspectedPiece.aiVoice}</span>
          {inspectedPiece.catchphrase && <q>{inspectedPiece.catchphrase}</q>}
          <span>Eliminations: {inspectedPiece.eliminations}</span>
          <span>{inspectedPiece.slide ? 'Sliding pattern' : 'Step pattern'}</span>
          <FreezoneMovementDiagram piece={inspectedPiece} />
        </div>
      )}
      {speechBubble && (
        <div
          className="freezone-speech-bubble"
          aria-hidden="true"
          style={{ left: speechBubble.x, top: speechBubble.y }}
        >
          {speechBubble.text}
        </div>
      )}
    </>
  );
}

function FreezoneMovementDiagram({ piece }: { piece: FreezoneInspectedPiece }) {
  const offsets = [...piece.moves, ...piece.jumps, ...piece.teleports];
  const range = Math.max(1, ...offsets.map(([row, col]) => Math.max(Math.abs(row), Math.abs(col))));
  const width = range * 2 + 1;
  const jumpKeys = new Set(piece.jumps.map(([row, col]) => `${row},${col}`));
  const teleportKeys = new Set(piece.teleports.map(([row, col]) => `${row},${col}`));
  const moveKeys = new Set(piece.moves.map(([row, col]) => `${row},${col}`));
  return (
    <div
      className="freezone-piece-moves"
      role="img"
      aria-label={`Valid movement offsets for ${piece.name}`}
      style={{ gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: width * width }, (_, index) => {
        const row = range - Math.floor(index / width);
        const col = index % width - range;
        const key = `${row},${col}`;
        const center = row === 0 && col === 0;
        const isTeleport = teleportKeys.has(key);
        return (
          <i
            key={key}
            className={`${center ? 'center' : ''} ${moveKeys.has(key) ? 'ordinary' : ''} ${jumpKeys.has(key) ? 'jump' : ''} ${isTeleport ? 'teleport' : ''}`}
          />
        );
      })}
    </div>
  );
}
