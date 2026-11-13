import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  FREEZONE_AI_LANGUAGES,
  FREEZONE_AI_VOICES,
  FREEZONE_APPEARANCES,
  FREEZONE_VOICE_EVENTS,
  FREEZONE_MAX_BOTS,
  FREEZONE_ARENA_FORMATS,
  FREEZONE_ROOM_CONFIG_VERSION,
  FREEZONE_ROOM_TAGS,
  applyFreezoneAllyPurchase,
  configureFreezoneBots,
  formatFreezoneSessionAge,
  getFreezoneSeatOccupancy,
  getFreezoneEliminationLeaders,
  getFreezonePlayerLeaderboard,
  getFreezoneRoomLeaderboard,
  FREEZONE_RECONNECT_GRACE_MS,
  expireFreezoneSessions,
  incrementFreezoneEliminations,
  mergeFreezoneRoomState,
  reconcileFreezonePresence,
  reclaimStaleFreezoneSeatClaims,
  resolveFreezoneVoice,
  sanitizeFreezoneAIHistory,
  shouldUseCompactFreezoneLeaderboard,
  sanitizeFreezoneAIDialogue,
  sanitizeFreezoneProfile,
  shouldSpeakFreezoneVoice,
  normalizeFreezoneArenaFormat,
  normalizeFreezoneRoomPublication,
  normalizeFreezoneRoomTheme
} from '../src/freezoneCustomization.js';
import {
  FREEZONE_EDITOR_DRAFT_VERSION,
  normalizeFreezoneEditorDraft,
  readFreezoneEditorDraft,
  validateFreezoneSceneLayout,
  writeFreezoneEditorDraft
} from '../src/freezoneDraft.js';
import {
  clearFreezoneAIKeys,
  getFreezoneAIRequestSettings,
  getFreezoneAISettings,
  updateFreezoneAISettings
} from '../src/freezoneAISettings.js';
import {
  FREEZONE_AI_IDLE_GRACE_MS,
  freezoneAICandidateId,
  hasFreezoneAIActions,
  normalizeFreezoneAIDecision,
  shouldRequestFreezoneAIVoice
} from '../src/freezoneAi.js';
import {
  FREEZONE_BOARD_SIZE,
  FREEZONE_ALLY_COST,
  FREEZONE_ALLY_ROLES,
  FREEZONE_BASE_ENVELOPE_COLS,
  FREEZONE_BASE_ENVELOPE_ROWS,
  FREEZONE_ENVELOPE_ORB_COST,
  FREEZONE_MOVEMENT_ORB_COST,
  FREEZONE_MUTANT_DURATION_MS,
  FREEZONE_ORB_TYPES,
  FREEZONE_ORB_TARGET_COUNT,
  FREEZONE_DEFAULT_ECONOMY,
  FREEZONE_DEFAULT_ORB_XP,
  FREEZONE_ALLY_XP_COST,
  applyFreezoneOrbCollection,
  applyFreezoneOrbPurchase,
  advanceFreezoneMutantZone,
  applyFreezoneMovementUnlock,
  canUpgradeFreezoneEnvelope,
  chooseFreezoneAllyMove,
  computeFreezoneMoves,
  createFreezoneMutantZone,
  generateFreezoneOrbPositions,
  getFreezoneArenaCellPosition,
  getFreezoneArenaCells,
  getFreezoneEnvelopeUpgradeCost,
  getFreezoneDraftPlayableLevels,
  getFreezoneTerrainScaleKeys,
  getFreezoneArenaSpawnPoint,
  getFreezoneEffectiveMovementEnvelope,
  isValidFreezoneCell,
  freezoneCapturePhase,
  freezoneFocusPose,
  freezoneMusicElapsedSeconds,
  getFreezoneEliminationXP,
  normalizeFreezoneMovementLimits,
  normalizeFreezoneEconomySettings,
  normalizeFreezoneOrbSettings,
  normalizeFreezoneWallet,
  resetExpiredFreezoneMoveCycle,
  normalizeFreezoneUnlockedMoves,
  normalizeFreezonePieceCooldowns,
  normalizeFreezoneMutantZone,
  validateFreezoneThumbnailUrl,
  validateFreezoneAudioFile,
  validateFreezoneAudioUrl
} from '../src/freezoneRules.js';

const ROOT = process.cwd();

test('Freezone publication metadata normalizes legacy configs and rejects unsafe thumbnail URLs', () => {
  const legacy = normalizeFreezoneRoomPublication(undefined, 'Legacy arena');
  assert.equal(legacy.version, FREEZONE_ROOM_CONFIG_VERSION);
  assert.equal(legacy.name, 'Legacy arena');
  assert.deepEqual(legacy.tags, []);
  assert.equal(legacy.thumbnailUrl, '');

  const publication = normalizeFreezoneRoomPublication({
    name: '  Community arena  ',
    description: '  Welcome! ',
    thumbnailUrl: 'https://example.test/arena.jpg',
    wallpaperUrl: 'https://example.test/wallpaper.jpg',
    tags: [FREEZONE_ROOM_TAGS[0], FREEZONE_ROOM_TAGS[0], 'unknown'],
    theme: {
      surface: '#ABC',
      edge: '#112233',
      team: '#ff00aa',
      wallpaperUrl: 'https://example.test/wallpaper.jpg'
    }
  });
  assert.equal(publication.name, 'Community arena');
  assert.equal(publication.description, 'Welcome!');
  assert.equal(publication.thumbnailUrl, 'https://example.test/arena.jpg');
  assert.equal(publication.wallpaperUrl, 'https://example.test/wallpaper.jpg');
  assert.deepEqual(publication.tags, [FREEZONE_ROOM_TAGS[0]]);
  assert.deepEqual(publication.theme, {
    surface: '#abc',
    edge: '#112233',
    team: '#ff00aa',
    wallpaperUrl: 'https://example.test/wallpaper.jpg'
  });
  assert.deepEqual(normalizeFreezoneRoomTheme({ surface: 'bad', edge: 'bad', team: 'bad' }), {
    surface: '#dcd3c2',
    edge: '#14171f',
    team: '#d4af37',
    wallpaperUrl: ''
  });
  assert.equal(normalizeFreezoneArenaFormat('triangle'), 'triangle');
  assert.equal(normalizeFreezoneArenaFormat('hexagonal'), 'hexagonal');
  assert.equal(normalizeFreezoneArenaFormat('unknown'), 'square');
  assert.equal(validateFreezoneThumbnailUrl('javascript:alert(1)').ok, false);
  assert.equal(validateFreezoneThumbnailUrl('https://user:pass@example.test/a.jpg').ok, false);
  assert.equal(validateFreezoneThumbnailUrl('https://example.test/a.jpg?token=secret').ok, false);
  assert.deepEqual(FREEZONE_ARENA_FORMATS.map((entry) => entry.id), ['square', 'triangle', 'hexagonal']);
});

test('Freezone triangle and hexagonal formats restrict valid cells and reject illegal moves', () => {
  assert.equal(isValidFreezoneCell(0, 0, 8, 'triangle'), true);
  assert.equal(isValidFreezoneCell(7, 7, 8, 'triangle'), false);
  assert.equal(isValidFreezoneCell(3, 2, 8, 'triangle'), true);
  assert.equal(isValidFreezoneCell(5, 5, 8, 'triangle'), false);
  assert.equal(isValidFreezoneCell(0, 0, 8, 'hexagonal'), true);
  assert.equal(isValidFreezoneCell(7, 7, 8, 'hexagonal'), true);
  assert.equal(isValidFreezoneCell(4, 4, 8, 'hexagonal'), true);
  assert.equal(isValidFreezoneCell(0, 7, 8, 'hexagonal'), false);

  const triangleCells = getFreezoneArenaCells(8, 'triangle');
  assert.ok(triangleCells.length > 0);
  assert.ok(triangleCells.every((cell) => isValidFreezoneCell(cell.r, cell.c, 8, 'triangle')));

  const hexCells = getFreezoneArenaCells(8, 'hexagonal');
  assert.ok(hexCells.length > 0);
  assert.ok(hexCells.every((cell) => isValidFreezoneCell(cell.r, cell.c, 8, 'hexagonal')));
  assert.ok(hexCells.length < 8 * 8);

  const triangleSpawn = getFreezoneArenaSpawnPoint(0, 8, 'triangle', 2);
  const hexSpawn = getFreezoneArenaSpawnPoint(0, 8, 'hexagonal', 2);
  assert.ok(isValidFreezoneCell(triangleSpawn.r, triangleSpawn.c, 8, 'triangle'));
  assert.ok(isValidFreezoneCell(hexSpawn.r, hexSpawn.c, 8, 'hexagonal'));

  const piece = { r: 3, c: 3, side: 0, moves: [[1, 0], [0, 1], [0, 5], [5, 0]], jumps: [], teleports: [], slide: false };
  const triangleMoves = computeFreezoneMoves(piece, {
    boardSize: 8,
    stepsRemaining: 1,
    arenaFormat: 'triangle',
    pieces: []
  });
  assert.ok(triangleMoves.some((move) => move.r === 4 && move.c === 3));
  assert.ok(!triangleMoves.some((move) => move.r === 3 && move.c === 8));

  const hexMoves = computeFreezoneMoves(piece, {
    boardSize: 8,
    stepsRemaining: 1,
    arenaFormat: 'hexagonal',
    pieces: []
  });
  assert.ok(hexMoves.some((move) => move.r === 4 && move.c === 3));
  assert.ok(!hexMoves.some((move) => move.r === 8 && move.c === 3));
  const hexEdgeMoves = computeFreezoneMoves({
    r: 0,
    c: 0,
    side: 0,
    moves: [[0, 1], [1, 0], [1, 1]],
    jumps: [],
    teleports: []
  }, {
    boardSize: 8,
    stepsRemaining: 1,
    arenaFormat: 'hexagonal',
    pieces: []
  });
  assert.ok(hexEdgeMoves.every((move) => isValidFreezoneCell(move.r, move.c, 8, 'hexagonal')));

  const orbPositions = generateFreezoneOrbPositions(8, ['3,3'], 20, () => 0.1, 'hexagonal');
  assert.ok(orbPositions.every((orb) => isValidFreezoneCell(orb.r, orb.c, 8, 'hexagonal')));
});

test('Freezone rules normalize orb rewards, movement limits, cooldowns and effective envelopes', () => {
  const legacyOrbs = normalizeFreezoneOrbSettings(null);
  assert.deepEqual(legacyOrbs.enabledTypes, FREEZONE_ORB_TYPES);
  assert.equal(legacyOrbs.xpByType.xp, 10);
  assert.equal(legacyOrbs.xpByType.red, 10);

  const orbSettings = normalizeFreezoneOrbSettings({
    enabledTypes: ['red', 'invalid', 'red'],
    xpByType: { red: 12.8, xp: -1, blue: 5000 }
  });
  assert.deepEqual(orbSettings.enabledTypes, ['red']);
  assert.equal(orbSettings.xpByType.red, 12);
  assert.equal(orbSettings.xpByType.xp, 0);
  assert.equal(orbSettings.xpByType.blue, 1000);

  const movementLimits = normalizeFreezoneMovementLimits({
    knight: { rows: 3, cols: 2 },
    pawn: { rows: 100, cols: 0 }
  });
  assert.deepEqual(movementLimits.knight, { rows: 3, cols: 2 });
  assert.deepEqual(movementLimits.pawn, { rows: 8, cols: 1 });
  assert.deepEqual(
    getFreezoneEffectiveMovementEnvelope(6, 5, movementLimits.knight),
    { rows: 3, cols: 2 }
  );
  const rookMoves = computeFreezoneMoves({
    r: 10,
    c: 10,
    side: 0,
    moves: [[0, 1]],
    jumps: [],
    teleports: [],
    slide: true
  }, {
    boardSize: 32,
    envelopeRows: getFreezoneEffectiveMovementEnvelope(6, 6, movementLimits.knight).rows,
    envelopeCols: getFreezoneEffectiveMovementEnvelope(6, 6, movementLimits.knight).cols,
    stepsRemaining: 8,
    pieces: []
  });
  assert.ok(rookMoves.some((move) => move.c === 12));
  assert.ok(!rookMoves.some((move) => move.c === 13));
  assert.deepEqual(
    normalizeFreezonePieceCooldowns({ king: 90000, pawn: -10 }).king,
    60000
  );
  assert.equal(normalizeFreezonePieceCooldowns({ king: 90000, pawn: -10 }).pawn, 0);
});

