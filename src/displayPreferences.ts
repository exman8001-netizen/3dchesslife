export type DisplayPreferences = {
  menuMultiplayer: boolean;
  menuTestMode: boolean;
  menuFreeMode: boolean;
  menuModeCreator: boolean;
  freezoneStats: boolean;
  freezonePlayer: boolean;
  freezoneTurnStatus: boolean;
  freezoneOnlineRoster: boolean;
  freezoneAdversaryBots: boolean;
  freezoneReturnMenu: boolean;
  freezoneCamera: boolean;
  freezoneRadio: boolean;
  freezonePieceShop: boolean;
};

export type DisplayPreferenceKey = keyof DisplayPreferences;

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  menuMultiplayer: false,
  menuTestMode: false,
  menuFreeMode: false,
  menuModeCreator: false,
  freezoneStats: false,
  freezonePlayer: false,
  freezoneTurnStatus: false,
  freezoneOnlineRoster: false,
  freezoneAdversaryBots: false,
  freezoneReturnMenu: true,
  freezoneCamera: false,
  freezoneRadio: false,
  freezonePieceShop: false
};

export const DISPLAY_PREFERENCES_STORAGE_KEY = 'wizard-chess-display-preferences-v2';
const LEGACY_DISPLAY_PREFERENCES_STORAGE_KEY = 'wizard-chess-display-preferences-v1';

export function loadDisplayPreferences(): {
  preferences: DisplayPreferences;
  warning: string;
} {
  if (typeof window === 'undefined') {
    return { preferences: DEFAULT_DISPLAY_PREFERENCES, warning: '' };
  }

  try {
    const currentSaved = window.localStorage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY);
    const saved = currentSaved ||
      window.localStorage.getItem(LEGACY_DISPLAY_PREFERENCES_STORAGE_KEY);
    if (!saved) return { preferences: DEFAULT_DISPLAY_PREFERENCES, warning: '' };
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        preferences: DEFAULT_DISPLAY_PREFERENCES,
        warning: 'Saved display settings are invalid; default visibility is active.'
      };
    }

    const stored = parsed as Partial<Record<DisplayPreferenceKey, unknown>>;
    const preferences = { ...DEFAULT_DISPLAY_PREFERENCES };
    for (const key of Object.keys(preferences) as DisplayPreferenceKey[]) {
      if (typeof stored[key] === 'boolean') preferences[key] = stored[key];
    }
    if (!currentSaved) preferences.freezoneReturnMenu = true;
    return { preferences, warning: '' };
  } catch (error) {
    console.warn('Could not load saved display settings.', error);
    return {
      preferences: DEFAULT_DISPLAY_PREFERENCES,
      warning: 'Saved display settings could not be loaded; default visibility is active.'
    };
  }
}
