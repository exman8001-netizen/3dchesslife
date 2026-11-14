import { useEffect, useRef, useState, type FormEvent } from 'react';
import FreezoneAppearancePreview from './FreezoneAppearancePreview';
import type { DisplayPreferences } from './displayPreferences';
import {
  FREEZONE_AI_LANGUAGES,
  FREEZONE_AI_VOICES,
  FREEZONE_KOKORO_BROWSER_VOICE_IDS,
  FREEZONE_KOKORO_VOICES,
  FREEZONE_QWEN_VOICES,
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
  getFreezoneAIRequestSettings,
  updateFreezoneAISettings
} from './freezoneAISettings.js';
import {
  generateFreezoneKokoroSpeech,
  preloadFreezoneKokoroSpeech
} from './freezoneKokoro.js';
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
type FreezoneSpeechProvider =
  | 'gemini-live' | 'gemini-tts' | 'openai-tts' | 'google-tts' | 'qwen3-tts' | 'kokoro';

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
  qwenVoice: string;
  kokoroVoice: string;
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
  qwenVoice: string;
  kokoroVoice: string;
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
type FreezoneRelation = {
  id: string;
  sideA: number;
  sideB: number;
  status: 'ally' | 'enemy' | 'neutral';
  updatedAt: number;
  updatedBy: number;
};
type FreezoneTeamPiece = {
  id: string;
  name: string;
  type: FreezoneOwnedPiece['type'];
  ally: boolean;
  cooldownDurationMs: number;
  readyAt: number;
  cooldownMs: number;
};
type FreezoneAllianceInvitation = {
  id: string;
  fromSide: number;
  toSide: number;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  createdAt: number;
  updatedAt: number;
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
const freezoneRankingNumberFormat = new Intl.NumberFormat('en-US');
const formatFreezoneRankingNumber = (value?: number) => {
  const safeValue = typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
  return freezoneRankingNumberFormat.format(safeValue);
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
  'google-tts': '',
  'qwen3-tts': 'qwen3-tts-flash',
  kokoro: 'kokoro-82m'
} as const;

type FreezoneHud = {
  enabled: boolean;
  isPlayer: boolean;
  playerSide: number;
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
  upgradeLevelLimits: { red: number; blue: number; yellow: number; purple: number; white: number };
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
  teamPieces: FreezoneTeamPiece[];
  economy: {
    pieceCostXP: number;
    allyCostXP: number;
    orbCosts: Record<string, number>;
    eliminationXP: Record<string, number>;
  };
  roomLeaderboard?: FreezoneRoomRankingEntry[];
  freezoneRelations: FreezoneRelation[];
  freezoneAllianceInvitations: FreezoneAllianceInvitation[];
  botsEnabled: boolean;
};

type FreezoneApiResult = { ok: boolean; code?: string; error?: string };
type FreezoneRelationAction = 'invite' | 'accept' | 'decline' | 'enemy' | 'neutral';
type FreezoneUpgradePayment = 'orb' | 'xp';
type FreezoneUpgradeModalStage =
  | 'upgrades'
  | 'acquire-choice'
  | 'army-unlocked'
  | 'controlled-piece'
  | 'army-replacement'
  | 'allied-bot'
  | 'mobility'
  | 'envelope'
  | 'army-celebration'
  | null;
type FreezonePatternInput = Omit<FreezonePattern, 'id'> | FreezonePattern;
type FreezonePanelProps = {
  mainMenuOpen: boolean;
  displayPreferences: DisplayPreferences;
  onOpenDisplaySettings: () => void;
};

function FreezonePieceCooldowns({
  pieces,
  hud,
  canAcquireArmyUnit,
  canBuyMobility,
  purchaseBusy,
  upgradeXpCosts,
  feedback,
  onUpgrade,
  onAcquire,
  onMobility
}: {
  pieces: FreezoneTeamPiece[];
  hud: FreezoneHud;
  canAcquireArmyUnit: boolean;
  canBuyMobility: boolean;
  purchaseBusy: boolean;
  upgradeXpCosts: Record<'red' | 'blue' | 'yellow' | 'purple', number>;
  feedback: string;
  onUpgrade: (type: Exclude<FreezoneUpgrade, 'white'>) => void;
  onAcquire: () => void;
  onMobility: () => void;
}) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!pieces.length) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [pieces.length]);

  return (
    <aside className="freezone-piece-cooldowns" aria-label="Your pieces and cooldown energy">
      <strong>My pieces</strong>
      {pieces.length ? pieces.map((piece) => {
        const remaining = Math.max(0, piece.readyAt - now);
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
      {hud.isPlayer && (
        <FreezoneQuickUpgradeSpheres
          hud={hud}
          canAcquireArmyUnit={canAcquireArmyUnit}
          canBuyMobility={canBuyMobility}
          purchaseBusy={purchaseBusy}
          upgradeXpCosts={upgradeXpCosts}
          feedback={feedback}
          onUpgrade={onUpgrade}
          onAcquire={onAcquire}
          onMobility={onMobility}
        />
      )}
    </aside>
  );
}

function FreezoneHudTimers({
  cooldownMs,
  movesPerCycle,
  mutantZone
}: {
  cooldownMs: number;
  movesPerCycle: number;
  mutantZone: FreezoneHud['mutantZone'];
}) {
  const [now, setNow] = useState(Date.now);
  const [cooldownEndsAt, setCooldownEndsAt] = useState(() => Date.now() + cooldownMs);
  const [mutantEndsAt, setMutantEndsAt] = useState(
    () => Date.now() + (mutantZone?.remainingMs || 0)
  );
  const cooldownRemaining = cooldownMs > 0 ? Math.max(0, cooldownEndsAt - now) : 0;
  const mutantRemaining = mutantZone?.remainingMs
    ? Math.max(0, mutantEndsAt - now)
    : 0;

  useEffect(() => {
    setCooldownEndsAt(Date.now() + cooldownMs);
  }, [cooldownMs]);

  useEffect(() => {
    setMutantEndsAt(Date.now() + (mutantZone?.remainingMs || 0));
  }, [mutantZone?.remainingMs]);

  useEffect(() => {
    if (cooldownRemaining <= 0 && mutantRemaining <= 0) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldownRemaining > 0, mutantRemaining > 0]);

  return (
    <>
      <span>
        <strong>
          {cooldownRemaining > 0
            ? `${Math.ceil(cooldownRemaining / 1000)}s`
            : `${movesPerCycle}/${movesPerCycle}`}
        </strong>
        {cooldownRemaining > 0 ? ' resting' : ' actions left'}
      </span>
      {mutantZone && (
        <span className="freezone-mutant-summary">
          <strong>{mutantZone.shape}</strong> mutates · {Math.ceil(mutantRemaining / 1000)}s left
        </span>
      )}
    </>
  );
}

function FreezoneUpgradeSphereRow({
  label,
  detail,
  color,
  level,
  maxLevel,
  canActivate,
  onActivate,
  xpCost,
  canBuyWithXp,
  onBuyWithXp
}: {
  label: string;
  detail: string;
  color: 'red' | 'blue' | 'yellow' | 'purple' | 'white' | 'teal' | 'orange';
  level: number;
  maxLevel: number;
  canActivate: boolean;
  onActivate: () => void;
  xpCost?: number;
  canBuyWithXp?: boolean;
  onBuyWithXp?: () => void;
}) {
  return (
    <section className={`freezone-sphere-row ${xpCost !== undefined ? 'has-xp' : ''}`} aria-label={`${label} upgrade`}>
      <div className="freezone-sphere-row-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <div className="freezone-sphere-track" role="group" aria-label={`${label} levels`}>
        {Array.from({ length: maxLevel }, (_, index) => {
          const isOwned = index < level;
          const isNext = index === level;
          const isAvailable = isNext && canActivate;
          return (
            <button
              key={index}
              type="button"
              className={`freezone-upgrade-sphere ${color} ${isOwned ? 'owned' : ''} ${isAvailable ? 'available' : ''}`}
              aria-label={`${label} level ${index + 1}${isOwned ? ', active' : isAvailable ? ', available to buy' : ', locked'}`}
              aria-pressed={isOwned}
              disabled={!isAvailable}
              onClick={onActivate}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <small className="freezone-sphere-level">{level}/{maxLevel}</small>
      {xpCost !== undefined && (
        <button
          type="button"
          className="freezone-sphere-xp-buy"
          disabled={!canBuyWithXp || !onBuyWithXp}
          onClick={onBuyWithXp}
          aria-label={`Upgrade ${label} with ${xpCost} XP`}
        >
          XP {xpCost}
        </button>
      )}
    </section>
  );
}

function FreezoneQuickUpgradeSpheres({
  hud,
  canAcquireArmyUnit,
  canBuyMobility,
  purchaseBusy,
  upgradeXpCosts,
  feedback,
  onUpgrade,
  onAcquire,
  onMobility
}: {
  hud: FreezoneHud;
  canAcquireArmyUnit: boolean;
  canBuyMobility: boolean;
  purchaseBusy: boolean;
  upgradeXpCosts: Record<'red' | 'blue' | 'yellow' | 'purple', number>;
  feedback: string;
  onUpgrade: (type: Exclude<FreezoneUpgrade, 'white'>) => void;
  onAcquire: () => void;
  onMobility: () => void;
}) {
  const skills = FREEZONE_UPGRADES.map((upgrade) => {
    const level = hud.upgradeLevels[upgrade.type];
    const maxLevel = hud.upgradeLevelLimits[upgrade.type];
    const xpCost = upgradeXpCosts[upgrade.type];
    const orbBalance = hud.orbBalances[upgrade.type];
    return {
      id: upgrade.type,
      label: upgrade.label,
      shortLabel: {
        red: 'Actions',
        blue: 'Steps',
        yellow: 'Rest',
        purple: 'Army'
      }[upgrade.type],
      color: upgrade.type,
      level,
      maxLevel,
      canActivate: hud.isPlayer && hud.canUpgrade[upgrade.type] &&
        (orbBalance >= 1 || hud.xp >= xpCost),
      isBusy: purchaseBusy,
      detail: `${level}/${maxLevel} · ${orbBalance ? `${orbBalance} orb` : `${xpCost} XP`}`,
      onClick: () => onUpgrade(upgrade.type)
    };
  });
  const spheres = [
    ...skills,
    {
      id: 'unit',
      label: 'Acquire an army unit',
      shortLabel: 'Unit',
      color: 'teal',
      level: Math.min(hud.pieces, hud.capacity),
      maxLevel: Math.max(1, hud.capacity),
      canActivate: canAcquireArmyUnit,
      isBusy: false,
      detail: `Piece ${hud.xpCost} XP · bot ${hud.allyCost} XP`,
      onClick: onAcquire
    },
    {
      id: 'mobility',
      label: 'Movement geometry',
      shortLabel: 'Area',
      color: 'white',
      level: Math.min(hud.upgradeLevels.white, hud.upgradeLevelLimits.white),
      maxLevel: Math.max(1, hud.upgradeLevelLimits.white),
      canActivate: canBuyMobility,
      isBusy: false,
      detail: `${hud.envelopeRows}×${hud.envelopeCols}`,
      onClick: onMobility
    }
  ] as const;

  return (
    <section className="freezone-quick-upgrades" aria-label="Freezone upgrade spheres">
      <header>
        <strong>Upgrade spheres</strong>
        <small>{hud.xp} XP</small>
      </header>
      <div className="freezone-quick-upgrade-grid">
        {spheres.map((sphere) => {
          const canActivate = sphere.canActivate && !sphere.isBusy;
          const isOwned = sphere.level >= sphere.maxLevel && !canActivate;
          return (
            <button
              key={sphere.id}
              type="button"
              className={`freezone-quick-upgrade ${canActivate ? 'available' : ''} ${isOwned ? 'owned' : ''}`}
              disabled={!canActivate}
              title={`${sphere.label} · ${sphere.level}/${sphere.maxLevel} · ${sphere.detail}${canActivate ? ' · Click to unlock' : ' · Locked'}`}
              aria-label={`${sphere.label}, ${sphere.level} of ${sphere.maxLevel}${canActivate ? ', available to unlock' : ', locked'}`}
              onClick={sphere.onClick}
            >
              <span className={`freezone-quick-upgrade-orb ${sphere.color}`} aria-hidden="true">
                <i />
              </span>
              <span className="freezone-quick-upgrade-label">{sphere.shortLabel}</span>
              <span className="freezone-quick-upgrade-level">{sphere.level}/{sphere.maxLevel}</span>
            </button>
          );
        })}
      </div>
      <small className="freezone-quick-upgrade-help">Click an available sphere to unlock</small>
      {feedback && <span className="freezone-quick-upgrade-feedback" role="status">{feedback}</span>}
    </section>
  );
}

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
const FREEZONE_PERSONALITIES = [
  {
    id: 'natural-leader',
    name: 'Natural leader',
    description: 'Inspires allies, keeps the team focused, and encourages them under pressure.',
    prompt: 'A natural leader who inspires allies, keeps the team focused, and encourages them under pressure.',
    phrase: 'Friends, never give up!',
    portraitMark: '✦'
  },
  {
    id: 'wise-strategist',
    name: 'Wise strategist',
    description: 'Thinks several moves ahead and speaks calmly, even when the board is dangerous.',
    prompt: 'A wise strategist who thinks several moves ahead and speaks calmly under pressure.',
    phrase: 'Every move has a purpose.',
    portraitMark: '⌘'
  },
  {
    id: 'steadfast-guardian',
    name: 'Steadfast guardian',
    description: 'Protects teammates first and refuses to abandon a threatened ally.',
    prompt: 'A steadfast guardian who protects teammates first and refuses to abandon a threatened ally.',
    phrase: 'Stay close. I will protect you.',
    portraitMark: '◇'
  },
  {
    id: 'bold-champion',
    name: 'Bold champion',
    description: 'Faces danger with confidence and motivates the team to keep advancing.',
    prompt: 'A bold champion who faces danger with confidence and motivates the team to keep advancing.',
    phrase: 'Forward. We can still win!',
    portraitMark: '⚔'
  }
] as const;

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

export default function FreezonePanel({
  mainMenuOpen,
  displayPreferences,
  onOpenDisplaySettings
}: FreezonePanelProps) {
  const [hud, setHud] = useState<FreezoneHud | null>(null);
  const [open, setOpen] = useState(false);
  const activeFreezoneHudRef = useRef(false);
  const seenAllianceInvitationsRef = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [relationBusy, setRelationBusy] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('');
  const [quickUpgradeFeedback, setQuickUpgradeFeedback] = useState('');
  const [rooms, setRooms] = useState<FreezoneRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [feedback, setFeedback] = useState('');
  const [radioOpen, setRadioOpen] = useState(false);
  const [rankingCollapsed, setRankingCollapsed] = useState(false);
  const [activeShopTab, setActiveShopTab] = useState<FreezoneShopTab>('shop');
  const [upgradeModalStage, setUpgradeModalStage] = useState<FreezoneUpgradeModalStage>(null);
  const [allyNameDraft, setAllyNameDraft] = useState('');
  const [editingPieceId, setEditingPieceId] = useState('');
  const [compactLeaderboard, setCompactLeaderboard] = useState(
    () => (typeof window === 'undefined' ? false : shouldUseCompactFreezoneLeaderboard(window.innerWidth))
  );
  const [botsBusy, setBotsBusy] = useState(false);
  const [allyRole, setAllyRole] = useState<FreezoneAllyRole>('strategic');
  const [designMode, setDesignMode] = useState(false);
  const [pieceType, setPieceType] = useState<PieceType>('knight');
  const [pieceName, setPieceName] = useState('');
  const [pieceTitle, setPieceTitle] = useState('');
  const [armyCelebrationName, setArmyCelebrationName] = useState('');
  const [pieceDescription, setPieceDescription] = useState('');
  const [piecePersonality, setPiecePersonality] = useState('');
  const [pieceLanguage, setPieceLanguage] = useState('en-US');
  const [pieceAIVoice, setPieceAIVoice] = useState('alloy');
  const [pieceQwenVoice, setPieceQwenVoice] = useState('');
  const [pieceKokoroVoice, setPieceKokoroVoice] = useState('');
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
  const [aiVoiceMode, setAIVoiceMode] = useState<'tts' | 'fallback'>(
    () => readLocalSetting('freezone-ai-voice-mode') === 'fallback' ? 'fallback' : 'tts'
  );
  const [fallbackVoiceEngine, setFallbackVoiceEngine] = useState<'browser' | 'kokoro'>(() =>
    readLocalSetting('freezone-fallback-voice-engine') === 'kokoro' ? 'kokoro' : 'browser'
  );
  const [fallbackKokoroVoice, setFallbackKokoroVoice] = useState(() => {
    const saved = readLocalSetting('freezone-fallback-kokoro-voice');
    return FREEZONE_KOKORO_BROWSER_VOICE_IDS.has(saved) ? saved : 'af_heart';
  });
  const [aiAssistEnabled, setAIAssistEnabled] = useState(
    () => readLocalSetting('freezone-ai-assist-enabled') === 'true'
  );
  const [aiBotsEnabled, setAIBotsEnabled] = useState(
    () => readLocalSetting('freezone-ai-bots-enabled') === 'true'
  );
  const [aiMovementMode, setAIMovementMode] = useState<'provider' | 'local'>(() =>
    readLocalSetting('freezone-ai-movement-mode') === 'local' ? 'local' : 'provider'
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
  const [fallbackDialogueLanguage, setFallbackDialogueLanguage] = useState(() => {
    const saved = readLocalSetting('freezone-fallback-dialogue-language');
    return FREEZONE_AI_LANGUAGES.some(({ id }) => id === saved) ? saved : 'en-US';
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
  const [movementPayment, setMovementPayment] = useState<FreezoneUpgradePayment>('orb');
  const [selectedAcquisitionPatternId, setSelectedAcquisitionPatternId] = useState('');
  const [selectedPersonalityId, setSelectedPersonalityId] = useState('');
  const [slide, setSlide] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const localMusicUrl = useRef('');
  const aiVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const aiVoiceUrlRef = useRef('');
  const aiVoiceRequestIdRef = useRef(0);
  const aiVoiceAbortRef = useRef<AbortController | null>(null);
  const aiVoiceEnabledRef = useRef(aiVoiceEnabled);
  const aiVoiceModeRef = useRef(aiVoiceMode);
  const fallbackVoiceEngineRef = useRef(fallbackVoiceEngine);
  const voiceCooldowns = useRef(new Map<string, number>());

  const cancelPendingAIVoice = () => {
    aiVoiceRequestIdRef.current += 1;
    aiVoiceAbortRef.current?.abort();
    aiVoiceAbortRef.current = null;
    aiVoiceAudioRef.current?.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  };

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
        voiceModel: aiSettings.voiceModel,
        qwenVoice: aiSettings.qwenVoice,
        qwenLanguage: aiSettings.qwenLanguage,
        kokoroVoice: aiSettings.kokoroVoice
      }));
    } catch {}
  }, [aiSettings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'freezone-fallback-dialogue-language',
        fallbackDialogueLanguage
      );
    } catch {}
    window.dispatchEvent(new CustomEvent('wizard-chess-freezone-local-dialogue-settings', {
      detail: {
        enabled: aiSettings.dialogueEnabled,
        language: fallbackDialogueLanguage
      }
    }));
  }, [aiSettings.dialogueEnabled, fallbackDialogueLanguage]);

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
        'qwenVoice' in change || 'qwenLanguage' in change || 'kokoroVoice' in change ||
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
    const apiKeys = {
      openrouter: '', gemini: '', openai: '', deepseek: '', google: '', dashscope: '', kokoro: ''
    };
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
        : provider === 'openai-tts' ? 'openai'
          : provider === 'qwen3-tts' ? 'dashscope'
            : provider === 'kokoro' ? 'kokoro' : 'gemini'
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
      const request = {
        roomCode: currentRoomCode,
        playerToken,
        provider,
        model,
        apiKey,
        qwenVoice: aiSettings.qwenVoice,
        qwenLanguage: aiSettings.qwenLanguage,
        kokoroVoice: aiSettings.kokoroVoice
      };
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
    if (aiVoiceMode !== 'fallback' || fallbackVoiceEngine !== 'kokoro') return undefined;
    let active = true;
    void preloadFreezoneKokoroSpeech((message) => {
      if (active) setAIVoiceStatus(message);
    }).then(() => {
      if (active) setAIVoiceStatus('Kokoro model is ready on this device.');
    }).catch((error: unknown) => {
      if (active) {
        setAIVoiceStatus(error instanceof Error
          ? error.message
          : 'Kokoro model could not be prepared.');
      }
    });
    return () => {
      active = false;
    };
  }, [aiVoiceMode, fallbackVoiceEngine]);

  useEffect(() => {
    const speak = (
      pieceId: string,
      eventKey: VoiceEventKey,
      lines: PieceVoiceLines,
      language?: string
    ) => {
      if (!('speechSynthesis' in window)) return;
      const line = lines?.[eventKey];
      const voice = resolveFreezoneVoice(voices, selectedVoiceURI);
      const available = selectedVoiceURI ? Boolean(voice) : voices.length > 0;
      if (!shouldSpeakFreezoneVoice(voiceEnabled, line, available)) return;
      const cooldownKey = `${pieceId}:${eventKey}`;
      const now = Date.now();
      const cooldown = eventKey === 'vulnerable' ? 15000
        : eventKey === 'inspection' ? 12000
          : 500;
      if (now - (voiceCooldowns.current.get(cooldownKey) || 0) < cooldown) return;
      voiceCooldowns.current.set(cooldownKey, now);
      const utterance = new SpeechSynthesisUtterance(line.trim().slice(0, 120));
      utterance.lang = language || voice?.lang || navigator.language;
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
      language?: string;
      kokoroVoice?: string;
    }) => {
      const localFallback = aiVoiceMode === 'fallback';
      const localKokoro = localFallback && fallbackVoiceEngine === 'kokoro';
      if (localFallback) {
        if (!aiVoiceEnabled || !detail.text.trim()) return;
      } else if (!detail.roomCode ||
          !shouldRequestFreezoneAIVoice(
            aiVoiceEnabled, detail.text, detail.voiceId, aiSettings.voiceProvider
          )) return;
      const cooldownKey = `ai:${detail.dialogueId || detail.event || 'line'}:${detail.pieceId}`;
      const now = Date.now();
      if (now - (voiceCooldowns.current.get(cooldownKey) || 0) < 700) return;
      voiceCooldowns.current.set(cooldownKey, now);
      if (voiceCooldowns.current.size > 512) {
        const oldestKey = voiceCooldowns.current.keys().next().value;
        if (oldestKey) voiceCooldowns.current.delete(oldestKey);
      }
      const requestId = ++aiVoiceRequestIdRef.current;
      aiVoiceAbortRef.current?.abort();
      const controller = localFallback ? null : new AbortController();
      aiVoiceAbortRef.current = controller;
      aiVoiceAudioRef.current?.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      const reportRequestStatus = (message: string) => {
        if (aiVoiceRequestIdRef.current === requestId) setAIVoiceStatus(message);
      };
      const playGeneratedAudio = async (blob: Blob, readyMessage: string) => {
        if (aiVoiceRequestIdRef.current !== requestId) return;
        if (aiVoiceUrlRef.current) URL.revokeObjectURL(aiVoiceUrlRef.current);
        const url = URL.createObjectURL(blob);
        aiVoiceUrlRef.current = url;
        setAIVoiceReady(true);
        const audio = aiVoiceAudioRef.current;
        if (!audio) return;
        audio.src = url;
        audio.load();
        try {
          await audio.play();
          if (aiVoiceRequestIdRef.current === requestId) setAIVoiceStatus(readyMessage);
        } catch {
          if (aiVoiceRequestIdRef.current === requestId) {
            reportAIVoiceStatus('Audio is ready. Press “Play latest voice preview” to listen.');
          }
        }
      };
      void (async () => {
        if (!aiVoiceEnabledRef.current) return;
        if (localFallback) {
          if (aiVoiceModeRef.current !== 'fallback') return;
          if (localKokoro) {
            if (fallbackVoiceEngineRef.current !== 'kokoro') return;
            const pieceVoiceId = detail.kokoroVoice || '';
            const voiceId = FREEZONE_KOKORO_BROWSER_VOICE_IDS.has(pieceVoiceId)
              ? pieceVoiceId
              : fallbackKokoroVoice;
            const blob = await generateFreezoneKokoroSpeech(
              detail.text.trim().slice(0, 120),
              voiceId,
              reportRequestStatus
            );
            if (!aiVoiceEnabledRef.current || aiVoiceModeRef.current !== 'fallback' ||
                fallbackVoiceEngineRef.current !== 'kokoro' ||
                aiVoiceRequestIdRef.current !== requestId) return;
            await playGeneratedAudio(blob, 'Kokoro speech generated locally on this device.');
            return;
          }
          if (!('speechSynthesis' in window)) {
            reportAIVoiceStatus('Browser speech is unavailable for the selected fallback.');
            return;
          }
          if (!voices.length) {
            reportAIVoiceStatus('No browser voices are available on this device yet.');
            return;
          }
          const voice = resolveFreezoneVoice(voices, selectedVoiceURI);
          if (selectedVoiceURI && !voice) {
            reportAIVoiceStatus('The selected browser fallback voice is unavailable on this device.');
            return;
          }
          const utterance = new SpeechSynthesisUtterance(detail.text.trim().slice(0, 120));
          utterance.lang = detail.language || 'en-US';
          utterance.voice = voice || null;
          utterance.onend = () => {
            if (aiVoiceRequestIdRef.current === requestId) {
              setAIVoiceStatus('Browser fallback speech finished.');
            }
          };
          window.speechSynthesis.speak(utterance);
          return;
        }
        if (aiVoiceModeRef.current !== 'tts') return;
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
            language: detail.language,
            text: detail.text,
            kokoroVoice: detail.kokoroVoice
          }, controller?.signal);
          if (!aiVoiceEnabledRef.current || aiVoiceModeRef.current !== 'tts' ||
              aiVoiceRequestIdRef.current !== requestId) return;
          await playGeneratedAudio(blob, 'Character voice is ready.');
        } catch (error) {
          if (aiVoiceRequestIdRef.current !== requestId ||
              (error instanceof Error && error.name === 'AbortError')) return;
          const message = error instanceof TypeError && /failed to fetch/i.test(error.message)
            ? 'Generated voice is unavailable: the freezone-speech function has a deployment or CORS problem. AI movement and text are unaffected.'
            : error instanceof Error ? error.message : 'Character voice could not be generated.';
          reportAIVoiceStatus(message);
        }
      })().catch((error: unknown) => {
        if (aiVoiceRequestIdRef.current !== requestId ||
            (error instanceof Error && error.name === 'AbortError')) return;
        reportAIVoiceStatus(error instanceof Error
          ? error.message
          : 'Character voice could not be generated.');
      });
    };
    const handleVoice = (event: Event) => {
      const detail = (event as CustomEvent<{
        roomCode?: string;
        pieceId: string;
        event: VoiceEventKey;
        text?: string;
        voiceId?: string;
        language?: string;
        kokoroVoice?: string;
        voiceLines: PieceVoiceLines;
      }>).detail;
      if (!detail) return;
      if (!aiVoiceEnabled) {
        speak(detail.pieceId, detail.event, detail.voiceLines, detail.language);
      }
      if (detail.text) {
        queueGeneratedVoice({
          roomCode: detail.roomCode,
          pieceId: detail.pieceId,
          event: detail.event,
          text: detail.text,
          voiceId: detail.voiceId,
          language: detail.language,
          kokoroVoice: detail.kokoroVoice
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
        language?: string;
        kokoroVoice?: string;
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
  }, [
    aiSettings.kokoroVoice, aiSettings.voiceProvider, aiVoiceEnabled, aiVoiceMode,
    fallbackKokoroVoice, fallbackVoiceEngine, selectedVoiceURI, voiceEnabled, voices
  ]);

  useEffect(() => {
    cancelPendingAIVoice();
    aiVoiceEnabledRef.current = aiVoiceEnabled;
    aiVoiceModeRef.current = aiVoiceMode;
    fallbackVoiceEngineRef.current = fallbackVoiceEngine;
  }, [aiVoiceEnabled, aiVoiceMode, fallbackVoiceEngine]);

  useEffect(() => {
    try {
      window.localStorage.setItem('freezone-voice-enabled', String(voiceEnabled));
      window.localStorage.setItem('freezone-ai-voice-enabled', String(aiVoiceEnabled));
      window.localStorage.setItem('freezone-ai-voice-mode', aiVoiceMode);
      window.localStorage.setItem('freezone-ai-movement-mode', aiMovementMode);
      window.localStorage.setItem('freezone-fallback-voice-engine', fallbackVoiceEngine);
      window.localStorage.setItem('freezone-fallback-kokoro-voice', fallbackKokoroVoice);
      window.localStorage.setItem('freezone-voice-uri', selectedVoiceURI);
      window.localStorage.setItem('freezone-music-url', /^https?:\/\//i.test(musicSource) ? musicSource : '');
      window.localStorage.setItem('freezone-music-volume', String(musicVolume));
    } catch {
      setStatus('Browser storage is unavailable; audio preferences will last only for this visit.');
    }
    window.dispatchEvent(new CustomEvent('wizard-chess-freezone-ai-movement-mode', {
      detail: aiMovementMode
    }));
  }, [
    aiVoiceEnabled, aiVoiceMode, fallbackVoiceEngine, musicSource, musicVolume,
    aiMovementMode, fallbackKokoroVoice, selectedVoiceURI, voiceEnabled
  ]);

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
      const incomingInvitations = enabled && detail.isPlayer
        ? detail.freezoneAllianceInvitations.filter((invite) =>
          invite.status === 'pending' && invite.toSide === detail.playerSide)
        : [];
      const newInvitation = incomingInvitations.find((invite) =>
        !seenAllianceInvitationsRef.current.has(invite.id)
      );
      incomingInvitations.forEach((invite) =>
        seenAllianceInvitationsRef.current.add(invite.id)
      );
      if (newInvitation) {
        const senderName = detail.onlinePlayers.find((player) =>
          player.side === newInvitation.fromSide
        )?.name || `Team ${newInvitation.fromSide + 1}`;
        setNotice(`${senderName} invited your team to an alliance. Respond in the room ranking panel.`);
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 5000);
      }
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
    if (!hud?.pieceOptions.length) {
      setSelectedAcquisitionPatternId('');
      return;
    }
    setSelectedAcquisitionPatternId((current) =>
      hud.pieceOptions.some((pattern) => pattern.id === current)
        ? current
        : hud.pieceOptions[0].id
    );
  }, [hud?.pieceOptions]);

  useEffect(() => {
    if (!open) setUpgradeModalStage(null);
  }, [open]);

  useEffect(() => {
    if (!upgradeModalStage) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUpgradeModalStage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [upgradeModalStage]);

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
      if (upgradeModalStage === 'controlled-piece') {
        setUpgradeModalStage('army-replacement');
      }
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(pattern, replacementId);
      if (result.ok) {
        setPendingReplacement(null);
        setArmyCelebrationName(pattern.name);
        setStatus('');
        setUpgradeModalStage('army-celebration');
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
        language: speaker.language,
        kokoroVoice: speaker.kokoroVoice,
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
    qwenVoice: pieceQwenVoice,
    kokoroVoice: pieceKokoroVoice,
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

  const changeTeamRelation = async (
    targetSide: number,
    action: FreezoneRelationAction,
    invitationId = ''
  ) => {
    const change = window.wizardChess?.setFreezoneTeamRelation;
    if (!change) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    setRelationBusy(true);
    try {
      const result = await change(targetSide, action, invitationId);
      setStatus(result.ok
        ? action === 'invite' ? 'Alliance invitation sent.'
          : action === 'accept' ? 'Alliance accepted for both teams.'
            : action === 'decline' ? 'Alliance invitation declined.'
              : action === 'enemy' ? 'Mortal enemy declared.'
                : 'Team relation set to neutral.'
        : result.error || 'Could not change this team relation.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not change this team relation.');
    } finally {
      setRelationBusy(false);
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
        setUpgradeModalStage(null);
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
    setPieceQwenVoice(profile.qwenVoice || '');
    setPieceKokoroVoice(profile.kokoroVoice || '');
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
    cancelPendingAIVoice();
    for (const cooldownKey of voiceCooldowns.current.keys()) {
      if (cooldownKey.startsWith('ai:') && cooldownKey.endsWith(`:${editingPieceId}`)) {
        voiceCooldowns.current.delete(cooldownKey);
      }
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
        qwenVoice: pieceQwenVoice,
        kokoroVoice: pieceKokoroVoice,
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

  const playSpeechBlob = async (blob: Blob, successMessage: string) => {
    aiVoiceAudioRef.current?.pause();
    if (aiVoiceUrlRef.current) URL.revokeObjectURL(aiVoiceUrlRef.current);
    const url = URL.createObjectURL(blob);
    aiVoiceUrlRef.current = url;
    const audio = new Audio(url);
    aiVoiceAudioRef.current = audio;
    setAIVoiceReady(true);
    try {
      await audio.play();
      setStatus(successMessage);
    } catch {
      setStatus('Audio is ready, but playback was blocked by the browser.');
    }
  };

  const previewPieceVoice = async (lineText?: string) => {
    const text = lineText?.trim() ||
      pieceCatchphrase.trim() || voiceLines.move.trim() || voiceLines.entry.trim();
    if (!text) {
      setStatus('Add a public phrase or voice line before previewing.');
      return;
    }
    if (aiVoiceMode === 'fallback' && fallbackVoiceEngine === 'kokoro') {
      const voiceId = FREEZONE_KOKORO_BROWSER_VOICE_IDS.has(pieceKokoroVoice)
        ? pieceKokoroVoice
        : fallbackKokoroVoice;
      try {
        const blob = await generateFreezoneKokoroSpeech(
          text.slice(0, 120),
          voiceId,
          setStatus
        );
        await playSpeechBlob(blob, 'Kokoro preview played locally on this device.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Kokoro preview failed.');
      }
      return;
    }
    if (aiVoiceMode === 'tts') {
      const currentRoomCode = hud?.roomCode || roomCode;
      const playerToken = readLocalSetting('wizard_chess_token');
      if (!currentRoomCode || !playerToken) {
        setStatus('Join a Freezone room to test the selected TTS provider.');
        return;
      }
      const settings = getFreezoneAIRequestSettings();
      try {
        const blob = await testFreezoneSpeechService({
          roomCode: currentRoomCode,
          playerToken,
          provider: settings.voiceProvider,
          model: settings.voiceModel,
          apiKey: settings.voiceApiKey,
          voiceId: pieceAIVoice,
          language: pieceLanguage,
          qwenVoice: pieceQwenVoice || settings.qwenVoice,
          qwenLanguage: settings.qwenLanguage,
          kokoroVoice: pieceKokoroVoice || settings.kokoroVoice,
          text: text.slice(0, 120)
        });
        await playSpeechBlob(blob, 'Selected character voice preview played.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Selected voice preview failed.');
      }
      return;
    }
    if (!('speechSynthesis' in window)) {
      setStatus('Speech preview is not supported in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 120));
    utterance.lang = pieceLanguage;
    utterance.voice = resolveFreezoneVoice(voices, selectedVoiceURI) || null;
    window.speechSynthesis.speak(utterance);
    setStatus('Playing a local voice preview on this device only.');
  };

  const previewPieceVoiceLine = (lineText: string) => {
    const text = lineText.trim();
    if (!text) {
      setStatus('Enter a phrase before previewing it.');
      return;
    }
    if (!('speechSynthesis' in window)) {
      setStatus('Local phrase preview is not supported in this browser.');
      return;
    }
    const voice = resolveFreezoneVoice(voices, selectedVoiceURI);
    if (selectedVoiceURI && !voice) {
      setStatus('The selected browser voice is unavailable on this device.');
      return;
    }
    aiVoiceAudioRef.current?.pause();
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 120));
    utterance.lang = pieceLanguage || voice?.lang || navigator.language;
    utterance.voice = voice || null;
    utterance.onstart = () => setStatus('Playing this phrase with the local browser voice.');
    utterance.onerror = (event) => {
      setStatus(`Phrase preview failed: ${event.error || 'browser speech error'}.`);
    };
    setStatus('Starting local phrase preview…');
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  };

  const previewAIVoiceFallback = async () => {
    if (fallbackVoiceEngine === 'kokoro') {
      const voiceId = fallbackKokoroVoice;
      if (!FREEZONE_KOKORO_BROWSER_VOICE_IDS.has(voiceId)) {
        setAIVoiceStatus('Kokoro in the browser currently supports English voices only.');
        return;
      }
      try {
        const previewText = pieceCatchphrase.trim() || voiceLines.move.trim() ||
          voiceLines.entry.trim() || (fallbackDialogueLanguage === 'pt-BR'
            ? 'Olá, esta é uma prévia da voz.'
            : fallbackDialogueLanguage === 'es-ES'
              ? 'Hola, esta es una prueba de voz.'
              : 'Hello, this is a voice preview.');
        const blob = await generateFreezoneKokoroSpeech(
          previewText.slice(0, 120),
          voiceId,
          setAIVoiceStatus
        );
        if (aiVoiceUrlRef.current) URL.revokeObjectURL(aiVoiceUrlRef.current);
        const url = URL.createObjectURL(blob);
        aiVoiceUrlRef.current = url;
        setAIVoiceReady(true);
        const audio = aiVoiceAudioRef.current;
        if (audio) {
          audio.src = url;
          audio.load();
          await audio.play();
        }
        setAIVoiceStatus('Kokoro test voice played locally on this device.');
      } catch (error) {
        setAIVoiceStatus(error instanceof Error ? error.message : 'Kokoro test voice failed.');
      }
      return;
    }
    if (!('speechSynthesis' in window)) {
      setAIVoiceStatus('Browser speech is unavailable for the selected fallback.');
      return;
    }
    if (!voices.length) {
      setAIVoiceStatus('No browser voices are available on this device yet.');
      return;
    }
    const voice = resolveFreezoneVoice(voices, selectedVoiceURI);
    if (selectedVoiceURI && !voice) {
      setAIVoiceStatus('The selected browser fallback voice is unavailable on this device.');
      return;
    }
    const utterance = new SpeechSynthesisUtterance('A voz de fallback está funcionando.');
    utterance.lang = fallbackDialogueLanguage;
    utterance.voice = voice || null;
    window.speechSynthesis.speak(utterance);
    setAIVoiceStatus('Fallback voice preview is playing locally on this device.');
  };

  const purchaseUpgrade = async (
    type: FreezoneUpgrade,
    payment: FreezoneUpgradePayment = 'orb',
    showQuickFeedback = false
  ) => {
    if (showQuickFeedback) setQuickUpgradeFeedback('');
    const action = window.wizardChess?.upgradeFreezoneSkill;
    if (!action) {
      const message = 'Freezone is still starting. Try again in a moment.';
      setStatus(message);
      if (showQuickFeedback) setQuickUpgradeFeedback(message);
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(type, payment);
      const message = result.ok
        ? `${FREEZONE_UPGRADES.find((upgrade) => upgrade.type === type)?.label} upgraded with ${payment === 'xp' ? 'XP' : 'an orb'}.`
        : result.error || 'Could not purchase this upgrade.';
      setStatus(message);
      if (showQuickFeedback) setQuickUpgradeFeedback(message);
      if (result.ok) emitTeamVoiceEvent('upgrade');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not purchase this upgrade.';
      setStatus(message);
      if (showQuickFeedback) setQuickUpgradeFeedback(message);
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
  const whiteOrbXpCost = hud
    ? targetEnvelopeCost * (hud.economy.orbCosts.white ?? 0)
    : 0;
  const movementOrbXpCost = hud
    ? FREEZONE_MOVEMENT_ORB_COST * (hud.economy.orbCosts.movement ?? 0)
    : 0;
  const canBuyEnvelopeWithCurrentResources = Boolean(
    hud?.isPlayer && upgradeableEnvelopes.some((option) => {
      const cost = getFreezoneEnvelopeUpgradeCost(
        hud.envelopeRows,
        hud.envelopeCols,
        option.rows,
        option.cols
      );
      return hud.orbBalances.white >= cost ||
        hud.xp >= cost * (hud.economy.orbCosts.white ?? 0);
    })
  );
  const canBuyMovementOffsetWithCurrentResources = Boolean(
    hud?.isPlayer && hud.ownedPieces.length &&
    (hud.orbBalances.movement >= FREEZONE_MOVEMENT_ORB_COST ||
      hud.xp >= movementOrbXpCost)
  );
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
  const selectedAcquisitionPattern = hud?.pieceOptions.find(
    (pattern) => pattern.id === selectedAcquisitionPatternId
  );
  const selectedPersonality = FREEZONE_PERSONALITIES.find(
    (personality) => personality.id === selectedPersonalityId
  );
  const canAcquireArmyUnit = Boolean(
    hud?.isPlayer &&
    (hud.xp >= hud.xpCost || (hud.teamPieces.length > 0 && hud.xp >= hud.allyCost))
  );
  const upgradeXpCosts = hud ? {
    red: hud.economy.orbCosts.red ?? 0,
    blue: hud.economy.orbCosts.blue ?? 0,
    yellow: hud.economy.orbCosts.yellow ?? 0,
    purple: hud.economy.orbCosts.purple ?? 0,
    white: hud.economy.orbCosts.white ?? 0
  } : null;
  const defaultUpgradePayment = (type: FreezoneUpgrade): FreezoneUpgradePayment =>
    hud && hud.orbBalances[type] >= 1 ? 'orb' : 'xp';
  const openQuickUpgradeStage = (stage: Exclude<FreezoneUpgradeModalStage, null>) => {
    setStatus('');
    setActiveShopTab('shop');
    setUpgradeModalStage(stage);
    setOpen(true);
  };
  const openMovementOffsetControls = () => {
    setUpgradeModalStage(null);
    setActiveShopTab('shop');
    window.requestAnimationFrame(() => {
      document.getElementById('freezone-movement-shop')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    });
  };
  const acquireSelectedPattern = () => {
    if (!selectedAcquisitionPattern) {
      setStatus('No piece pattern is available right now.');
      return;
    }
    void acquirePiece({
      ...selectedAcquisitionPattern,
      appearance,
      name: pieceName.trim() || selectedAcquisitionPattern.name,
      title: pieceTitle.trim() || selectedAcquisitionPattern.title,
      catchphrase: pieceCatchphrase.trim() || selectedAcquisitionPattern.catchphrase,
      personality: piecePersonality.trim() || selectedPersonality?.prompt || selectedAcquisitionPattern.personality
    });
  };
  const purchaseEnvelopeUpgrade = async (payment: FreezoneUpgradePayment = 'orb') => {
    const action = window.wizardChess?.upgradeFreezoneEnvelope;
    if (!action) {
      setStatus('Freezone is still starting. Try again in a moment.');
      return;
    }
    setPurchaseBusy(true);
    try {
      const result = await action(effectiveTargetEnvelope.rows, effectiveTargetEnvelope.cols, payment);
      setStatus(result.ok
        ? `Movement envelope upgraded to ${effectiveTargetEnvelope.rows}×${effectiveTargetEnvelope.cols} with ${payment === 'xp' ? 'XP' : 'white orbs'}.`
        : result.error || 'Could not upgrade the movement envelope.');
      if (result.ok) emitTeamVoiceEvent('upgrade');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not upgrade the movement envelope.');
    } finally {
      setPurchaseBusy(false);
    }
  };
  const purchaseMovementOffset = async (
    row: number,
    col: number,
    payment: FreezoneUpgradePayment = movementPayment
  ) => {
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
        targetMovementA,
        payment
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

  const roomLeaderboard: FreezoneRoomRankingEntry[] = hud?.roomLeaderboard?.length
    ? hud.roomLeaderboard
    : (hud?.onlinePlayers || []).map((player, index) => ({
      ...player,
      position: index + 1,
      leader: index === 0,
      crown: index === 0
    }));
  const incomingTeamInvitations = hud?.isPlayer
    ? hud.freezoneAllianceInvitations.filter((invite) =>
      invite.status === 'pending' && invite.toSide === hud.playerSide)
    : [];
  const inspectedSide = inspectedPiece?.side;
  const inspectedRelation = inspectedSide !== undefined && hud
    ? hud.freezoneRelations.find((relation) =>
      (relation.sideA === hud.playerSide && relation.sideB === inspectedSide) ||
      (relation.sideB === hud.playerSide && relation.sideA === inspectedSide)
    )
    : undefined;
  const incomingAlliance = inspectedSide !== undefined
    ? incomingTeamInvitations.find((invite) => invite.fromSide === inspectedSide)
    : undefined;
  const outgoingAlliance = inspectedSide !== undefined && hud
    ? hud.freezoneAllianceInvitations.some((invite) =>
      invite.status === 'pending' &&
      invite.fromSide === hud.playerSide &&
      invite.toSide === inspectedSide
    )
    : false;
  const inspectedPlayer = inspectedSide !== undefined
    ? hud?.onlinePlayers.find((player) => player.side === inspectedSide)
    : undefined;

  return (
    <>
      {!mainMenuOpen && hud?.enabled ? (
        <>
          <aside
            className={`freezone-room-ranking ${compactLeaderboard ? 'compact' : ''} ${rankingCollapsed ? 'collapsed' : ''}`}
            aria-label="Freezone room ranking"
          >
            <div className="freezone-room-ranking-header">
              <strong>ROOM RANK</strong>
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
            {incomingTeamInvitations.map((invite) => (
              <div className="freezone-alliance-inbox" key={invite.id}>
                <span>
                  {hud.onlinePlayers.find((player) => player.side === invite.fromSide)?.name ||
                    `Team ${invite.fromSide + 1}`} invites your team to an alliance
                </span>
                <button
                  type="button"
                  disabled={relationBusy}
                  onClick={() => void changeTeamRelation(invite.fromSide, 'accept', invite.id)}
                >Accept</button>
                <button
                  type="button"
                  disabled={relationBusy}
                  onClick={() => void changeTeamRelation(invite.fromSide, 'decline', invite.id)}
                >Decline</button>
              </div>
            ))}
            {!rankingCollapsed && (
              <div className="freezone-room-ranking-list">
                {roomLeaderboard.length ? roomLeaderboard.map((player) => (
                  <div
                    key={player.side}
                    className={`freezone-room-ranking-row ${player.leader ? 'leader' : ''}`}
                  >
                    <span
                      className="freezone-room-ranking-position"
                      aria-label={`Place ${player.position || 1}`}
                    >
                      {player.position || 1}
                    </span>
                    <div className="freezone-room-ranking-details">
                      <div className="freezone-room-ranking-identity">
                        <span className="freezone-room-ranking-name" title={player.name}>
                          {player.name}
                        </span>
                        {player.crown && (
                          <span className="freezone-room-ranking-crown" aria-label="Rank leader">♛</span>
                        )}
                      </div>
                      <div className="freezone-room-ranking-stats">
                        <span className="freezone-room-ranking-metric kills">
                          <span aria-hidden="true">⚔</span> K {formatFreezoneRankingNumber(player.kills)}
                        </span>
                        <span className="freezone-room-ranking-metric xp">
                          <span aria-hidden="true">◆</span> XP {formatFreezoneRankingNumber(player.xp)}
                        </span>
                        <span className="freezone-room-ranking-metric orbs">
                          <span aria-hidden="true">●</span> Orb {formatFreezoneRankingNumber(player.orbsCollected)}
                        </span>
                        <span className="freezone-room-ranking-metric pieces">
                          <span aria-hidden="true">♟</span> {formatFreezoneRankingNumber(player.pieces)}
                        </span>
                        <span className="freezone-room-ranking-time">
                          {player.timeLabel || formatFreezoneSessionAge(player.sessionStartedAt || Date.now())}
                        </span>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="freezone-room-empty">No players online.</div>
                )}
              </div>
            )}
          </aside>
          {hud && upgradeXpCosts && (
            <FreezonePieceCooldowns
              pieces={hud.teamPieces}
              hud={hud}
              canAcquireArmyUnit={canAcquireArmyUnit}
              canBuyMobility={canBuyEnvelopeWithCurrentResources || canBuyMovementOffsetWithCurrentResources}
              purchaseBusy={purchaseBusy}
              upgradeXpCosts={upgradeXpCosts}
              feedback={quickUpgradeFeedback}
              onUpgrade={(type) => void purchaseUpgrade(type, defaultUpgradePayment(type), true)}
              onAcquire={() => openQuickUpgradeStage('acquire-choice')}
              onMobility={() => openQuickUpgradeStage('mobility')}
            />
          )}
          <div className="freezone-hud" aria-live="polite">
          {displayPreferences.freezoneStats && (
            <span className="freezone-hud-stats">
              XP {hud.xp} · Army {hud.pieces}/{hud.capacity} ·
              🔴 {hud.orbBalances.red} · 🔵 {hud.orbBalances.blue} ·
              🟡 {hud.orbBalances.yellow} · ⚪ {hud.orbBalances.white} ·
              🟣 {hud.orbBalances.purple} · 🟠 {hud.orbBalances.movement} ·
              🟢 {hud.orbBalances.bot} · Bots {hud.allies.length}
            </span>
          )}
          {displayPreferences.freezonePlayer && (
            <span className="freezone-hud-player">
              {hud.playerName}{hud.selectedPieceName ? ` · Selected: ${hud.selectedPieceName}` : ''}
            </span>
          )}
          {displayPreferences.freezoneOnlineRoster && (
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
          )}
          {displayPreferences.freezoneAdversaryBots && roomCode && hud.isPlayer && (
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
          {displayPreferences.freezoneRadio && (
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
          )}
          {displayPreferences.freezoneRadio && radioOpen && (
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
          {displayPreferences.freezonePieceShop && (
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
          )}
          <button
            type="button"
            className="hud-btn freezone-display-settings"
            aria-label="Open display settings"
            onClick={onOpenDisplaySettings}
          >
            ⚙ Display
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
                <FreezoneHudTimers
                  cooldownMs={hud.cooldownMs}
                  movesPerCycle={hud.movesPerCycle}
                  mutantZone={hud.mutantZone}
                />
                <span><strong>{(hud.cooldownDurationMs / 1000).toFixed(1)}s</strong> cooldown</span>
                <span><strong>{hud.envelopeRows}×{hud.envelopeCols}</strong> movement envelope</span>
                <span><strong>{Math.max(0, hud.stepBudget - hud.stepsUsed)}/{hud.stepBudget}</strong> unit steps left</span>
                {roomCode && (
                  <button type="button" onClick={() => void copyRoomCode()}>
                    Arena {roomCode} · Copy
                  </button>
                )}
              </div>
              <button
                type="button"
                className="freezone-upgrade-launch"
                onClick={() => setUpgradeModalStage('upgrades')}
              >
                Upgrade your army
                <span>View spheres, XP options, and movement upgrades</span>
              </button>
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
              <section id="freezone-movement-shop" className="freezone-movement-shop" aria-label="Unlock piece movement cards">
                <h3>Unlock movement cards</h3>
                <p className="freezone-hint">
                  A counts only extra offsets bought for the selected piece. Its standard movements stay free.
                  Changing an offset between drag, jump, and teleport replaces its type and does not increase A.
                  Each new offset costs {FREEZONE_MOVEMENT_ORB_COST} movement orb or {movementOrbXpCost} XP.
                </p>
                <div className="freezone-movement-controls">
                  <label>
                    Pay with
                    <select
                      value={movementPayment}
                      onChange={(event) => setMovementPayment(event.target.value as FreezoneUpgradePayment)}
                      disabled={!hud.isPlayer || purchaseBusy}
                    >
                      <option value="orb">Movement orbs · {hud.orbBalances.movement} available</option>
                      <option value="xp">XP · {hud.xp} available</option>
                    </select>
                  </label>
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
                      const canPayMovement = movementPayment === 'xp'
                        ? hud.xp >= movementOrbXpCost
                        : hud.orbBalances.movement >= FREEZONE_MOVEMENT_ORB_COST;
                      const canUnlock = hud.isPlayer && !purchaseBusy &&
                        canPayMovement &&
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
                            : `${movementKind} offset ${row}, ${col} · ${movementPayment === 'xp' ? `${movementOrbXpCost} XP` : `${FREEZONE_MOVEMENT_ORB_COST} movement orb`}`}
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
                  {aiSettings.voiceProvider === 'qwen3-tts' && (
                    <label>
                      Qwen voice for this piece
                      <select value={pieceQwenVoice} onChange={(event) => setPieceQwenVoice(event.target.value)}>
                        <option value="">Use AI & APIs default</option>
                        {FREEZONE_QWEN_VOICES.map(({ id, label }) => (
                          <option value={id} key={id}>{label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(aiSettings.voiceProvider === 'kokoro' ||
                    (aiVoiceMode === 'fallback' && fallbackVoiceEngine === 'kokoro')) && (
                    <label>
                      Kokoro voice for this piece
                      <select value={pieceKokoroVoice} onChange={(event) => setPieceKokoroVoice(event.target.value)}>
                        <option value="">Use selected Kokoro default</option>
                        {FREEZONE_KOKORO_VOICES
                          .filter(({ id }) => (aiVoiceMode === 'tts' &&
                            aiSettings.voiceProvider === 'kokoro') ||
                            FREEZONE_KOKORO_BROWSER_VOICE_IDS.has(id))
                          .map(({ id, label }) => (
                          <option value={id} key={id}>{label}</option>
                          ))}
                      </select>
                    </label>
                  )}
                  {aiSettings.voiceProvider !== 'qwen3-tts' &&
                    aiSettings.voiceProvider !== 'kokoro' &&
                    !(aiVoiceMode === 'fallback' && fallbackVoiceEngine === 'kokoro') && (
                    <label>
                      AI character voice for this piece
                      <select value={pieceAIVoice} onChange={(event) => setPieceAIVoice(event.target.value)}>
                        {FREEZONE_AI_VOICES.map(({ id, label }) => (
                          <option value={id} key={id}>{label}</option>
                        ))}
                      </select>
                    </label>
                  )}
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
                      <div className="freezone-voice-line" key={event.id}>
                        <label htmlFor={`voice-line-${event.id}`}>{event.label}</label>
                        <div className="freezone-voice-line-control">
                          <input
                            id={`voice-line-${event.id}`}
                            value={voiceLines[event.id as VoiceEventKey]}
                            maxLength={120}
                            onChange={(change) => setVoiceLines((current) => ({
                              ...current,
                              [event.id]: change.target.value.slice(0, 120)
                            }))}
                          />
                          <button
                            type="button"
                            className="freezone-voice-preview"
                            aria-label={`Preview ${event.label} voice line`}
                            title="Listen to this phrase with the local browser voice"
                            disabled={!voiceLines[event.id as VoiceEventKey].trim()}
                            onClick={() => previewPieceVoiceLine(voiceLines[event.id as VoiceEventKey])}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <rect x="9" y="3" width="6" height="12" rx="3" />
                              <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" />
                            </svg>
                          </button>
                        </div>
                      </div>
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
                      qwenVoice: pieceQwenVoice,
                      kokoroVoice: pieceKokoroVoice,
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
                        {aiSettings.voiceProvider === 'qwen3-tts' && (
                          <label>
                            Qwen voice
                            <select value={pieceQwenVoice} onChange={(event) => setPieceQwenVoice(event.target.value)}>
                              <option value="">Use AI & APIs default</option>
                              {FREEZONE_QWEN_VOICES.map(({ id, label }) => (
                                <option value={id} key={id}>{label}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {(aiSettings.voiceProvider === 'kokoro' ||
                          (aiVoiceMode === 'fallback' && fallbackVoiceEngine === 'kokoro')) && (
                          <label>
                            Kokoro voice
                            <select value={pieceKokoroVoice} onChange={(event) => setPieceKokoroVoice(event.target.value)}>
                              <option value="">Use selected Kokoro default</option>
                              {FREEZONE_KOKORO_VOICES
                                .filter(({ id }) => (aiVoiceMode === 'tts' &&
                                  aiSettings.voiceProvider === 'kokoro') ||
                                  FREEZONE_KOKORO_BROWSER_VOICE_IDS.has(id))
                                .map(({ id, label }) => (
                                <option value={id} key={id}>{label}</option>
                                ))}
                            </select>
                          </label>
                        )}
                        {aiSettings.voiceProvider !== 'qwen3-tts' &&
                          aiSettings.voiceProvider !== 'kokoro' &&
                          !(aiVoiceMode === 'fallback' && fallbackVoiceEngine === 'kokoro') && (
                          <label>
                            Character voice
                            <select value={pieceAIVoice} onChange={(event) => setPieceAIVoice(event.target.value)}>
                              {FREEZONE_AI_VOICES.map(({ id, label }) => (
                                <option value={id} key={id}>{label}</option>
                              ))}
                            </select>
                          </label>
                        )}
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
                        <button type="button" onClick={() => void previewPieceVoice()}>
                          Test selected voice
                        </button>
                        {FREEZONE_VOICE_EVENTS.map((event) => (
                          <div className="freezone-voice-line" key={event.id}>
                            <label htmlFor={`edit-voice-line-${event.id}`}>{event.label}</label>
                            <div className="freezone-voice-line-control">
                              <input
                                id={`edit-voice-line-${event.id}`}
                                value={voiceLines[event.id as VoiceEventKey]}
                                maxLength={120}
                                onChange={(change) => setVoiceLines((current) => ({
                                  ...current,
                                  [event.id]: change.target.value.slice(0, 120)
                                }))}
                              />
                              <button
                                type="button"
                                className="freezone-voice-preview"
                                aria-label={`Preview ${event.label} voice line`}
                                title="Listen to this phrase with the local browser voice"
                                disabled={!voiceLines[event.id as VoiceEventKey].trim()}
                                onClick={() => previewPieceVoiceLine(voiceLines[event.id as VoiceEventKey])}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <rect x="9" y="3" width="6" height="12" rx="3" />
                                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="freezone-profile-actions">
                        <button type="button" onClick={() => void previewPieceVoice()}>
                          Test selected voice
                        </button>
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
                        Pieces tagged “AI” may be moved by the assistant. Select one to take control; the AI then waits 20 seconds after your last move or selection before moving another piece.
                      </p>
                      <p className="freezone-hint">
                        Purchased and adversary bots take turns every 6–9 seconds when a legal move is ready. Existing army and piece cooldowns still apply.
                      </p>
                      <label>
                        Movement source
                        <select
                          value={aiMovementMode}
                          onChange={(event) => setAIMovementMode(
                            event.target.value as 'provider' | 'local'
                          )}
                        >
                          <option value="provider">AI provider</option>
                          <option value="local">Local fallback · no API</option>
                        </select>
                      </label>
                      {aiMovementMode === 'local' ? (
                        <p className="freezone-hint">
                          Uses a fast local legal-move strategy for AI-controlled pieces. Separate dialogue and speech settings still apply.
                        </p>
                      ) : (
                        <>
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
                        </>
                      )}
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
                        Local fallback and bot dialogue language
                        <select
                          value={fallbackDialogueLanguage}
                          onChange={(event) => setFallbackDialogueLanguage(event.target.value)}
                        >
                          {FREEZONE_AI_LANGUAGES.map(({ id, label }) => (
                            <option value={id} key={id}>{label}</option>
                          ))}
                        </select>
                      </label>
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
                        Enable generated character speech
                      </label>
                      <label className="freezone-local-toggle">
                        <input
                          type="checkbox"
                          checked={voiceEnabled}
                          disabled={aiVoiceEnabled}
                          onChange={(event) => setVoiceEnabled(event.target.checked)}
                        />
                        Enable local browser speech for custom piece phrases
                      </label>
                      {aiVoiceEnabled && (
                        <p className="freezone-hint">
                          Turn off generated speech to use custom phrases with the selected local browser voice.
                        </p>
                      )}
                      <label>
                        Speech source
                        <select
                          value={aiVoiceMode}
                          onChange={(event) => setAIVoiceMode(event.target.value as 'tts' | 'fallback')}
                        >
                          <option value="tts">AI TTS provider (default)</option>
                          <option value="fallback">Local fallback · browser or Kokoro</option>
                        </select>
                      </label>
                      {aiVoiceMode === 'fallback' ? (
                        <>
                          <label>
                            Local fallback engine
                            <select
                              value={fallbackVoiceEngine}
                              onChange={(event) => setFallbackVoiceEngine(
                                event.target.value as 'browser' | 'kokoro'
                              )}
                            >
                              <option value="browser">Browser voices</option>
                              <option value="kokoro">Kokoro-82M · local model</option>
                            </select>
                          </label>
                          <p className="freezone-hint">
                            Local fallback does not call a TTS API. Browser voices start quickly; Kokoro must generate audio on this device first.
                          </p>
                          {fallbackVoiceEngine === 'kokoro' ? (
                            <>
                              <label>
                                Kokoro fallback voice
                                <select
                                  value={fallbackKokoroVoice}
                                  onChange={(event) => setFallbackKokoroVoice(event.target.value)}
                                >
                                  {FREEZONE_KOKORO_VOICES
                                    .filter(({ id }) => FREEZONE_KOKORO_BROWSER_VOICE_IDS.has(id))
                                    .map(({ id, label }) => (
                                      <option value={id} key={id}>{label}</option>
                                    ))}
                                </select>
                              </label>
                              <p className="freezone-hint">
                                The browser model currently supports English voices. It downloads the open model on first use; later requests are local. Use the Kokoro server provider for Portuguese and Spanish.
                              </p>
                              <button type="button" onClick={() => void previewAIVoiceFallback()}>
                                Test Kokoro voice
                              </button>
                              <audio ref={aiVoiceAudioRef} onError={() => {
                                if (aiVoiceReady) setAIVoiceStatus('Kokoro audio could not be played.');
                              }} />
                            </>
                          ) : !('speechSynthesis' in window) ? (
                            <p className="freezone-hint">Browser speech is not supported on this device.</p>
                          ) : (
                            <>
                              <label>
                                Fallback browser voice
                                <select
                                  value={selectedVoiceURI}
                                  onChange={(event) => setSelectedVoiceURI(event.target.value)}
                                >
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
                              {!voices.length && (
                                <p className="freezone-hint">No browser voices are available yet.</p>
                              )}
                              <button
                                type="button"
                                disabled={!voices.length}
                                onClick={previewAIVoiceFallback}
                              >
                                Test fallback voice
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <label>
                            TTS provider
                            <select
                              value={aiSettings.voiceProvider}
                              onChange={(event) => updateAISpeechProvider(event.target.value as FreezoneSpeechProvider)}
                            >
                              <option value="gemini-live">Gemini Live</option>
                              <option value="gemini-tts">Gemini TTS</option>
                              <option value="openai-tts">OpenAI TTS</option>
                              <option value="google-tts">Google Cloud TTS</option>
                              <option value="qwen3-tts">Qwen3-TTS Flash</option>
                              <option value="kokoro">Kokoro-82M · self-hosted</option>
                            </select>
                          </label>
                          {aiSettings.voiceProvider === 'kokoro' ? (
                            <>
                              <label>
                                Default Kokoro voice
                                <select
                                  value={aiSettings.kokoroVoice}
                                  onChange={(event) => updateAISettings({ kokoroVoice: event.target.value })}
                                >
                                  {FREEZONE_KOKORO_VOICES.map(({ id, label }) => (
                                    <option value={id} key={id}>{label}</option>
                                  ))}
                                </select>
                              </label>
                              <p className="freezone-hint">
                                Kokoro is open-source. AI-generated lines use your Kokoro server; browser fallback is local and currently English-only. Configure KOKORO_TTS_URL and KOKORO_API_KEY in Supabase for AI TTS.
                              </p>
                            </>
                          ) : aiSettings.voiceProvider !== 'google-tts' &&
                            aiSettings.voiceProvider !== 'kokoro' && (
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
                          {aiSettings.voiceProvider === 'qwen3-tts' && (
                            <>
                              <label>
                                Default Qwen voice
                                <select
                                  value={aiSettings.qwenVoice}
                                  onChange={(event) => updateAISettings({ qwenVoice: event.target.value })}
                                >
                                  <option value="">Use each piece&apos;s voice</option>
                                  {FREEZONE_QWEN_VOICES.map(({ id, label }) => (
                                    <option value={id} key={id}>{label}</option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Qwen speech language
                                <select
                                  value={aiSettings.qwenLanguage}
                                  onChange={(event) => updateAISettings({ qwenLanguage: event.target.value })}
                                >
                                  <option value="piece">Use each piece&apos;s language</option>
                                  {FREEZONE_AI_LANGUAGES.map(({ id, label }) => (
                                    <option value={id} key={id}>{label}</option>
                                  ))}
                                </select>
                              </label>
                              <p className="freezone-hint">
                                Per-piece voice and language settings remain available in the designer and unit editor. A default selected here is used when a piece has no Qwen voice override; a language selected here overrides the piece language.
                              </p>
                            </>
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
                              {aiSettings.voiceProvider === 'kokoro' ? 'Test Kokoro server' : 'Test audio'}
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
                        </>
                      )}
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
          {hud && upgradeModalStage && (
            <div
              className="freezone-upgrade-modal-backdrop"
              onClick={() => setUpgradeModalStage(null)}
            >
              <section
                className="freezone-upgrade-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="freezone-upgrade-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="freezone-upgrade-modal-header">
                  <div>
                    <p className="freezone-eyebrow">FREEZONE PROGRESSION</p>
                    <h3 id="freezone-upgrade-title">
                      {upgradeModalStage === 'upgrades' ? 'Upgrade your army'
                        : upgradeModalStage === 'acquire-choice' ? 'Acquire an army unit'
                          : upgradeModalStage === 'army-unlocked' ? 'Your new army'
                            : upgradeModalStage === 'controlled-piece' ? 'Create your piece'
                              : upgradeModalStage === 'army-replacement' ? 'Replace a piece'
                                : upgradeModalStage === 'army-celebration' ? 'New army unlocked!'
                                  : upgradeModalStage === 'allied-bot' ? 'Recruit an allied bot'
                                    : upgradeModalStage === 'mobility' ? 'Choose a mobility upgrade'
                                      : 'Expand movement area'}
                    </h3>
                  </div>
                  <div className="freezone-upgrade-modal-actions">
                    <span className="freezone-upgrade-xp" aria-label={`${hud.xp} XP available`}>
                      <i aria-hidden="true">✦</i> {hud.xp} XP
                    </span>
                    <button
                      type="button"
                      className="freezone-upgrade-modal-close"
                      onClick={() => setUpgradeModalStage(null)}
                      aria-label="Close upgrades"
                    >
                      ×
                    </button>
                  </div>
                </header>

                {upgradeModalStage === 'upgrades' && (
                  <>
                    <p className="freezone-upgrade-modal-intro">
                      Light spheres are ready to buy. Gold-rimmed spheres are already active.
                      Choose a sphere to spend an orb, or use its XP option to keep your orb balance.
                    </p>
                    <div className="freezone-sphere-legend" aria-label="Sphere status legend">
                      <span><i className="owned" /> Active</span>
                      <span><i className="available" /> Available</span>
                      <span><i className="locked" /> Locked</span>
                    </div>
                    <div className="freezone-sphere-list">
                      <FreezoneUpgradeSphereRow
                        label="Move actions per cycle"
                        detail={`${hud.movesPerCycle} actions · Red ${hud.orbBalances.red}`}
                        color="red"
                        level={hud.upgradeLevels.red}
                        maxLevel={hud.upgradeLevelLimits.red}
                        canActivate={hud.isPlayer && hud.canUpgrade.red &&
                          (hud.orbBalances.red >= 1 || hud.xp >= (upgradeXpCosts?.red ?? 0))}
                        onActivate={() => void purchaseUpgrade('red', defaultUpgradePayment('red'))}
                        xpCost={upgradeXpCosts?.red ?? 0}
                        canBuyWithXp={hud.isPlayer && hud.canUpgrade.red &&
                          hud.xp >= (upgradeXpCosts?.red ?? 0)}
                        onBuyWithXp={() => void purchaseUpgrade('red', 'xp')}
                      />
                      <FreezoneUpgradeSphereRow
                        label="Movement steps per cycle"
                        detail={`${hud.stepBudget} steps · Blue ${hud.orbBalances.blue}`}
                        color="blue"
                        level={hud.upgradeLevels.blue}
                        maxLevel={hud.upgradeLevelLimits.blue}
                        canActivate={hud.isPlayer && hud.canUpgrade.blue &&
                          (hud.orbBalances.blue >= 1 || hud.xp >= (upgradeXpCosts?.blue ?? 0))}
                        onActivate={() => void purchaseUpgrade('blue', defaultUpgradePayment('blue'))}
                        xpCost={upgradeXpCosts?.blue ?? 0}
                        canBuyWithXp={hud.isPlayer && hud.canUpgrade.blue &&
                          hud.xp >= (upgradeXpCosts?.blue ?? 0)}
                        onBuyWithXp={() => void purchaseUpgrade('blue', 'xp')}
                      />
                      <FreezoneUpgradeSphereRow
                        label="Cooldown"
                        detail={`${(hud.cooldownDurationMs / 1000).toFixed(1)} sec · Yellow ${hud.orbBalances.yellow}`}
                        color="yellow"
                        level={hud.upgradeLevels.yellow}
                        maxLevel={hud.upgradeLevelLimits.yellow}
                        canActivate={hud.isPlayer && hud.canUpgrade.yellow &&
                          (hud.orbBalances.yellow >= 1 || hud.xp >= (upgradeXpCosts?.yellow ?? 0))}
                        onActivate={() => void purchaseUpgrade('yellow', defaultUpgradePayment('yellow'))}
                        xpCost={upgradeXpCosts?.yellow ?? 0}
                        canBuyWithXp={hud.isPlayer && hud.canUpgrade.yellow &&
                          hud.xp >= (upgradeXpCosts?.yellow ?? 0)}
                        onBuyWithXp={() => void purchaseUpgrade('yellow', 'xp')}
                      />
                      <FreezoneUpgradeSphereRow
                        label="Army capacity"
                        detail={`${hud.capacity}/${hud.maxCapacity} slots · Purple ${hud.orbBalances.purple}`}
                        color="purple"
                        level={hud.upgradeLevels.purple}
                        maxLevel={hud.upgradeLevelLimits.purple}
                        canActivate={hud.isPlayer && hud.canUpgrade.purple &&
                          (hud.orbBalances.purple >= 1 || hud.xp >= (upgradeXpCosts?.purple ?? 0))}
                        onActivate={() => void purchaseUpgrade('purple', defaultUpgradePayment('purple'))}
                        xpCost={upgradeXpCosts?.purple ?? 0}
                        canBuyWithXp={hud.isPlayer && hud.canUpgrade.purple &&
                          hud.xp >= (upgradeXpCosts?.purple ?? 0)}
                        onBuyWithXp={() => void purchaseUpgrade('purple', 'xp')}
                      />
                      <FreezoneUpgradeSphereRow
                        label="Acquire an army unit"
                        detail={`${hud.pieces}/${hud.capacity} controllable pieces · ${hud.xpCost} XP per piece`}
                        color="teal"
                        level={Math.min(hud.pieces, hud.capacity)}
                        maxLevel={hud.capacity}
                        canActivate={canAcquireArmyUnit}
                        onActivate={() => setUpgradeModalStage('acquire-choice')}
                      />
                      <FreezoneUpgradeSphereRow
                        label="Movement geometry"
                        detail={`${hud.envelopeRows}×${hud.envelopeCols} area · White ${hud.orbBalances.white} · Movement ${hud.orbBalances.movement}`}
                        color="white"
                        level={Math.min(hud.upgradeLevels.white, hud.upgradeLevelLimits.white)}
                        maxLevel={Math.max(1, hud.upgradeLevelLimits.white)}
                        canActivate={hud.isPlayer &&
                          (canBuyEnvelopeWithCurrentResources || canBuyMovementOffsetWithCurrentResources)}
                        onActivate={() => setUpgradeModalStage('mobility')}
                      />
                    </div>
                    <p className="freezone-upgrade-modal-footnote">
                      XP prices match the current price of the corresponding orb. Buying with an orb uses your stored balance.
                    </p>
                  </>
                )}

                {upgradeModalStage === 'acquire-choice' && (
                  <div className="freezone-acquisition-choices">
                    <p className="freezone-upgrade-modal-intro">
                      Choose how this unit joins your team. Controllable pieces use army capacity; allied bots use XP and act independently.
                    </p>
                    <button
                      type="button"
                      className="freezone-acquisition-card"
                      disabled={!hud.isPlayer || hud.xp < hud.xpCost || !hud.pieceOptions.length}
                      onClick={() => setUpgradeModalStage('army-unlocked')}
                    >
                      <span className="freezone-acquisition-icon controlled" aria-hidden="true">♞</span>
                      <span>
                        <strong>Controllable piece</strong>
                        <small>Create a piece for your army, then choose its movement.</small>
                      </span>
                      <b>{hud.xpCost} XP</b>
                    </button>
                    <button
                      type="button"
                      className="freezone-acquisition-card"
                      disabled={!hud.isPlayer || !hud.teamPieces.length || hud.xp < hud.allyCost}
                      onClick={() => setUpgradeModalStage('allied-bot')}
                    >
                      <span className="freezone-acquisition-icon bot" aria-hidden="true">✦</span>
                      <span>
                        <strong>Allied bot</strong>
                        <small>Choose its name and role. It moves independently and does not use a regular army slot.</small>
                      </span>
                      <b>{hud.allyCost} XP</b>
                    </button>
                    {hud.pieces >= hud.capacity && (
                      <p className="freezone-hint">
                        Your controllable army is full. You can replace a non-king piece when you acquire another.
                      </p>
                    )}
                    <button type="button" className="freezone-modal-back" onClick={() => setUpgradeModalStage('upgrades')}>
                      Back to upgrades
                    </button>
                  </div>
                )}

                {upgradeModalStage === 'army-unlocked' && (
                  <section className="freezone-army-unlocked">
                    <span className="freezone-army-unlocked-icon" aria-hidden="true">♞</span>
                    <p className="freezone-eyebrow">A NEW CHAPTER BEGINS</p>
                    <h4>Congratulations! Your new army is unlocked.</h4>
                    <p>Create a piece with its own name, role, appearance, and victory phrase.</p>
                    <button
                      type="button"
                      className="freezone-design-acquire"
                      onClick={() => setUpgradeModalStage('controlled-piece')}
                    >
                      Create your new army
                    </button>
                    <button
                      type="button"
                      className="freezone-modal-back"
                      onClick={() => setUpgradeModalStage('acquire-choice')}
                    >
                      Back
                    </button>
                  </section>
                )}

                {upgradeModalStage === 'controlled-piece' && (
                  <div className="freezone-controlled-piece-form">
                    <p className="freezone-upgrade-modal-intro">
                      Set up your piece, then create it when you are ready.
                    </p>
                    <div className="freezone-controlled-piece-fields">
                      <label>
                        Name
                        <input
                          value={pieceName}
                          maxLength={32}
                          placeholder={selectedAcquisitionPattern?.name || 'Name your piece'}
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
                        Appearance
                        <select value={appearance} onChange={(event) => setAppearance(event.target.value)}>
                          {FREEZONE_APPEARANCES.map((option) => (
                            <option value={option.id} key={option.id}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Victory phrase
                        <input
                          value={pieceCatchphrase}
                          maxLength={120}
                          placeholder={selectedAcquisitionPattern?.catchphrase || 'Victory is ours!'}
                          onChange={(event) => setPieceCatchphrase(event.target.value)}
                        />
                      </label>
                    </div>
                    {open && (
                      <FreezoneAppearancePreview
                        appearance={appearance}
                        label={FREEZONE_APPEARANCES.find((option) => option.id === appearance)?.label || appearance}
                      />
                    )}
                    <div className="freezone-controlled-piece-actions">
                      <button
                        type="button"
                        className="freezone-design-acquire"
                        disabled={!hud.isPlayer || purchaseBusy || !selectedAcquisitionPattern ||
                          hud.xp < hud.xpCost}
                        onClick={acquireSelectedPattern}
                      >
                        Create piece · {hud.xpCost} XP
                      </button>
                      <button
                        type="button"
                        className="freezone-modal-back"
                        onClick={() => setUpgradeModalStage('army-unlocked')}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}

                {upgradeModalStage === 'army-replacement' && pendingReplacement && (
                  <div className="freezone-replacement">
                    <p>
                      Your army is full. Choose a non-king piece to replace with {pendingReplacement.name}.
                      This costs {hud.xpCost} XP.
                    </p>
                    {hud.ownedPieces.map((piece) => (
                      <button
                        type="button"
                        key={piece.id}
                        disabled={purchaseBusy || piece.type === 'king'}
                        onClick={() => void acquirePiece(pendingReplacement, piece.id)}
                      >
                        Replace {piece.name}{piece.type === 'king' ? ' · King cannot be replaced' : ''}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setPendingReplacement(null);
                        setStatus('');
                        setUpgradeModalStage('controlled-piece');
                      }}
                    >
                      Back to piece details
                    </button>
                  </div>
                )}

                {upgradeModalStage === 'army-celebration' && (
                  <section className="freezone-army-celebration">
                    <div className="freezone-army-confetti" aria-hidden="true">
                      {Array.from({ length: 24 }, (_, index) => (
                        <i
                          key={index}
                          style={{
                            left: `${(index * 37) % 100}%`,
                            animationDelay: `${(index % 8) * 0.1}s`
                          }}
                        />
                      ))}
                    </div>
                    <span className="freezone-army-celebration-icon" aria-hidden="true">♞</span>
                    <p className="freezone-eyebrow">A NEW ALLY JOINS THE ARENA</p>
                    <h4>Congratulations! Your new army is ready.</h4>
                    <p>
                      <strong>{armyCelebrationName}</strong> has joined your team. Your new piece is ready to move.
                    </p>
                    <button
                      type="button"
                      className="freezone-design-acquire"
                      onClick={() => setUpgradeModalStage(null)}
                    >
                      Return to the game
                    </button>
                  </section>
                )}

                {upgradeModalStage === 'allied-bot' && (
                  <div className="freezone-allied-bot-form">
                    <p className="freezone-upgrade-modal-intro">
                      Allied bots have their own pieces and do not take a regular army slot.
                    </p>
                    <label>
                      Bot name (optional)
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
                    <div className="freezone-controlled-piece-actions">
                      <button
                        type="button"
                        className="freezone-design-acquire"
                        disabled={!hud.isPlayer || purchaseBusy || !hud.teamPieces.length ||
                          hud.xp < hud.allyCost}
                        onClick={() => void recruitAlly()}
                      >
                        Recruit bot · {hud.allyCost} XP
                      </button>
                      <button type="button" className="freezone-modal-back" onClick={() => setUpgradeModalStage('acquire-choice')}>
                        Back
                      </button>
                    </div>
                  </div>
                )}

                {upgradeModalStage === 'mobility' && (
                  <div className="freezone-mobility-choices">
                    <p className="freezone-upgrade-modal-intro">
                      Expand the area a piece can use, or add a specific movement offset.
                    </p>
                    <button
                      type="button"
                      className="freezone-acquisition-card"
                      disabled={!hud.isPlayer || !upgradeableEnvelopes.length}
                      onClick={() => setUpgradeModalStage('envelope')}
                    >
                      <span className="freezone-acquisition-icon geometry" aria-hidden="true">▦</span>
                      <span>
                        <strong>Increase movement area</strong>
                        <small>Choose a larger rows × columns envelope for configurable movement.</small>
                      </span>
                      <b>{FREEZONE_ENVELOPE_ORB_COST} white orbs / level</b>
                    </button>
                    <button
                      type="button"
                      className="freezone-acquisition-card"
                      disabled={!hud.isPlayer || !hud.ownedPieces.length ||
                        (hud.orbBalances.movement < FREEZONE_MOVEMENT_ORB_COST && hud.xp < movementOrbXpCost)}
                      onClick={openMovementOffsetControls}
                    >
                      <span className="freezone-acquisition-icon offset" aria-hidden="true">↗</span>
                      <span>
                        <strong>Unlock or change an offset</strong>
                        <small>Select a piece and choose drag, jump, or teleport for a movement card.</small>
                      </span>
                      <b>{FREEZONE_MOVEMENT_ORB_COST} movement orb / offset</b>
                    </button>
                    <button type="button" className="freezone-modal-back" onClick={() => setUpgradeModalStage('upgrades')}>
                      Back to upgrades
                    </button>
                  </div>
                )}

                {upgradeModalStage === 'envelope' && (
                  <div className="freezone-envelope-form">
                    <p className="freezone-upgrade-modal-intro">
                      Current area: {hud.envelopeRows}×{hud.envelopeCols}. Larger areas unlock more movement offsets.
                    </p>
                    <label>
                      New movement area
                      <select
                        value={`${effectiveTargetEnvelope.rows}x${effectiveTargetEnvelope.cols}`}
                        onChange={(event) => {
                          const [rows, cols] = event.target.value.split('x').map(Number);
                          setTargetEnvelope({ rows, cols });
                        }}
                        disabled={!upgradeableEnvelopes.length || purchaseBusy}
                      >
                        {upgradeableEnvelopes.map((option) => (
                          <option key={`${option.rows}x${option.cols}`} value={`${option.rows}x${option.cols}`}>
                            {option.rows}×{option.cols}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="freezone-controlled-piece-actions">
                      <button
                        type="button"
                        disabled={!hud.isPlayer || purchaseBusy || !upgradeableEnvelopes.length ||
                          hud.orbBalances.white < targetEnvelopeCost}
                        onClick={() => void purchaseEnvelopeUpgrade('orb')}
                      >
                        Spend {targetEnvelopeCost} white orb{targetEnvelopeCost === 1 ? '' : 's'}
                      </button>
                      <button
                        type="button"
                        className="freezone-design-acquire"
                        disabled={!hud.isPlayer || purchaseBusy || !upgradeableEnvelopes.length ||
                          hud.xp < whiteOrbXpCost}
                        onClick={() => void purchaseEnvelopeUpgrade('xp')}
                      >
                        Buy with XP · {whiteOrbXpCost} XP
                      </button>
                      <button type="button" className="freezone-modal-back" onClick={() => setUpgradeModalStage('mobility')}>
                        Back
                      </button>
                    </div>
                    {!upgradeableEnvelopes.length && <p className="freezone-hint">Movement area is already at its maximum.</p>}
                  </div>
                )}

                {status && <p className="freezone-upgrade-modal-status" role="status">{status}</p>}
              </section>
            </div>
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
          role="dialog"
          aria-label={`${inspectedPiece.name} profile`}
          style={{
            left: Math.max(8, Math.min(inspectedPiece.x + 14, window.innerWidth - 280)),
            top: Math.max(8, Math.min(inspectedPiece.y + 14, window.innerHeight - 300))
          }}
        >
          <button
            type="button"
            className="freezone-piece-card-close"
            aria-label="Close piece profile"
            onClick={() => setInspectedPiece(null)}
          >×</button>
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
          {hud?.isPlayer && inspectedSide !== undefined &&
            inspectedSide !== hud.playerSide && (
              <section className="freezone-piece-relations" aria-label="Team relations">
                <strong>
                  Team relation: {inspectedRelation?.status === 'ally'
                    ? 'Allied'
                    : inspectedRelation?.status === 'enemy' ? 'Mortal enemy' : 'Neutral'}
                </strong>
                {incomingAlliance && (
                  <div className="freezone-piece-relation-actions">
                    <button
                      type="button"
                      disabled={relationBusy}
                      onClick={() => void changeTeamRelation(
                        inspectedSide,
                        'accept',
                        incomingAlliance.id
                      )}
                    >Accept alliance</button>
                    <button
                      type="button"
                      disabled={relationBusy}
                      onClick={() => void changeTeamRelation(
                        inspectedSide,
                        'decline',
                        incomingAlliance.id
                      )}
                    >Decline</button>
                  </div>
                )}
                {outgoingAlliance && <span>Alliance invitation pending.</span>}
                {inspectedRelation?.status === 'ally' && (
                  <button
                    type="button"
                    disabled={relationBusy}
                    onClick={() => void changeTeamRelation(inspectedSide, 'neutral')}
                  >End alliance</button>
                )}
                {inspectedRelation?.status !== 'enemy' && (
                  <button
                    type="button"
                    disabled={relationBusy}
                    onClick={() => void changeTeamRelation(inspectedSide, 'enemy')}
                  >Declare mortal enemy</button>
                )}
                {inspectedRelation?.status === 'enemy' && (
                  <button
                    type="button"
                    disabled={relationBusy}
                    onClick={() => void changeTeamRelation(inspectedSide, 'neutral')}
                  >Return to neutral</button>
                )}
                {inspectedRelation?.status !== 'ally' &&
                  !incomingAlliance && !outgoingAlliance && (
                    inspectedPlayer?.bot
                      ? <span>AI teams cannot approve player invitations.</span>
                      : <button
                        type="button"
                        disabled={relationBusy || !inspectedPlayer}
                        onClick={() => void changeTeamRelation(inspectedSide, 'invite')}
                      >Invite to alliance</button>
                  )}
              </section>
            )}
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