test('Freezone economy separates XP from orbs and applies expected initial rewards and prices', () => {
  assert.deepEqual(FREEZONE_DEFAULT_ORB_XP, {
    xp: 10,
    red: 10,
    blue: 10,
    yellow: 10,
    purple: 10,
    white: 10,
    bot: 10,
    movement: 10
  });
  assert.deepEqual(FREEZONE_DEFAULT_ECONOMY.orbCosts, {
    red: 200,
    blue: 200,
    yellow: 300,
    white: 400,
    purple: 500,
    movement: 250
  });
  assert.equal(FREEZONE_DEFAULT_ECONOMY.pieceCostXP, 100);
  assert.equal(FREEZONE_DEFAULT_ECONOMY.allyCostXP, 600);
  assert.deepEqual(
    Object.fromEntries(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'].map((type) =>
      [type, getFreezoneEliminationXP(type)]
    )),
    { pawn: 300, knight: 350, bishop: 350, rook: 400, queen: 450, king: 500 }
  );
  assert.deepEqual(normalizeFreezoneEconomySettings({}).orbCosts, FREEZONE_DEFAULT_ECONOMY.orbCosts);

  const migratedWallet = normalizeFreezoneWallet({
    xp: 40,
    orbBalances: { xp: 35, blue: 2, bot: 3 }
  });
  assert.equal(migratedWallet.xp, 40);
  assert.equal(Object.hasOwn(migratedWallet.orbBalances, 'xp'), false);
  assert.equal(migratedWallet.orbBalances.blue, 2);
  assert.equal(migratedWallet.orbBalances.bot, 3);

  const xpDust = applyFreezoneOrbCollection({}, 'xp', 10);
  assert.equal(xpDust.player.xp, 10);
  assert.equal(Object.values(xpDust.player.orbBalances).reduce((sum, amount) => sum + amount, 0), 0);
  const blueOrb = applyFreezoneOrbCollection(xpDust.player, 'blue', 10);
  assert.equal(blueOrb.player.xp, 20);
  assert.equal(blueOrb.player.orbBalances.blue, 1);
});

test('Freezone XP orb purchases enforce price and balance without negative currency', () => {
  const purchase = applyFreezoneOrbPurchase({ xp: 250 }, 'red');
  assert.equal(purchase.ok, true);
  assert.equal(purchase.cost, 200);
  assert.equal(purchase.player.xp, 50);
  assert.equal(purchase.player.orbBalances.red, 1);
  assert.equal(applyFreezoneOrbPurchase({ xp: 199 }, 'red').ok, false);
  assert.equal(applyFreezoneOrbPurchase({ xp: 1000 }, 'bot').ok, false);
  assert.equal(applyFreezoneOrbPurchase({ xp: -20 }, 'red').ok, false);
});

test('Freezone movement cards charge a separate orb and count only newly added offsets', () => {
  assert.deepEqual([FREEZONE_BASE_ENVELOPE_ROWS, FREEZONE_BASE_ENVELOPE_COLS], [1, 1]);
  assert.equal(FREEZONE_MOVEMENT_ORB_COST, 1);
  assert.equal(FREEZONE_ENVELOPE_ORB_COST, 2);
  assert.equal(canUpgradeFreezoneEnvelope(1, 1, 1, 2), true);
  assert.equal(getFreezoneEnvelopeUpgradeCost(1, 1, 1, 2), 2);
  assert.equal(getFreezoneEnvelopeUpgradeCost(1, 1, 2, 2), 4);
  assert.equal(canUpgradeFreezoneEnvelope(1, 1, 2, 2), true);
  assert.equal(canUpgradeFreezoneEnvelope(2, 2, 2, 3), true);

  const piece = {
    moves: [[0, 1]],
    jumps: [],
    teleports: [],
    unlockedMoves: []
  };
  const unlocked = applyFreezoneMovementUnlock(piece, 1, 0, 'jump');
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.addedOffset, true);
  assert.deepEqual(unlocked.piece.unlockedMoves, [[1, 0]]);
  assert.deepEqual(unlocked.piece.jumps, [[1, 0]]);

  const replaced = applyFreezoneMovementUnlock(unlocked.piece, 1, 0, 'teleport');
  assert.equal(replaced.ok, true);
  assert.equal(replaced.addedOffset, false);
  assert.equal(replaced.piece.moves.length, 2);
  assert.deepEqual(replaced.piece.jumps, []);
  assert.deepEqual(replaced.piece.teleports, [[1, 0]]);
  assert.equal(applyFreezoneMovementUnlock(replaced.piece, 1, 0, 'teleport').ok, false);
  assert.deepEqual(normalizeFreezoneUnlockedMoves([[1, 0], [1, 0], [5, 5]], replaced.piece.moves), [[1, 0]]);

  const inPlaceTeleport = applyFreezoneMovementUnlock(piece, 0, 0, 'teleport');
  assert.equal(inPlaceTeleport.ok, true);
  assert.deepEqual(inPlaceTeleport.piece.teleports, [[0, 0]]);

  const movementOnlyOrbs = generateFreezoneOrbPositions(
    8,
    [],
    4,
    () => 0.5,
    'square',
    ['movement']
  );
  assert.ok(movementOnlyOrbs.every((orb) => orb.type === 'movement'));

  const base = {
    freezonePlayers: { 0: { xp: 0, orbBalances: { movement: 0 }, aiBotsEnabled: false } },
    pieces: [{ id: 'piece', moves: [[0, 1]], jumps: [], teleports: [], unlockedMoves: [] }]
  };
  const local = {
    freezonePlayers: { 0: { xp: 0, orbBalances: { movement: 2 }, aiBotsEnabled: true } },
    pieces: [{
      ...base.pieces[0],
      moves: [[0, 1], [1, 0]],
      jumps: [[1, 0]],
      unlockedMoves: [[1, 0]]
    }]
  };
  const merged = mergeFreezoneRoomState(base, local, base);
  assert.equal(merged.freezonePlayers[0].orbBalances.movement, 2);
  assert.equal(merged.freezonePlayers[0].aiBotsEnabled, true);
  assert.deepEqual(merged.pieces[0].unlockedMoves, [[1, 0]]);
});

test('Freezone editor playtest accepts floors at any height and blocks erased cells', () => {
  const levels = getFreezoneDraftPlayableLevels(8, 'square', [
    { r: 3, c: 3, level: 0, kind: 'erase' },
    { r: 3, c: 3, level: 2, kind: 'floor' },
    { r: 4, c: 4, level: 1, kind: 'floor' },
    { r: 4, c: 4, level: 1, kind: 'wall' },
    { r: 8, c: 8, level: 2, kind: 'floor' },
    { r: 2, c: 2, level: 4, kind: 'floor' }
  ]);
  assert.deepEqual(levels.get('3,3'), [2]);
  assert.deepEqual(levels.get('4,4'), [0]);
  assert.deepEqual(levels.get('2,2'), [0]);
  assert.equal(levels.has('8,8'), false);
});

test('Freezone editor drafts normalize local data and preserve legacy format defaults', () => {
  const draft = normalizeFreezoneEditorDraft({
    terrainChanges: [
      { r: 2, c: 3, level: 1, kind: 'floor', color: '#AABBCC', rotationX: 90 },
      { r: 2, c: 3, level: 1, kind: 'wall' },
      { r: 40, c: 0, level: 0, kind: 'floor' },
      { r: 1, c: 1, level: 4, kind: 'erase' }
    ],
    draftOrbs: [
      { id: 'orb-one', r: 2, c: 3, level: 1 },
      { id: 'orb-bad', r: -1, c: 2, level: 0 }
    ],
    boundsSize: { width: 200, depth: 24, height: 7 },
    platformSize: 10,
    terrainLevel: 2,
    terrainColor: '#112233',
    arenaFormat: 'hexagonal'
  });

  assert.equal(draft.version, FREEZONE_EDITOR_DRAFT_VERSION);
  assert.equal(draft.arenaFormat, 'hexagonal');
  assert.deepEqual(draft.terrainChanges, [
    { r: 2, c: 3, level: 1, kind: 'wall' }
  ]);
  assert.deepEqual(draft.draftOrbs, [
    { id: 'orb-one', r: 2, c: 3, level: 1, type: 'xp' }
  ]);
  assert.deepEqual(draft.boundsSize, { width: 32, depth: 24, height: 7 });

  const legacy = normalizeFreezoneEditorDraft({ terrainChanges: [] });
  assert.equal(legacy.arenaFormat, 'square');
  assert.equal(normalizeFreezoneEditorDraft({ version: 999 }), null);
});

test('Freezone editor drafts round-trip through browser storage and preserve unsupported drafts', () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value)
  };
  const input = {
    arenaFormat: 'triangle',
    terrainChanges: [{ r: 5, c: 6, level: 2, kind: 'floor', color: '#123456' }],
    draftOrbs: [{ id: 'preview-orb', r: 5, c: 6, level: 2 }],
    boundsSize: { width: 40, depth: 36, height: 8 },
    platformSize: 5,
    terrainLevel: 2,
    terrainColor: '#abcdef',
    gizmoMode: 'scale'
  };

  assert.deepEqual(writeFreezoneEditorDraft(storage, input), { ok: true });
  const restored = readFreezoneEditorDraft(storage);
  assert.equal(restored.blocked, false);
  assert.deepEqual(restored.draft.terrainChanges, input.terrainChanges);
  assert.equal(restored.draft.arenaFormat, 'triangle');
  assert.equal(restored.draft.gizmoMode, 'scale');

  storage.setItem('wizard-chess.freezone-editor-draft.v1', '{"version":99}');
  const unsupported = readFreezoneEditorDraft(storage);
  assert.equal(unsupported.blocked, true);
  assert.equal(unsupported.draft, null);
  assert.match(unsupported.message, /newer version/);
});

