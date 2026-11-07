/** Typed settings in chrome.storage.sync, usable from every extension context. */

/** Default = stock Codeforces white; Slate and Pure dark are CF+ themes. */
export type ThemeMode = 'light' | 'slate' | 'dark';
export type HeatmapMode = 'count' | 'rating';

export interface Settings {
  theme: ThemeMode;
  /** How statement images look in dark mode. */
  imageMode: 'card' | 'invert' | 'none';
  heatmapMode: HeatmapMode;
  /** Hide tags & ratings until solved. */
  spoilerFree: boolean;
  solvedRows: 'show' | 'dim' | 'hide';
  /** Your handle; auto-detected from the CF header when logged in. */
  handle: string | null;
  remindersEnabled: boolean;
  reminderMinutes: number;
  /** Collapsed profile sections, by id. */
  collapsed: Record<string, boolean>;
  showAnalytics: boolean;
  problemTools: boolean;
  /** Rating changes on standings pages. */
  predictor: boolean;
  /** Also show a performance column on standings. */
  predictorPerf: boolean;
  /** Friends on problem pages, problemset and standings. */
  friends: boolean;
  /** Extra handles to treat as friends (rivals), besides your Codeforces friends. */
  extraFriends: string[];
  /** Estimated ratings for problems Codeforces hasn't rated yet. */
  estimates: boolean;
}

export const DEFAULTS: Settings = {
  theme: 'light',
  imageMode: 'card',
  heatmapMode: 'rating',
  spoilerFree: false,
  solvedRows: 'show',
  handle: null,
  remindersEnabled: true,
  reminderMinutes: 15,
  collapsed: {},
  showAnalytics: true,
  problemTools: true,
  predictor: true,
  predictorPerf: true,
  friends: true,
  extraFriends: [],
  estimates: true,
};

const THEMES: ThemeMode[] = ['light', 'slate', 'dark'];

/** Coerce values saved by older versions (e.g. theme "auto", heatmap "hybrid"). */
export function normalize(raw: Record<string, unknown>): Settings {
  const s = { ...DEFAULTS, ...(raw as Partial<Settings>) };
  if (!THEMES.includes(s.theme)) s.theme = DEFAULTS.theme;
  if (s.heatmapMode !== 'count' && s.heatmapMode !== 'rating') s.heatmapMode = DEFAULTS.heatmapMode;
  if (!Array.isArray(s.extraFriends)) s.extraFriends = [];
  return s;
}

export async function getSettings(): Promise<Settings> {
  return normalize(await chrome.storage.sync.get(Object.keys(DEFAULTS)));
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

/** Calls `cb` with the changed keys (merged over defaults) whenever settings change. */
export function onSettingsChanged(cb: (changed: Partial<Settings>) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync') return;
    const patch: Partial<Settings> = {};
    for (const [k, v] of Object.entries(changes)) {
      if (k in DEFAULTS) (patch as Record<string, unknown>)[k] = v.newValue ?? DEFAULTS[k as keyof Settings];
    }
    if (patch.theme && !THEMES.includes(patch.theme)) patch.theme = DEFAULTS.theme;
    if (Object.keys(patch).length) cb(patch);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export const nextTheme = (t: ThemeMode): ThemeMode => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];

export const THEME_LABELS: Record<ThemeMode, string> = { light: 'Default', slate: 'Slate', dark: 'Pure dark' };
