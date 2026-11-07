/**
 * Runs on every Codeforces page at document_start.
 * - Mirrors settings onto <html data-cfx-*> attributes (theme, image mode, spoiler mode, solved rows).
 * - Detects the logged-in handle.
 * - Adds a theme toggle to the CF header.
 */
import '../theme/tokens.css';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { CF_MATCHES } from '../lib/constants';
import { detectLoggedInHandle, SEL } from '../lib/dom';
import { parseFriendsPage } from '../lib/friends';
import { send } from '../lib/messaging';
import { getSettings, nextTheme, onSettingsChanged, setSettings, THEME_LABELS, type Settings, type ThemeMode } from '../lib/settings';

const root = document.documentElement;

function applyAttributes(s: Partial<Settings>) {
  if (s.theme) root.dataset.cfxTheme = s.theme;
  if (s.imageMode) root.dataset.cfxImg = s.imageMode;
  if (s.spoilerFree !== undefined) root.dataset.cfxSpoiler = s.spoilerFree ? 'on' : 'off';
  if (s.solvedRows) root.dataset.cfxSolved = s.solvedRows;
}

const ICONS: Record<ThemeMode, string> = {
  light:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  slate:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor"/></svg>',
};

function mountToggle(theme: ThemeMode) {
  const box = document.querySelector(SEL.headerLangChooser)?.firstElementChild;
  if (!box || document.getElementById('cfx-theme-toggle')) return;
  const btn = document.createElement('button');
  btn.id = 'cfx-theme-toggle';
  btn.type = 'button';
  Object.assign(btn.style, {
    all: 'unset',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '24px',
    marginRight: '6px',
    verticalAlign: 'top',
    borderRadius: '6px',
    color: 'var(--cfx-text-muted)',
  } satisfies Partial<CSSStyleDeclaration>);
  const render = (t: ThemeMode) => {
    btn.innerHTML = ICONS[t];
    btn.title = `CF+ theme: ${THEME_LABELS[t]}. Click to switch (Alt+Shift+D)`;
    btn.setAttribute('aria-label', btn.title);
    btn.dataset.theme = t;
  };
  render(theme);
  btn.addEventListener('click', () => setSettings({ theme: nextTheme(btn.dataset.theme as ThemeMode) }));
  onSettingsChanged((p) => p.theme && render(p.theme));
  box.prepend(btn);
}

/** Read your friends from Codeforces (you're logged in on this tab) at most every 12 hours. */
async function syncFriendList(self: string) {
  try {
    const { scrapedAt } = await send({ type: 'friendsStatus' });
    if (Date.now() - scrapedAt < 12 * 3600_000) return;
    const res = await fetch(`${location.origin}/friends`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const handles = parseFriendsPage(doc, self);
    await send({ type: 'setFriends', handles });
  } catch {
    /* offline or Codeforces busy: try again on the next page load */
  }
}

export default defineContentScript({
  matches: CF_MATCHES,
  runAt: 'document_start',
  allFrames: false,
  async main() {
    const settings = await getSettings();
    applyAttributes(settings);
    onSettingsChanged(applyAttributes);

    const onReady = () => {
      mountToggle(settings.theme);
      const handle = detectLoggedInHandle();
      if (handle && handle !== settings.handle) setSettings({ handle });
      if (handle && settings.friends) void syncFriendList(handle);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
    else onReady();
  },
});