test('Freezone published layouts accept supported ground tiles and reject unsupported geometry', () => {
  const supported = validateFreezoneSceneLayout({
    version: 1,
    boundsSize: { width: 32, depth: 32, height: 6 },
    terrainChanges: [
      { r: 2, c: 2, level: 0, kind: 'floor', color: '#123456' },
      { r: 3, c: 3, level: 0, kind: 'wall' },
      { r: 4, c: 4, level: 0, kind: 'erase' }
    ],
    draftOrbs: [{ id: 'custom-orb', r: 5, c: 5, level: 0 }]
  }, 32, 'square');
  assert.equal(supported.ok, true);
  assert.equal(supported.layout.orbs[0].id, 'custom-orb');
  assert.equal(supported.layout.terrainChanges.length, 3);

  assert.equal(validateFreezoneSceneLayout({
    version: 1,
    terrainChanges: [{ r: 2, c: 2, level: 1, kind: 'floor' }]
  }, 32, 'square').ok, false);
  assert.equal(validateFreezoneSceneLayout({
    version: 1,
    terrainChanges: [{ r: 1, c: 31, level: 0, kind: 'wall' }]
  }, 32, 'triangle').ok, false);
  assert.equal(validateFreezoneSceneLayout({
    version: 1,
    terrainChanges: [{ r: 2, c: 2, level: 0, kind: 'erase' }],
    orbs: [{ id: 'blocked-orb', r: 2, c: 2, level: 0 }]
  }, 32, 'square').ok, false);
});

test('Freezone terrain scaling snaps to the grid and excludes nonexistent arena cells', () => {
  const squareExpanded = getFreezoneTerrainScaleKeys(
    ['2,2,0', '2,3,0', '3,2,0', '3,3,0'],
    8,
    'square',
    1
  );
  assert.equal(squareExpanded.length, 9);
  assert.ok(squareExpanded.includes('4,4,0'));

  const triangleExpanded = getFreezoneTerrainScaleKeys(
    ['0,0,0', '0,1,0', '1,0,0'],
    8,
    'triangle',
    1
  );
  assert.ok(triangleExpanded.length > 0);
  assert.ok(triangleExpanded.every((key) => {
    const [r, c] = key.split(',').map(Number);
    return isValidFreezoneCell(r, c, 8, 'triangle');
  }));
  assert.deepEqual(
    getFreezoneTerrainScaleKeys(['2,2,0', '2,3,1'], 8, 'square', 1),
    []
  );
});

test('Freezone 3D preview and game engine share the same arena cell coordinates', () => {
  const cases = [
    { format: 'square', cell: { r: 4, c: 2 }, expected: { x: -1.5, z: 0.5 } },
    { format: 'triangle', cell: { r: 2, c: 3 }, expected: { x: 0.28, z: -1.35 } },
    {
      format: 'hexagonal',
      cell: { r: 2, c: 3 },
      expected: { x: Math.sqrt(3) * 0.225, z: -2.025 }
    }
  ];
  for (const { format, cell, expected } of cases) {
    const position = getFreezoneArenaCellPosition(cell.r, cell.c, 8, format);
    assert.ok(Math.abs(position.x - expected.x) < 1e-10);
    assert.ok(Math.abs(position.z - expected.z) < 1e-10);
  }
});

test('Simplified Single-Player HUD in src/App.tsx excludes speed sliders, notation script bar, and multiplayer lobby', () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');

  // Must include simplified game & camera controls
  for (const requiredId of [
    'btn-side-toggle',
    'btn-ai-move',
    'btn-reset',
    'camera-preset-select',
    'btn-hide-ui',
    'controls-hint',
    'captured-tray'
  ]) {
    assert.ok(appTsx.includes(`id="${requiredId}"`), `Missing required HUD control #${requiredId}`);
  }

  // Must NOT include camera speed sliders, script mode bar, or multiplayer lobby
  for (const forbiddenId of [
    'cam-speed-wrap',
    'input-cam-speed',
    'rot-speed-wrap',
    'input-rot-speed',
    'script-bar',
    'btn-script-modal',
    'btn-script-prev',
    'btn-script-next',
    'btn-lobby',
    'lobby-modal',
    'room-pill',
    'btn-checkmate-stepback'
  ]) {
    assert.ok(!appTsx.includes(forbiddenId), `Forbidden UI element #${forbiddenId} found in App.tsx`);
  }
});

test('Main menu orders multiplayer first and keeps mode actions out of the in-game controls', () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const menuStart = appTsx.indexOf('className={`main-menu-overlay');
  const menuEnd = appTsx.indexOf('className={`multiplayer-overlay', menuStart);
  const menu = appTsx.slice(menuStart, menuEnd);
  const controlsStart = appTsx.indexOf('id="hud-right"');
  const controlsEnd = appTsx.indexOf('id="hud-bottom"', controlsStart);
  const controls = appTsx.slice(controlsStart, controlsEnd);
  const optionOrder = [
    menu.indexOf('Multiplayer'),
    menu.indexOf('Freezone'),
    menu.indexOf('Test Mode'),
    menu.indexOf('Free Mode')
  ];

  assert.ok(menuStart >= 0 && menuEnd > menuStart);
  assert.ok(optionOrder.every((index) => index >= 0));
  assert.deepEqual(optionOrder, [...optionOrder].sort((a, b) => a - b));
  assert.ok(appTsx.includes('id="btn-main-menu"'));
  assert.ok(appTsx.includes('leaveCurrentGame()'));
  assert.ok(appTsx.includes("new Event('wizard-chess-open-freezone')"));
  assert.ok(appTsx.indexOf('<FreezonePanel mainMenuOpen={mainMenuOpen} />') >
    appTsx.indexOf('className={`main-menu-overlay'));
  for (const hiddenMode of ['Multiplayer', 'Free Mode', 'New Game', 'Mode Creator']) {
    assert.ok(!controls.includes(hiddenMode), `${hiddenMode} should not appear in in-game controls`);
  }
});

test('Camera views are selected from one control and preserve flip and free-look states', () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const engine = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  for (const preset of ['player', 'top', 'side', 'wide']) {
    assert.ok(appTsx.includes(`<option value="${preset}">`), `Missing camera option "${preset}"`);
  }
  assert.ok(appTsx.includes('id="camera-preset-select"'));
  assert.ok(engine.includes("setCameraPreset(event.currentTarget.value)"));
  assert.ok(engine.includes("setActiveCameraPreset('custom')"));
  assert.doesNotMatch(appTsx, /Flip View|btn-cam-flip/);
  assert.doesNotMatch(appTsx, /id="btn-cam-(player|top|side|wide)"/);
  assert.doesNotMatch(engine, /#btn-cam-(player|top|side|wide)/);
});

test('All 7 compressed 3D assets (.glb.gz.b64) decode and gunzip to valid glTF 2.0 binary models', () => {
  const expectedModels = [
    'option8_cathedral',
    'pawn_white',
    'rook_white',
    'knight_white',
    'bishop_white',
    'queen_white',
    'king_white'
  ];

  for (const name of expectedModels) {
    const b64Path = path.join(ROOT, 'public/assets/glb', `${name}.glb.gz.b64`);
    assert.ok(fs.existsSync(b64Path), `Missing 3D asset ${b64Path}`);
    const b64Text = fs.readFileSync(b64Path, 'utf-8').trim();
    assert.ok(b64Text.length > 1000, `Asset ${name}.glb.gz.b64 is unexpectedly small`);

    const gzBuf = Buffer.from(b64Text, 'base64');
    const glbBuf = zlib.gunzipSync(gzBuf);

    const magic = glbBuf.toString('ascii', 0, 4);
    const version = glbBuf.readUInt32LE(4);
    const totalLen = glbBuf.readUInt32LE(8);
    assert.equal(magic, 'glTF', `Invalid glTF magic header for ${name}`);
    assert.equal(version, 2, `Invalid glTF version for ${name}`);
    assert.equal(totalLen, glbBuf.length, `Mismatched glTF byte length for ${name}`);
  }
});

test('Freezone appearance selection and public profile are normalized for persistence', () => {
  assert.equal(FREEZONE_APPEARANCES.length, 10);
  const profile = sanitizeFreezoneProfile({
    appearance: 'dragon',
    name: '  Stanley  ',
    description: 'x'.repeat(200),
    personality: 'x'.repeat(300),
    language: 'invalid',
    aiVoice: 'invalid',
    voiceLines: { inspection: '  Welcome  ', unknown: 'ignored' }
  });
  assert.equal(profile.appearance, 'dragon');
  assert.equal(profile.name, 'Stanley');
  assert.equal(profile.description.length, 160);
  assert.equal(profile.personality.length, 240);
  assert.equal(profile.language, 'en-US');
  assert.equal(profile.aiVoice, 'alloy');
  assert.equal(profile.voiceLines.inspection, 'Welcome');
  assert.equal(profile.voiceLines.victory, '');
  assert.equal(sanitizeFreezoneProfile({ appearance: 'external-model' }).appearance, '');
  assert.ok(FREEZONE_AI_LANGUAGES.some(({ id }) => id === profile.language));
  assert.ok(FREEZONE_AI_VOICES.some(({ id }) => id === profile.aiVoice));
  assert.ok(FREEZONE_VOICE_EVENTS.some(({ id }) => id === 'move'));
  assert.ok(FREEZONE_VOICE_EVENTS.some(({ id }) => id === 'death'));
});

test('Freezone provider keys stay in session memory and Gemini Live is the default voice', () => {
  assert.equal(getFreezoneAISettings().textProvider, 'openrouter');
  assert.equal(getFreezoneAISettings().voiceProvider, 'gemini-live');
  assert.equal(getFreezoneAISettings().movementProvider, 'openrouter');
  assert.equal(getFreezoneAISettings().dialogueProvider, 'openrouter');
  updateFreezoneAISettings({
    textProvider: 'openrouter',
    voiceProvider: 'gemini-live',
    apiKeys: { openrouter: '', gemini: '', openai: '', deepseek: '', google: '' }
  });
  assert.equal(getFreezoneAISettings().voiceProvider, 'gemini-live');
  updateFreezoneAISettings({
    textProvider: 'openrouter',
    voiceProvider: 'openai-tts',
    apiKeys: { openrouter: 'openrouter-session-key', openai: 'openai-session-key' }
  });
  assert.equal(getFreezoneAIRequestSettings().textProvider, 'openrouter');
  assert.equal(getFreezoneAIRequestSettings().textApiKey, 'openrouter-session-key');
  assert.equal(getFreezoneAIRequestSettings().voiceProvider, 'openai-tts');
  assert.equal(getFreezoneAIRequestSettings().voiceApiKey, 'openai-session-key');
  clearFreezoneAIKeys();
  assert.equal(getFreezoneAIRequestSettings().textApiKey, '');
  assert.equal(getFreezoneAIRequestSettings().voiceApiKey, '');
  assert.equal(getFreezoneAISettings().apiKeys.google, '');
});

test('Freezone movement, dialogue, and speech providers have independent models and session keys', () => {
  updateFreezoneAISettings({
    movementProvider: 'deepseek',
    movementModel: 'deepseek-chat',
    dialogueProvider: 'gemini',
    dialogueModel: 'gemini-2.5-flash',
    dialogueEnabled: true,
    voiceProvider: 'openai-tts',
    voiceModel: 'gpt-4o-mini-tts',
    serviceApiKeys: {
      movement: 'movement-session-key',
      dialogue: 'dialogue-session-key',
      speech: 'speech-session-key'
    }
  });
  const request = getFreezoneAIRequestSettings();
  assert.equal(request.movementProvider, 'deepseek');
  assert.equal(request.movementModel, 'deepseek-chat');
  assert.equal(request.movementApiKey, 'movement-session-key');
  assert.equal(request.dialogueProvider, 'gemini');
  assert.equal(request.dialogueModel, 'gemini-2.5-flash');
  assert.equal(request.dialogueApiKey, 'dialogue-session-key');
  assert.equal(request.voiceProvider, 'openai-tts');
  assert.equal(request.voiceModel, 'gpt-4o-mini-tts');
  assert.equal(request.voiceApiKey, 'speech-session-key');

  clearFreezoneAIKeys();
  updateFreezoneAISettings({
    movementProvider: 'openrouter',
    movementModel: 'deepseek/deepseek-v4.1-flash',
    dialogueProvider: 'openrouter',
    dialogueModel: 'deepseek/deepseek-v4.1-flash',
    dialogueEnabled: true,
    voiceProvider: 'gemini-live',
    voiceModel: 'models/gemini-3.8-live'
  });
});

