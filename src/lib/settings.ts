/** Typed settings in chrome.storage.sync, usable from every extension context. */

/** Default = stock Codeforces white; Slate and Pure dark are CF+ themes. */
export type ThemeMode = 'light' | 'slate' | 'dark';

export interface Settings {
  theme: ThemeMode;
  /** How statement images look in dark mode. */
  imageMode: 'card' | 'invert' | 'none';
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
  /** Practice stopwatch at the top of problem statements. */
  stopwatch: boolean;
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
  liveRank: boolean;
  contestPanel: boolean;
  contestPanelPosition: 'right' | 'top' | 'left';
  profilePreview: boolean;
  colorOwnHandle: boolean;
}

export const DEFAULTS: Settings = {
  theme: 'light',
  imageMode: 'card',
  spoilerFree: false,
  solvedRows: 'show',
  handle: null,
  remindersEnabled: true,
  reminderMinutes: 15,
  collapsed: {},
  showAnalytics: true,
  stopwatch: true,
  predictor: true,
  predictorPerf: true,
  friends: true,
  extraFriends: [],
  estimates: true,
  liveRank: true,
  contestPanel: true,
  contestPanelPosition: 'right',
  profilePreview: true,
  colorOwnHandle: true,
};

const THEMES: ThemeMode[] = ['light', 'slate', 'dark'];

/** Coerce values saved by older versions (e.g. theme "auto", heatmap "hybrid"). */
export function normalize(raw: Record<string, unknown>): Settings {
  const s = { ...DEFAULTS, ...(raw as Partial<Settings>) };
  if (!THEMES.includes(s.theme)) s.theme = DEFAULTS.theme;
  if (!Array.isArray(s.extraFriends)) s.extraFriends = [];
  s.extraFriends = s.extraFriends.filter((h): h is string => typeof h === 'string' && /^[A-Za-z0-9_.-]{1,24}$/.test(h));
  if (!['right', 'top', 'left'].includes(s.contestPanelPosition)) s.contestPanelPosition = 'right';
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
  return () => {
    // During an unpacked-extension reload Chrome can remove storage before WXT runs cleanup.
    try { chrome.storage?.onChanged.removeListener(listener); } catch { /* context already invalidated */ }
  };
}

export const nextTheme = (t: ThemeMode): ThemeMode => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];

export const THEME_LABELS: Record<ThemeMode, string> = { light: 'Default', slate: 'Slate', dark: 'Pure dark' };