test('Freezone OpenRouter uses the Supabase secret by default with a paid model and free fallback', () => {
  const edge = fs.readFileSync(
    path.join(ROOT, 'supabase/functions/freezone-ai/index.ts'),
    'utf-8'
  );
  const panel = fs.readFileSync(path.join(ROOT, 'src/FreezonePanel.tsx'), 'utf-8');
  const speech = fs.readFileSync(
    path.join(ROOT, 'supabase/functions/freezone-speech/index.ts'),
    'utf-8'
  );
  const engine = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const styles = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf-8');

  assert.ok(edge.includes("openrouter: 'OPENROUTER_API_KEY'"));
  assert.ok(edge.includes("'https://openrouter.ai/api/v1/chat/completions'"));
  assert.ok(edge.includes("'deepseek/deepseek-v4.1-flash'"));
  assert.ok(edge.includes("'openrouter/free'"));
  assert.ok(edge.includes('dialogueProvider'));
  assert.ok(edge.includes('dialogueApiKey'));
  assert.ok(edge.includes('let dialogueError ='));
  assert.ok(edge.includes('dialogueError = error instanceof Error'));
  assert.ok(edge.includes('The text model returned no dialogue for this move.'));
  assert.ok(edge.includes('return jsonResponse({ moveId: decision.moveId, lines, dialogueError });'));
  assert.ok(edge.includes('Generate a test line for the friendly piece named'));
  assert.ok(edge.includes('pieceId: piece.id, text'));
  assert.ok(edge.includes("body.action === 'test'"));
  assert.ok(speech.includes("body.action === 'test'"));
  assert.ok(panel.includes("['api', 'AI & APIs']"));
  assert.ok(panel.includes('Test movement action'));
  assert.ok(panel.includes('Test text & bubble'));
  assert.ok(panel.includes('Test audio'));
  assert.ok(panel.includes('aiVoiceAudioRef.current.play()'));
  assert.ok(panel.includes('waitForFreezoneAITestResult(requestId, 90000)'));
  assert.ok(panel.includes('wizard-chess-freezone-ai-test-text'));
  assert.ok(engine.includes('wizard-chess-freezone-ai-test-text'));
  assert.ok(engine.includes('wizard-chess-freezone-ai-test'));
  assert.ok(engine.includes('Test move completed with'));
  const dialogueQueueStart = engine.indexOf('function queueFreezoneAIDialogue');
  const dialogueQueueEnd = engine.indexOf('function updateFreezoneSpeech', dialogueQueueStart);
  assert.ok(engine.slice(dialogueQueueStart, dialogueQueueEnd).includes('updateFreezoneSpeech();'));
  assert.ok(panel.includes('Use AI for my purchased bots'));
  assert.ok(panel.includes('serviceApiKeys.movement'));
  assert.ok(panel.includes('serviceApiKeys.dialogue'));
  assert.ok(panel.includes('serviceApiKeys.speech'));
  assert.ok(panel.includes('the freezone-speech function has a deployment or CORS problem'));
  assert.ok(panel.includes('AI movement and text are unaffected.'));
  assert.ok(styles.includes('.freezone-ai-status.is-ok'));
  assert.ok(styles.includes('.freezone-ai-status.is-error'));
  assert.ok(engine.includes('moveScope === \'bots\' ? !piece.freezoneAllyId'));
  assert.ok(engine.includes('scheduleFreezoneAIIdleAction'));
  assert.ok(engine.includes("wizard-chess-freezone-ai-bots"));
  assert.ok(edge.includes('Boolean(piece.allyId)'));
  assert.equal(FREEZONE_AI_IDLE_GRACE_MS, 20000);
});

test('Freezone room merge preserves synced profile and elimination fields', () => {
  const base = {
    pieces: [{ id: 'p1', r: 0, c: 0, eliminations: 0, appearance: 'frog', teleports: [] }],
    mutantZone: { id: 'zone-old', remainingMs: 180000 },
    mutantZoneInitialized: true,
    sharedMusicUrl: '',
    aiDialogue: null,
    aiHistory: [],
    eliminationRecords: [{ id: 'p1', eliminations: 1, name: 'Stanley' }]
  };
  const changed = {
    pieces: [{
      id: 'p1', r: 0, c: 1, eliminations: 2, appearance: 'dragon',
      description: 'Public profile', voiceLines: { victory: 'We won' },
      personality: 'Calm strategist', language: 'pt-BR', aiVoice: 'nova',
      moves: [[0, 0]], teleports: [[0, 0]]
    }],
    mutantZone: { id: 'zone-new', remainingMs: 179000 },
    sharedMusicUrl: 'https://example.test/arena.mp3',
    aiDialogue: {
      id: 'dialogue-1', createdAt: 1700000000000,
      lines: [{ pieceId: 'p1', text: 'Ready.' }]
    },
    aiHistory: [{
      id: 'dialogue-1:0', pieceId: 'p1', name: 'Stanley',
      side: 0, kind: 'exchange', text: 'Ready.', createdAt: 1700000000000
    }],
    xpOrbs: [],
    eliminationRecords: [{ id: 'p1', eliminations: 2, name: 'Stanley' }]
  };
  const current = {
    ...base,
    mutantZone: { id: 'zone-current', remainingMs: 178000 },
    eliminationRecords: [{ id: 'p1', eliminations: 3, name: 'Stanley' }]
  };
  const merged = mergeFreezoneRoomState(base, changed, current);
  assert.deepEqual(merged.pieces[0], changed.pieces[0]);
  assert.equal(merged.pieces[0].appearance, 'dragon');
  assert.equal(merged.pieces[0].personality, 'Calm strategist');
  assert.deepEqual(merged.pieces[0].teleports, [[0, 0]]);
  assert.equal(merged.pieces[0].eliminations, 2);
  assert.equal(merged.eliminationRecords[0].eliminations, 3);
  assert.equal(merged.mutantZone.id, 'zone-new');
  assert.equal(merged.sharedMusicUrl, 'https://example.test/arena.mp3');
  assert.deepEqual(merged.aiDialogue, changed.aiDialogue);
  assert.equal(merged.aiHistory.length, 1);
  assert.equal(merged.aiHistory[0].text, 'Ready.');
  assert.equal(sanitizeFreezoneAIHistory([{
    id: 'bad', pieceId: 'p1', text: 'x'.repeat(140), createdAt: 1
  }])[0].text.length, 120);
});

test('Freezone AI can only choose a legal candidate and optional speech respects local voice settings', () => {
  const candidate = {
    id: freezoneAICandidateId('piece-1', { r: 4, c: 4 }, { r: 3, c: 4 }, 'drag'),
    pieceId: 'piece-1',
    from: { r: 4, c: 4 },
    to: { r: 3, c: 4 },
    kind: 'drag',
    stepCost: 1
  };
  const decision = normalizeFreezoneAIDecision({
    moveId: candidate.id,
    lines: [
      { pieceId: 'piece-1', text: `  ${'a'.repeat(140)}  ` },
      { pieceId: 'enemy-piece', text: 'Not an allowed speaker.' }
    ]
  }, [candidate], ['piece-1']);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.candidate, candidate);
  assert.equal(decision.lines.length, 1);
  assert.equal(decision.lines[0].text.length, 120);
  assert.equal(normalizeFreezoneAIDecision({ moveId: 'invented' }, [candidate], ['piece-1']).ok, false);
  const oneSpeakerOnly = normalizeFreezoneAIDecision({
    moveId: candidate.id,
    lines: [
      { pieceId: 'piece-1', text: 'First line.' },
      { pieceId: 'piece-1', text: 'Second line.' }
    ]
  }, [candidate], ['piece-1']);
  assert.equal(oneSpeakerOnly.lines.length, 1);
  assert.equal(shouldRequestFreezoneAIVoice(false, 'Hello', 'alloy'), false);
  assert.equal(shouldRequestFreezoneAIVoice(true, 'Hello', 'unavailable'), false);
  assert.equal(shouldRequestFreezoneAIVoice(true, '   ', 'alloy'), false);
  assert.equal(shouldRequestFreezoneAIVoice(true, 'Hello', 'alloy'), true);
  assert.equal(shouldRequestFreezoneAIVoice(true, 'Hello', 'Kore', 'gemini-live'), true);

  const dialogue = sanitizeFreezoneAIDialogue({
    id: 'dialogue-2',
    createdAt: 1700000000000,
    lines: [
      { pieceId: 'piece-1', text: 'First line' },
      { pieceId: 'piece-2', text: 'Second line' },
      { pieceId: 'piece-3', text: 'Third line' }
    ]
  });
  assert.equal(dialogue.lines.length, 2);
  const staleSave = mergeFreezoneRoomState(
    { aiDialogue: null },
    { aiDialogue: null },
    { aiDialogue: dialogue }
  );
  assert.equal(staleSave.aiDialogue.id, 'dialogue-2');
});

test('Freezone AI teammate skips a resting or exhausted action cycle', () => {
  const now = 10_000;
  const readyPlayer = {
    movesPerCycle: 2,
    movesUsed: 1,
    stepBudget: 3,
    stepsUsed: 1,
    cooldownUntil: 0
  };
  assert.equal(hasFreezoneAIActions(readyPlayer, now), true);
  assert.equal(hasFreezoneAIActions({ ...readyPlayer, movesUsed: 2 }, now), false);
  assert.equal(hasFreezoneAIActions({ ...readyPlayer, stepsUsed: 3 }, now), false);
  assert.equal(hasFreezoneAIActions({ ...readyPlayer, cooldownUntil: now + 1 }, now), false);

  const engine = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const requestStart = engine.indexOf('async function requestFreezoneAITeammateAction');
  const requestEnd = engine.indexOf('function focusFreezonePiece', requestStart);
  const request = engine.slice(requestStart, requestEnd);
  assert.ok(request.indexOf('if (!hasFreezoneAIActions(player)) return;') <
    request.indexOf('requestFreezoneAIMove({'));
});

test('Concurrent Freezone pickup claims award an orb to only one side after room merge', () => {
  const base = {
    pieces: [],
    xpOrbs: [{ id: 'orb-one', r: 4, c: 4, type: 'xp' }],
    orbClaims: [],
    freezonePlayers: {
      0: { xp: 0, orbBalances: { xp: 0 } },
      1: { xp: 0, orbBalances: { xp: 0 } }
    }
  };
  const local = {
    ...base,
    xpOrbs: [],
    orbClaims: [{ orbId: 'orb-one', side: 0, type: 'xp', amount: 10, xpAmount: 10 }],
    freezonePlayers: {
      0: { xp: 10, orbBalances: { xp: 10 } },
      1: { xp: 0, orbBalances: { xp: 0 } }
    }
  };
  const current = {
    ...base,
    xpOrbs: [],
    orbClaims: [{ orbId: 'orb-one', side: 1, type: 'xp', amount: 10, xpAmount: 10 }],
    freezonePlayers: {
      0: { xp: 0, orbBalances: { xp: 0 } },
      1: { xp: 10, orbBalances: { xp: 10 } }
    }
  };
  const merged = mergeFreezoneRoomState(base, local, current);
  assert.equal(merged.freezonePlayers[0].xp + merged.freezonePlayers[1].xp, 10);
  assert.deepEqual(merged.orbClaims, current.orbClaims);
  assert.equal(merged.xpOrbs.length, 0);
});

test('Concurrent same-player Freezone orb synchronization does not duplicate its reward', () => {
  const base = {
    xpOrbs: [{ id: 'orb-one', r: 4, c: 4, type: 'red' }],
    orbClaims: [],
    freezonePlayers: { 0: { xp: 0, orbBalances: { red: 0 } } }
  };
  const collected = {
    ...base,
    xpOrbs: [],
    orbClaims: [{ orbId: 'orb-one', side: 0, type: 'red', amount: 1, xpAmount: 10 }],
    freezonePlayers: { 0: { xp: 10, orbBalances: { red: 1 } } }
  };
  const merged = mergeFreezoneRoomState(base, collected, collected);
  assert.equal(merged.freezonePlayers[0].xp, 10);
  assert.equal(merged.freezonePlayers[0].orbBalances.red, 1);
  assert.equal(merged.orbClaims.length, 1);
});

test('Concurrent bot-orb pickups synchronize the dedicated ally currency once', () => {
  const base = {
    xpOrbs: [{ id: 'green-orb', r: 4, c: 4, type: 'bot' }],
    orbClaims: [],
    freezonePlayers: {
      0: { orbBalances: { bot: 0 } },
      1: { orbBalances: { bot: 0 } }
    }
  };
  const local = {
    ...base,
    xpOrbs: [],
    orbClaims: [{ orbId: 'green-orb', side: 0, type: 'bot', amount: 1 }],
    freezonePlayers: { ...base.freezonePlayers, 0: { orbBalances: { bot: 1 } } }
  };
  const current = {
    ...base,
    xpOrbs: [],
    orbClaims: [{ orbId: 'green-orb', side: 1, type: 'bot', amount: 1 }],
    freezonePlayers: { ...base.freezonePlayers, 1: { orbBalances: { bot: 1 } } }
  };
  const merged = mergeFreezoneRoomState(base, local, current);
  assert.equal(merged.freezonePlayers[0].orbBalances.bot + merged.freezonePlayers[1].orbBalances.bot, 1);
  assert.deepEqual(merged.orbClaims, current.orbClaims);
  assert.equal(merged.xpOrbs.length, 0);
});

test('Freezone eliminations increment once and retain ties for the leaders display', () => {
  const first = { freeEliminations: 0 };
  const second = { freeEliminations: 1 };
  assert.equal(incrementFreezoneEliminations(first), 1);
  assert.equal(incrementFreezoneEliminations(first), 2);
  assert.equal(incrementFreezoneEliminations(second), 2);
  assert.deepEqual(getFreezoneEliminationLeaders([
    { id: 'a', name: 'A', eliminations: first.freeEliminations },
    { id: 'b', name: 'B', eliminations: second.freeEliminations }
  ]), {
    count: 2,
    leaders: [
      { id: 'a', name: 'A', eliminations: 2 },
      { id: 'b', name: 'B', eliminations: 2 }
    ]
  });
});

test('Concurrent Freezone elimination records pay XP and count the kill only once', () => {
  const base = {
    freezonePlayers: { 0: { xp: 0 }, 1: { xp: 0 } },
    eliminationRecords: [],
    eliminationRewards: []
  };
  const event = {
    id: 'capture:victim-1',
    side: 0,
    attackerPieceId: 'attacker-1',
    victimType: 'pawn',
    xp: 300
  };
  const updated = {
    ...base,
    freezonePlayers: { 0: { xp: 300 }, 1: { xp: 0 } },
    eliminationRecords: [{ id: 'attacker-1', side: 0, type: 'rook', eliminations: 1 }],
    eliminationRewards: [event]
  };
  const merged = mergeFreezoneRoomState(base, updated, updated);
  assert.equal(merged.freezonePlayers[0].xp, 300);
  assert.equal(merged.eliminationRewards.length, 1);
  assert.equal(merged.eliminationRecords[0].eliminations, 1);
});

test('Competing Freezone elimination synchronizations refund the losing XP and kill', () => {
  const base = {
    freezonePlayers: { 0: { xp: 0 }, 1: { xp: 0 } },
    eliminationRecords: [],
    eliminationRewards: []
  };
  const local = {
    ...base,
    freezonePlayers: { 0: { xp: 300 }, 1: { xp: 0 } },
    eliminationRecords: [{ id: 'attacker-0', side: 0, type: 'rook', eliminations: 1 }],
    eliminationRewards: [{
      id: 'capture:victim-1',
      side: 0,
      attackerPieceId: 'attacker-0',
      victimType: 'pawn',
      xp: 300
    }]
  };
  const current = {
    ...base,
    freezonePlayers: { 0: { xp: 0 }, 1: { xp: 300 } },
    eliminationRecords: [{ id: 'attacker-1', side: 1, type: 'bishop', eliminations: 1 }],
    eliminationRewards: [{
      id: 'capture:victim-1',
      side: 1,
      attackerPieceId: 'attacker-1',
      victimType: 'pawn',
      xp: 300
    }]
  };
  const merged = mergeFreezoneRoomState(base, local, current);
  assert.equal(merged.eliminationRewards.length, 1);
  assert.equal(merged.freezonePlayers[0].xp, 0);
  assert.equal(merged.freezonePlayers[1].xp, 300);
  assert.equal(merged.eliminationRecords.find((record) => record.side === 0).eliminations, 0);
  assert.equal(merged.eliminationRecords.find((record) => record.side === 1).eliminations, 1);
});

test('Freezone player leaderboard includes active players with zero eliminations', () => {
  assert.deepEqual(getFreezonePlayerLeaderboard(
    [{ id: 'piece-0', side: 0, eliminations: 2 }],
    [
      { token: 'player-0', name: 'Ari' },
      { token: 'player-1', name: 'Bia' },
      null
    ]
  ), [
    { side: 0, name: 'Ari', bot: false, eliminations: 2 },
    { side: 1, name: 'Bia', bot: false, eliminations: 0 }
  ]);
});

test('Freezone reconnect grace starts when presence detects departure, not stale last-seen time', () => {
  const now = 1_000_000;
  const active = {
    seats: [{ token: 'player-0', name: 'Ari', lastSeenAt: now - 10 * FREEZONE_RECONNECT_GRACE_MS }],
    pieces: [{ id: 'king-0', side: 0, r: 4, c: 4 }],
    freezonePlayers: { 0: { xp: 7, orbBalances: { xp: 3 } } },
    freezoneDepartures: {},
    eliminationRecords: [{ id: 'piece-0', side: 0, eliminations: 2 }],
    eliminatedSeats: []
  };

  assert.deepEqual(expireFreezoneSessions(active, now), active);

  const departed = reconcileFreezonePresence(active, [], now);
  assert.equal(departed.pieces.length, 0);
  assert.equal(departed.freezoneDepartures['player-0'].expiresAt,
    now + FREEZONE_RECONNECT_GRACE_MS);
  assert.equal(departed.seats[0].offlineSince, now);

  const reconnected = reconcileFreezonePresence(
    departed,
    [{ token: 'player-0', side: 0 }],
    now + FREEZONE_RECONNECT_GRACE_MS - 1
  );
  assert.deepEqual(reconnected.pieces, active.pieces);
  assert.deepEqual(reconnected.freezonePlayers[0], active.freezonePlayers[0]);
  assert.equal(reconnected.freezoneDepartures['player-0'], undefined);

  const expired = expireFreezoneSessions(departed, now + FREEZONE_RECONNECT_GRACE_MS);
  assert.equal(expired.seats[0], null);
  assert.deepEqual(expired.pieces, []);
  assert.equal(expired.freezonePlayers[0], undefined);
  assert.equal(expired.eliminationRecords.length, 0);
});

test('Freezone seat occupancy distinguishes online, reconnecting and stale claims', () => {
  const now = 2_000_000;
  const state = {
    seats: [
      { token: 'online', lastSeenAt: now - 10_000 },
      { token: 'recently-left', lastSeenAt: now - 90_000 },
      { token: 'reconnecting', lastSeenAt: now - 200_000, reconnectUntil: now + 30_000 },
      { token: 'stale', lastSeenAt: now - 5 * FREEZONE_RECONNECT_GRACE_MS },
      { token: 'legacy-stale' },
      { token: 'bot-seat', bot: true }
    ],
    freezoneDepartures: {
      reconnecting: { side: 2, expiresAt: now + 30_000 }
    }
  };
  assert.deepEqual(getFreezoneSeatOccupancy(state, now), {
    claimed: 6,
    online: 1,
    reconnecting: 2,
    bots: 1,
    staleClaims: 2,
    occupied: 4
  });

  const reclaimed = reclaimStaleFreezoneSeatClaims(state, ['online'], now);
  assert.deepEqual(
    reclaimed.seats.map((seat) => seat?.token || null),
    ['online', 'recently-left', 'reconnecting', null, null, 'bot-seat']
  );
});

test('Freezone presence and AI controls are wired with bots disabled by default', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const panel = fs.readFileSync(path.join(ROOT, 'src/FreezonePanel.tsx'), 'utf-8');
  const multiplayer = fs.readFileSync(path.join(ROOT, 'src/multiplayerSupabase.js'), 'utf-8');

  assert.ok(engine.includes('function handleFreezonePresenceChange(members)'));
  assert.ok(engine.includes('subscribeToFreezonePresence('));
  assert.ok(engine.includes('Their pieces are removed; they can reconnect for 3 minutes.'));
  assert.ok(engine.includes('botsEnabled: false'));
  assert.ok(engine.includes('setFreezoneBotsEnabled,'));
  assert.ok(engine.includes('async function buyFreezoneAlly(role, requestedName = \'\')'));
  assert.ok(engine.includes('chooseFreezoneAllyMove'));
  assert.ok(panel.includes('Recruit a robot'));
  assert.ok(panel.includes('className="freezone-hud-bots"'));
  assert.ok(engine.includes('let freezoneAIAssistEnabled = false;'));
  assert.ok(panel.includes("readLocalSetting('freezone-ai-assist-enabled') === 'true'"));
  assert.ok(panel.includes('Player elimination ranking'));
  assert.ok(multiplayer.includes(".on('presence', { event: 'join' }, publishPresence)"));
  assert.ok(multiplayer.includes(".on('presence', { event: 'leave' }, publishPresence)"));
  assert.ok(multiplayer.includes('getFreezoneSeatOccupancy'));
  assert.ok(multiplayer.includes('getFreezonePresenceSnapshot(room.id, playerToken)'));
  assert.ok(multiplayer.includes('reclaimStaleFreezoneSeatClaims'));
  assert.ok(panel.includes('Join / Rejoin'));
  assert.ok(panel.includes('stale claims to reclaim'));
});

test('Freezone adversary bots default off, fill no more than two free seats, and preserve human progress', () => {
  const initial = {
    botsEnabled: false,
    seats: [
      { token: 'human-0', name: 'Ari' },
      { token: 'human-1', name: 'Bia' },
      null,
      null
    ],
    pieces: [
      { id: 'human-king-0', side: 0 },
      { id: 'human-king-1', side: 1 }
    ],
    freezonePlayers: {
      0: {
        xp: 7,
        orbBalances: { bot: 2 },
        allies: [{ id: 'human-ally', pieceId: 'human-ally-piece', role: 'guardian' }]
      },
      1: { xp: 12 }
    },
    eliminationRecords: [],
    eliminatedSeats: []
  };
  const disabled = configureFreezoneBots(initial, false, 'ROOM');
  assert.equal(disabled.state.botsEnabled, false);
  assert.equal(disabled.state.seats.some((seat) => seat?.bot), false);

  const enabled = configureFreezoneBots(initial, true, 'ROOM');
  assert.equal(FREEZONE_MAX_BOTS, 2);
  assert.equal(enabled.state.seats.filter((seat) => seat?.bot).length, 2);
  assert.deepEqual(enabled.state.seats.slice(0, 2), initial.seats.slice(0, 2));
  assert.equal(enabled.addedSides.length, 2);

  const toggledOnAgain = configureFreezoneBots(enabled.state, true, 'ROOM');
  assert.equal(toggledOnAgain.addedSides.length, 0);
  assert.equal(toggledOnAgain.state.seats.filter((seat) => seat?.bot).length, 2);

  enabled.state.pieces.push({ id: 'bot-king', side: enabled.addedSides[0] });
  enabled.state.freezonePlayers[enabled.addedSides[0]] = { xp: 4 };
  const turnedOff = configureFreezoneBots(enabled.state, false, 'ROOM');
  assert.deepEqual(turnedOff.state.seats.slice(0, 2), initial.seats.slice(0, 2));
  assert.deepEqual(turnedOff.state.pieces, initial.pieces);
  assert.deepEqual(turnedOff.state.freezonePlayers, initial.freezonePlayers);
  assert.deepEqual(turnedOff.state.freezonePlayers[0].allies, initial.freezonePlayers[0].allies);
  assert.equal(turnedOff.state.seats.some((seat) => seat?.bot), false);
});

test('Freezone bot removal survives room merge and removes the bot avatar state', () => {
  const base = {
    botsEnabled: true,
    seats: [{ token: 'human-0' }, { token: 'bot:ROOM:1', bot: true }],
    pieces: [
      { id: 'human-king', side: 0, r: 5, c: 5 },
      { id: 'bot-king', side: 1, r: 7, c: 7 }
    ],
    freezonePlayers: { 0: { xp: 8 }, 1: { xp: 2 } },
    eliminationRecords: [],
    eliminatedSeats: [],
    orbClaims: []
  };
  const disabled = configureFreezoneBots(base, false, 'ROOM').state;
  const current = {
    ...base,
    pieces: base.pieces.map((piece) =>
      piece.id === 'bot-king' ? { ...piece, r: 8 } : piece
    )
  };
  const merged = mergeFreezoneRoomState(base, disabled, current);
  assert.equal(merged.botsEnabled, false);
  assert.deepEqual(merged.seats[0], base.seats[0]);
  assert.equal(merged.seats[1], null);
  assert.deepEqual(merged.pieces, [base.pieces[0]]);
  assert.equal(merged.freezonePlayers[0].xp, 8);
  assert.equal(merged.freezonePlayers[1], undefined);
});

test('Freezone allied bot recruitment costs XP directly and preserves legacy bot orbs', () => {
  const recruit = (player, id, role = 'strategic') => applyFreezoneAllyPurchase(player, {
    id,
    pieceId: `piece-${id}`,
    name: `Ally ${id}`,
    role
  });
  assert.equal(FREEZONE_ALLY_COST, 10);
  assert.equal(FREEZONE_ALLY_XP_COST, 600);
  assert.equal(FREEZONE_ALLY_ROLES.length, 5);
  const funded = { xp: 1800, orbBalances: { bot: 30 }, allies: [] };
  const first = recruit(funded, 'first');
  assert.equal(first.ok, true);
  assert.equal(first.player.xp, 1200);
  assert.equal(first.player.orbBalances.bot, 30);
  const second = recruit(first.player, 'second', 'guardian');
  const third = recruit(second.player, 'third', 'collector');
  assert.equal(third.ok, true);
  assert.equal(third.player.xp, 0);
  assert.equal(third.player.orbBalances.bot, 30);
  assert.equal(third.player.allies.length, 3);
  assert.equal(recruit({ xp: 599, orbBalances: { bot: 30 }, allies: [] }, 'poor').ok, false);
  assert.match(recruit(first.player, 'first').error, /already been recruited/);
});

test('Freezone collector seeks bot orbs while a guardian favors proximity to its king', () => {
  const strategic = chooseFreezoneAllyMove({
    role: 'strategic',
    piece: { id: 'strategist', side: 0, r: 5, c: 5 },
    moves: [{ r: 5, c: 6 }, { r: 4, c: 5 }],
    pieces: [{ id: 'strategist', side: 0, r: 5, c: 5 }],
    orbs: [{ r: 5, c: 7, type: 'bot' }]
  });
  assert.deepEqual(strategic, { r: 5, c: 6 });

  const collector = chooseFreezoneAllyMove({
    role: 'collector',
    piece: { id: 'collector', side: 0, r: 5, c: 5 },
    moves: [{ r: 5, c: 6 }, { r: 4, c: 5 }],
    pieces: [{ id: 'collector', side: 0, r: 5, c: 5 }],
    orbs: [
      { r: 5, c: 6, type: 'bot' },
      { r: 4, c: 5, type: 'xp' }
    ]
  });
  assert.deepEqual(collector, { r: 5, c: 6 });

  const guardian = chooseFreezoneAllyMove({
    role: 'guardian',
    piece: { id: 'guardian', side: 0, r: 5, c: 5 },
    moves: [{ r: 5, c: 6 }, { r: 4, c: 5 }],
    pieces: [
      { id: 'guardian', side: 0, r: 5, c: 5 },
      { id: 'king', side: 0, type: 'king', r: 5, c: 7 }
    ],
    orbs: []
  });
  assert.deepEqual(guardian, { r: 5, c: 6 });

  const defensive = chooseFreezoneAllyMove({
    role: 'defensive',
    piece: { id: 'defender', side: 0, r: 5, c: 5 },
    moves: [{ r: 5, c: 6 }, { r: 4, c: 5 }],
    pieces: [
      { id: 'defender', side: 0, r: 5, c: 5 },
      { id: 'king', side: 0, type: 'king', r: 5, c: 8 }
    ],
    orbs: []
  });
  assert.deepEqual(defensive, { r: 5, c: 6 });

  const offensive = chooseFreezoneAllyMove({
    role: 'offensive',
    piece: { id: 'attacker', side: 0, r: 5, c: 5 },
    moves: [{ r: 5, c: 6 }, { r: 4, c: 5 }],
    pieces: [
      { id: 'attacker', side: 0, r: 5, c: 5 },
      { id: 'target', side: 1, r: 4, c: 5 }
    ],
    orbs: []
  });
  assert.deepEqual(offensive, { r: 4, c: 5 });
});

test('Freezone ally purchase persists its roster and balance through room-state merge', () => {
  const base = {
    freezonePlayers: { 0: { xp: 600, orbBalances: { bot: 10 }, allies: [] } },
    pieces: [],
    xpOrbs: []
  };
  const purchase = applyFreezoneAllyPurchase(base.freezonePlayers[0], {
    id: 'ally-0-1',
    pieceId: 'piece-ally-0-1',
    name: 'Guardian 1',
    role: 'guardian'
  });
  const local = {
    ...base,
    freezonePlayers: { 0: purchase.player },
    pieces: [{
      id: 'piece-ally-0-1',
      side: 0,
      r: 2,
      c: 2,
      allyId: 'ally-0-1',
      allyRole: 'guardian'
    }]
  };
  const merged = mergeFreezoneRoomState(base, local, base);
  assert.equal(merged.freezonePlayers[0].xp, 0);
  assert.equal(merged.freezonePlayers[0].orbBalances.bot, 10);
  assert.equal(merged.freezonePlayers[0].allies[0].role, 'guardian');
  assert.equal(merged.pieces[0].allyId, 'ally-0-1');
});

test('Freezone room merge deduplicates allied bot records and keeps concurrent recruits', () => {
  const base = {
    freezonePlayers: { 0: { allies: [] } },
    pieces: [],
    xpOrbs: []
  };
  const localAlly = { id: 'local-ally', pieceId: 'local-piece', name: 'Guard', role: 'guardian' };
  const remoteAlly = { id: 'remote-ally', pieceId: 'remote-piece', name: 'Collector', role: 'collector' };
  const local = {
    ...base,
    freezonePlayers: { 0: { allies: [localAlly] } },
    pieces: [{ id: localAlly.pieceId, side: 0, r: 1, c: 1, allyId: localAlly.id }]
  };
  const current = {
    ...base,
    freezonePlayers: { 0: { allies: [remoteAlly] } },
    pieces: [{ id: remoteAlly.pieceId, side: 0, r: 2, c: 2, allyId: remoteAlly.id }]
  };
  const merged = mergeFreezoneRoomState(base, local, current);
  assert.deepEqual(
    merged.freezonePlayers[0].allies.map((ally) => ally.id).sort(),
    ['local-ally', 'remote-ally']
  );
  assert.equal(merged.pieces.length, 2);
});

test('Freezone concurrent re-recruit attempts with the same side roster slot merge once', () => {
  const base = {
    freezonePlayers: { 0: { xp: 1200, orbBalances: { bot: 10 }, allies: [] } },
    pieces: [],
    xpOrbs: []
  };
  const ally = { id: 'ally-0-1', pieceId: 'zone-ally-0-1', role: 'guardian', name: 'Guardian 1' };
  const purchase = applyFreezoneAllyPurchase(base.freezonePlayers[0], ally);
  const local = {
    ...base,
    freezonePlayers: { 0: purchase.player },
    pieces: [{ id: ally.pieceId, side: 0, r: 1, c: 1, allyId: ally.id, allyRole: ally.role }]
  };
  const remote = {
    ...base,
    freezonePlayers: { 0: applyFreezoneAllyPurchase(base.freezonePlayers[0], ally).player },
    pieces: [{ id: ally.pieceId, side: 0, r: 1, c: 1, allyId: ally.id, allyRole: ally.role }]
  };
  const merged = mergeFreezoneRoomState(base, local, remote);
  assert.equal(merged.freezonePlayers[0].xp, 600);
  assert.equal(merged.freezonePlayers[0].orbBalances.bot, 10);
  assert.equal(merged.freezonePlayers[0].allies.length, 1);
  assert.equal(merged.pieces.length, 1);
});

test('Freezone bot toggle reports a full room without replacing human seats', () => {
  const state = {
    botsEnabled: false,
    seats: [{ token: 'human-0' }, { token: 'human-1' }],
    pieces: [{ id: 'human-piece', side: 0 }]
  };
  const result = configureFreezoneBots(state, true, 'ROOM');
  assert.equal(result.ok, false);
  assert.match(result.error, /No empty seat/);
  assert.deepEqual(result.state.seats, state.seats);
});

test('Freezone speech remains silent when disabled or when a selected voice is missing', () => {
  const voices = [{ voiceURI: 'available', name: 'Available voice' }];
  assert.equal(resolveFreezoneVoice(voices, 'missing'), null);
  assert.equal(shouldSpeakFreezoneVoice(false, 'Hello', true), false);
  assert.equal(shouldSpeakFreezoneVoice(true, 'Hello', false), false);
  assert.equal(shouldSpeakFreezoneVoice(true, '', true), false);
  assert.equal(shouldSpeakFreezoneVoice(true, 'Hello', true), true);
});

test('Freezone drag, jump, teleport and envelope step budgets are evaluated independently', () => {
  assert.equal(FREEZONE_BOARD_SIZE, 64);
  assert.equal(canUpgradeFreezoneEnvelope(2, 2, 2, 3), true);
  assert.equal(canUpgradeFreezoneEnvelope(3, 3, 2, 4), false);

  const piece = { id: 'mover', side: 0, r: 10, c: 10, moves: [[0, 3], [2, 1], [3, -2], [0, 0]], jumps: [[2, 1]], teleports: [[3, -2], [0, 0]], slide: true };
  const drag = computeFreezoneMoves(piece, {
    envelopeRows: 3, envelopeCols: 3, stepsRemaining: 2, pieces: [piece]
  });
  assert.deepEqual(drag.filter((move) => move.kind === 'drag').map((move) => move.stepCost), [1, 2]);
  assert.deepEqual(drag.find((move) => move.kind === 'jump').path, [
    { r: 11, c: 10 }, { r: 12, c: 11 }
  ]);
  assert.equal(drag.find((move) => move.kind === 'teleport').path.length, 0);
  assert.equal(drag.some((move) => move.kind === 'teleport' && move.r === 10 && move.c === 10), true);

  const blockedJump = computeFreezoneMoves(piece, {
    envelopeRows: 3,
    envelopeCols: 3,
    stepsRemaining: 2,
    pieces: [piece, { id: 'blocker', side: 1, r: 11, c: 10 }]
  });
  assert.equal(blockedJump.some((move) => move.kind === 'jump'), false);
  assert.equal(blockedJump.some((move) => move.kind === 'teleport'), true);
});

test('Freezone movement and AI action budgets reset when the cooldown expires', () => {
  const restingPlayer = {
    movesUsed: 2,
    stepsUsed: 4,
    cooldownUntil: 5000,
    movedPieceIds: ['piece-a', 'piece-b']
  };
  assert.equal(resetExpiredFreezoneMoveCycle(restingPlayer, 4999), restingPlayer);
  assert.deepEqual(resetExpiredFreezoneMoveCycle(restingPlayer, 5000), {
    movesUsed: 0,
    stepsUsed: 0,
    cooldownUntil: 0,
    movedPieceIds: []
  });
});

test('Freezone mutant zone uses synchronized duration and expires without a replacement', () => {
  const zone = createFreezoneMutantZone(FREEZONE_BOARD_SIZE, () => 0);
  const nextMatchZone = createFreezoneMutantZone(FREEZONE_BOARD_SIZE, () => 0.2);
  assert.equal(zone.shape, 'diamond');
  assert.notEqual(zone.id, nextMatchZone.id);
  assert.equal(zone.remainingMs, FREEZONE_MUTANT_DURATION_MS);
  assert.equal(zone.active, true);
  const expired = advanceFreezoneMutantZone(zone, FREEZONE_MUTANT_DURATION_MS);
  assert.equal(expired.active, false);
  assert.equal(normalizeFreezoneMutantZone(expired), null);
});

test('Freezone orb population is spread across the larger map without occupying pieces', () => {
  let seed = 41;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const occupied = ['0,0', '31,31', '63,63'];
  const orbs = generateFreezoneOrbPositions(FREEZONE_BOARD_SIZE, occupied, FREEZONE_ORB_TARGET_COUNT, random);
  const cells = new Set(orbs.map(({ r, c }) => `${r},${c}`));
  assert.equal(orbs.length, 512);
  assert.equal(cells.size, orbs.length);
  assert.equal(orbs.some(({ r, c }) => occupied.includes(`${r},${c}`)), false);
  assert.ok(orbs.some(({ r, c }) => r < 32 && c < 32));
  assert.ok(orbs.some(({ r, c }) => r >= 32 && c >= 32));
  assert.equal(generateFreezoneOrbPositions(FREEZONE_BOARD_SIZE, [], 1, () => 0.95)[0].type, 'bot');
  const selectedOrbType = generateFreezoneOrbPositions(8, [], 12, () => 0.99, 'square', ['blue']);
  assert.equal(selectedOrbType.length, 12);
  assert.ok(selectedOrbType.every((orb) => orb.type === 'blue'));
  assert.deepEqual(generateFreezoneOrbPositions(8, [], 12, () => 0.99, 'square', []), []);
});

test('Freezone room merge refunds currency and configured XP for a losing orb claim', () => {
  const base = {
    freezonePlayers: {
      0: { xp: 5, orbBalances: { xp: 5, red: 0 } }
    },
    orbClaims: []
  };
  const local = {
    freezonePlayers: {
      0: { xp: 8, orbBalances: { xp: 8, red: 1 } }
    },
    orbClaims: [{ orbId: 'orb-red', side: 0, type: 'red', amount: 1, xpAmount: 3 }]
  };
  const current = {
    ...base,
    orbClaims: [{ orbId: 'orb-red', side: 1, type: 'red', amount: 1, xpAmount: 3 }]
  };

  const merged = mergeFreezoneRoomState(base, local, current);
  assert.equal(merged.freezonePlayers[0].xp, 5);
  assert.equal(Object.prototype.hasOwnProperty.call(merged.freezonePlayers[0].orbBalances, 'xp'), false);
  assert.equal(merged.freezonePlayers[0].orbBalances.red, 0);
  assert.equal(merged.orbClaims[0].side, 1);
});

test('Freezone shared audio accepts HTTP URLs and bounded MP3 files only', () => {
  assert.equal(validateFreezoneAudioUrl('https://example.test/music.mp3').ok, true);
  assert.equal(validateFreezoneAudioUrl('javascript:alert(1)').ok, false);
  assert.equal(validateFreezoneAudioUrl('https://user:password@example.test/music.mp3').ok, false);
  assert.equal(validateFreezoneAudioUrl('https://example.test/music.mp3?access_token=secret').ok, false);
  assert.equal(validateFreezoneAudioFile({ name: 'music.mp3', type: 'audio/mpeg', size: 1024 }).ok, true);
  assert.equal(validateFreezoneAudioFile({ name: 'movie.mp3', type: 'video/mp4', size: 1024 }).ok, false);
  assert.equal(validateFreezoneAudioFile({ name: 'large.mp3', type: 'audio/mpeg', size: 21 * 1024 * 1024 }).ok, false);
});

test('Freezone shared playback reports unstreamable URLs before syncing the room state', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'src/FreezonePanel.tsx'), 'utf-8');
  const toggleStart = panel.indexOf('const toggleMusic =');
  const toggleEnd = panel.indexOf('const toggleBots =', toggleStart);
  const toggle = panel.slice(toggleStart, toggleEnd);
  const startPlayback = toggle.indexOf('await audio.play();', toggle.indexOf('const nextPlaying'));
  const playbackError = toggle.indexOf('setStatus(getFreezoneAudioPlaybackError(error));', startPlayback);
  const syncPlayback = toggle.indexOf('const result = await action(nextPlaying);');

  assert.ok(startPlayback >= 0);
  assert.ok(playbackError > startPlayback && playbackError < syncPlayback);
  assert.ok(toggle.slice(playbackError, syncPlayback).includes('return;'));
  assert.ok(panel.includes('The server may offer it as a download'));
});

test('Freezone room merge synchronizes shared music playback and pause restores visual state', () => {
  const base = {
    sharedMusicUrl: 'https://example.test/radio.mp3',
    sharedMusicPlaying: false,
    sharedMusicStartedAt: 0
  };
  const started = mergeFreezoneRoomState(
    base,
    { ...base, sharedMusicPlaying: true, sharedMusicStartedAt: 1000 },
    base
  );
  assert.equal(started.sharedMusicUrl, base.sharedMusicUrl);
  assert.equal(started.sharedMusicPlaying, true);
  assert.equal(started.sharedMusicStartedAt, 1000);
  assert.equal(freezoneMusicElapsedSeconds(true, started.sharedMusicStartedAt, 6000), 5);

  const reconfigured = mergeFreezoneRoomState(
    base,
    base,
    { ...base, sharedMusicUrl: 'https://example.test/other.mp3', sharedMusicPlaying: false }
  );
  assert.equal(reconfigured.sharedMusicUrl, 'https://example.test/other.mp3');
  assert.equal(reconfigured.sharedMusicPlaying, false);

  const paused = mergeFreezoneRoomState(
    started,
    { ...started, sharedMusicPlaying: false, sharedMusicStartedAt: 0 },
    started
  );
  assert.equal(paused.sharedMusicPlaying, false);
  assert.equal(paused.sharedMusicStartedAt, 0);
  assert.equal(freezoneMusicElapsedSeconds(paused.sharedMusicPlaying, 1000, 6000), -1);

  const engine = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  assert.ok(engine.includes('float musicActive = step(0.0, uFreezoneMusicElapsed);'));
  assert.ok(engine.includes('transformed.y -= min(1.8, edgeElapsed * 0.006)'));
  assert.ok(engine.includes('vFreezoneMusicColorAmount = centerMask * musicActive;'));
  assert.ok(engine.includes('uniform float uFreezoneBoardSize;'));
  assert.ok(engine.includes('for (const uniform of customBoardMusicSizeUniforms) uniform.value = size;'));
  assert.ok(engine.includes('attribute float aFreezoneEdgeTile;'));
  assert.ok(engine.includes('float edgeMask = aFreezoneEdgeTile;'));
});

test('Freezone room merge preserves the current room scene configuration', () => {
  const base = {
    boardSize: 32,
    config: { boardSize: 32, sceneLayout: { version: 1, terrainChanges: [] } }
  };
  const staleLocal = {
    ...base,
    config: { boardSize: 32, sceneLayout: { version: 1, terrainChanges: [{ r: 1, c: 1 }] } }
  };
  const current = {
    ...base,
    config: { boardSize: 32, sceneLayout: { version: 1, terrainChanges: [{ r: 2, c: 2 }] } }
  };

  const merged = mergeFreezoneRoomState(base, staleLocal, current);
  assert.deepEqual(merged.config, current.config);
  assert.equal(merged.boardSize, current.config.boardSize);
});

test('Freezone capture animation has approach, strike and advance phases', () => {
  assert.equal(freezoneCapturePhase(0.1), 'approach');
  assert.equal(freezoneCapturePhase(0.4), 'strike');
  assert.equal(freezoneCapturePhase(0.8), 'advance');
  assert.equal(freezoneCapturePhase(1), 'complete');
});

test('Freezone camera keeps a comfortable distance when re-framing a moved piece', () => {
  const pose = freezoneFocusPose([0, 5, 10], [0, 0, 0], [8, 0.5, -4]);
  assert.deepEqual(pose.target, [8, 0.5, -4]);
  const distance = Math.hypot(
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2]
  );
  assert.ok(distance >= 9.5);
  assert.ok(pose.position[1] - pose.target[1] >= 2.8);
  assert.ok(pose.position.every(Number.isFinite));
});

test('Freezone room leaderboard includes only online players, keeps tied leaders together and counts zeroed stats', () => {
  const now = 1_700_000_000_000;
  const state = {
    botsEnabled: true,
    seats: [
      { token: 'alpha', name: 'Alpha' },
      { token: 'bravo', name: 'Bravo' },
      { token: 'charlie', name: 'Charlie', bot: true },
      { token: 'delta', name: 'Delta' }
    ],
    freezonePlayers: {
      0: { xp: 0, sessionStartedAt: now - 5 * 60 * 1000 },
      1: { xp: 7, sessionStartedAt: now - 12 * 60 * 1000 },
      2: { xp: 7, sessionStartedAt: now - 8 * 60 * 1000 },
      3: { xp: 0, sessionStartedAt: now - 4 * 60 * 1000 }
    },
    eliminationRecords: [
      { id: 'a1', side: 0, eliminations: 0 },
      { id: 'b1', side: 1, eliminations: 2 },
      { id: 'b2', side: 1, eliminations: 0 },
      { id: 'c1', side: 2, eliminations: 2 },
      { id: 'd1', side: 3, eliminations: 0 }
    ],
    orbClaims: [
      { side: 0, amount: 0 },
      { side: 1, amount: 3 },
      { side: 2, amount: 3 },
      { side: 3, amount: 0 }
    ],
    pieces: [
      { side: 0 },
      { side: 1 },
      { side: 1 },
      { side: 2 },
      { side: 2 },
      { side: 3 }
    ]
  };

  const ranking = getFreezoneRoomLeaderboard(
    state,
    [{ token: 'alpha' }, { token: 'bravo' }, { token: 'charlie' }],
    now
  );

  assert.deepEqual(ranking.map((entry) => entry.name), ['Bravo', 'Charlie', 'Alpha']);
  assert.deepEqual(ranking.map((entry) => entry.position), [1, 1, 3]);
  assert.equal(ranking[0].leader, true);
  assert.equal(ranking[1].leader, true);
  assert.equal(ranking[2].leader, false);
  assert.equal(ranking[2].kills, 0);
  assert.equal(ranking[2].xp, 0);
  assert.equal(ranking[2].orbsCollected, 0);
  assert.equal(ranking[2].pieces, 1);
});

test('Freezone room leaderboard counts kills once, uses collected orb totals and keeps session time after reconnects', () => {
  const now = 1_700_000_000_000;
  const state = {
    seats: [
      { token: 'solo', name: 'Solo' },
      { token: 'rival', name: 'Rival' }
    ],
    freezonePlayers: {
      0: { xp: 24, orbBalances: { red: 1, xp: 15 }, sessionStartedAt: now - 75 * 60 * 1000 },
      1: { xp: 9, orbBalances: { red: 0, xp: 9 }, sessionStartedAt: now - 30 * 60 * 1000 }
    },
    eliminationRecords: [
      { id: 'solo-1', side: 0, eliminations: 2 },
      { id: 'solo-2', side: 0, eliminations: 1 },
      { id: 'rival-1', side: 1, eliminations: 1 }
    ],
    orbClaims: [
      { side: 0, type: 'red', amount: 3, xpAmount: 2 },
      { side: 0, type: 'xp', amount: 8, xpAmount: 8 },
      { side: 1, type: 'red', amount: 1, xpAmount: 2 }
    ],
    pieces: [
      { side: 0 },
      { side: 0 },
      { side: 1 }
    ]
  };

  const ranking = getFreezoneRoomLeaderboard(state, [{ token: 'solo' }, { token: 'rival' }], now);
  const solo = ranking.find((entry) => entry.side === 0);
  const rival = ranking.find((entry) => entry.side === 1);
  assert.equal(solo.kills, 3);
  assert.equal(solo.xp, 24);
  assert.equal(solo.orbsCollected, 11);
  assert.equal(solo.pieces, 2);
  assert.equal(solo.timeLabel, '1 h 15 min');
  assert.equal(rival.orbsCollected, 1);
  assert.equal(formatFreezoneSessionAge(state.freezonePlayers[0].sessionStartedAt, now), '1 h 15 min');
});

test('Freezone leaderboard compact mode and session formatting stay predictable on small screens', () => {
  assert.equal(shouldUseCompactFreezoneLeaderboard(720), true);
  assert.equal(shouldUseCompactFreezoneLeaderboard(760), false);
  assert.equal(shouldUseCompactFreezoneLeaderboard(1024), false);
  assert.equal(formatFreezoneSessionAge(Date.now() - 5 * 60 * 1000, Date.now()), '5 min');
  assert.equal(formatFreezoneSessionAge(Date.now() - 2 * 60 * 60 * 1000 - 15 * 60 * 1000, Date.now()), '2 h 15 min');
});

test('Freezone shop stays open through repeated HUD updates', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'src/FreezonePanel.tsx'), 'utf-8');
  const styles = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf-8');
  const handlerStart = panel.indexOf('const handleFreezoneState =');
  const handlerEnd = panel.indexOf('const handleOpenArena =', handlerStart);
  const handler = panel.slice(handlerStart, handlerEnd);

  assert.ok(handler.includes('activeFreezoneHudRef.current'));
  assert.ok(handler.includes('if (enabled !== wasEnabled) setOpen(false)'));
  assert.ok(!handler.includes('if (detail?.enabled) setOpen(false)'));
  assert.ok(panel.includes("['shop', 'Shop']"));
  assert.ok(panel.includes("['bots', 'My bots']"));
  assert.ok(panel.includes("['resources', 'Resources']"));
  assert.ok(panel.includes("['profile', 'My profile']"));
  assert.ok(panel.includes('window.speechSynthesis.speak(utterance)'));
  assert.ok(panel.includes('Enable local speech for piece voice lines on this device'));
  assert.ok(panel.includes('Text bubbles can appear while speech is off.'));
  assert.ok(panel.includes('Unit profile updated without a purchase.'));
  assert.ok(styles.includes('.freezone-shop-nav'));
  assert.ok(styles.includes('@media (max-width: 420px)'));
  assert.ok(styles.includes('.freezone-piece-cooldowns'));
});

test('Freezone selection persists for repeat moves and entry camera focuses the player team', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const selectionStart = engine.indexOf('selectedFreePieceId = hitPiece.freeId;', engine.indexOf('function handleCustomModeClick'));
  const selectionEnd = engine.indexOf('if (!hitSquare)', selectionStart);
  const selection = engine.slice(selectionStart, selectionEnd);

  assert.ok(selection.includes('showSquareHighlights(hitPiece.r, hitPiece.c, customMovesForPiece(hitPiece))'));
  assert.ok(!selection.includes('focusFreezonePiece(hitPiece)'));
  const focusStart = engine.indexOf('function focusFreezoneTeamOnEntry()');
  const focusEnd = engine.indexOf('function advanceCustomTurn()', focusStart);
  const focusOnEntry = engine.slice(focusStart, focusEnd);
  assert.ok(focusOnEntry.includes('focusFreezonePiece(piece);'));
  assert.ok(engine.includes('focusFreezoneTeamOnEntry();'));
  assert.ok(engine.includes('You are not assigned to a player seat in this room.'));
  assert.ok(engine.includes('That square is not a legal destination; a piece, block, or movement rule prevents it.'));
  assert.ok(engine.includes('player.controlledPieceId'));
  assert.ok(engine.includes('requestFreezoneAIMove'));
  assert.ok(engine.includes('handleCustomModeClick(\n          { clientX: -1, clientY: -1 }'));
  assert.ok(engine.includes("if (selectedPiece && customGameConfig.gameMode !== 'freezone')"));
  assert.ok(engine.includes('choose one of the ${legalMoves.length} highlighted squares.'));
  assert.ok(engine.includes('showSquareHighlights(\n            selectedPiece.r,'));
  assert.ok(engine.includes('isAnimatingMove) {\n        return;\n      }\n\n      if (room.free_mode_state?.enabled)'));
  assert.ok(engine.includes('setFreeMode(true, savedState, true)'));
  assert.ok(engine.includes('const readyAt = Math.max(player.cooldownUntil, piece.freeCooldownUntil || 0)'));
  const canMoveStart = engine.indexOf('function canMoveFreezonePiece');
  const canMoveEnd = engine.indexOf('function recordFreezoneMove', canMoveStart);
  assert.ok(!engine.slice(canMoveStart, canMoveEnd).includes('movedPieceIds.includes'));
  assert.ok(engine.includes('Spend one to gain one more move action per cycle'));
});

test('Freezone AI controls stay visible and manual movement resumes after cooldowns', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const clickStart = engine.indexOf('function handleCustomModeClick');
  const clickEnd = engine.indexOf('function handleFreeModeClick', clickStart);
  const clickHandler = engine.slice(clickStart, clickEnd);
  const aiStart = engine.indexOf('async function requestFreezoneAITeammateAction');
  const aiEnd = engine.indexOf('function scheduleFreezoneAIIdleAction', aiStart);
  const aiRequest = engine.slice(aiStart, aiEnd);

  assert.ok(clickHandler.includes('if (isAnimatingMove) return;'));
  assert.ok(!clickHandler.includes('freezoneAIDialogueBusy && !forcedMove'));
  assert.ok(clickHandler.includes('cancelPendingFreezoneAIRequest();'));
  assert.ok(aiRequest.includes('requestGeneration !== freezoneAIRequestGeneration'));
  assert.ok(aiRequest.includes('if (isAnimatingMove)'));
  assert.ok(aiRequest.includes('response?.dialogueError'));
  assert.ok(aiRequest.includes('scheduleFreezoneAIAnimationRetry'));
  assert.ok(aiRequest.includes('scheduleFreezoneAIRequestRetry'));
  assert.ok(aiRequest.includes('retryAttempt < 1'));
  assert.ok(aiRequest.includes('AI request failed temporarily; retrying once.'));
  assert.ok(engine.includes('wizard-chess-freezone-ai-test-result'));
  assert.ok(engine.includes('aiTestRequestId: testRequestId'));
  assert.ok(aiRequest.includes('const moveStarted = handleCustomModeClick('));
  assert.ok(aiRequest.includes('if (!moveStarted)'));
  assert.ok(engine.includes('function scheduleFreezoneAIAnimationRetry'));
  assert.ok(engine.includes('detail: `AI text: ${generatedText}`'));
  assert.ok(engine.includes('new THREE.CircleGeometry(freeModeActive ? 0.15 : 0.06, 24)'));
  assert.ok(engine.includes('new THREE.RingGeometry(0.27, 0.34, 32)'));
  assert.ok(engine.includes('depthTest: !freeModeActive'));
  assert.ok(engine.includes("cancelPendingFreezoneAIRequest('army')"));
  assert.ok(engine.includes('scheduleFreezoneAIIdleAction(protectedPiece.freeId, null)'));
  assert.ok(engine.includes("const label = aiControlled ? `AI · ${name}` : name;"));
  assert.ok(engine.includes('AI assist off. Select a piece and choose one of its highlighted destinations.'));
  assert.ok(engine.includes('AI action failed: ${errorMessage}'));
  assert.ok(engine.includes('getFreezonePlayerMovementState(piece.freeSide)'));
  assert.ok(engine.includes('resetExpiredFreezoneMoveCycle(player, now)'));
  assert.ok(engine.includes('This piece has no legal moves right now. Check its cooldown or movement budget.'));
});
