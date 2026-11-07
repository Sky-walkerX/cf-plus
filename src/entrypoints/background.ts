import { defineBackground } from 'wxt/utils/define-background';
import { CF_MATCHES, DARK_SCRIPT_ID, themeFile } from '../lib/constants';
import { cacheClear } from '../lib/cache';
import { updateNewcomers } from '../lib/contest-service';
import { getContests, getProblemset, getUser } from '../lib/data';
import { problemRatings } from '../lib/estimates-service';
import { friendSolvedCounts, friendsForProblem, getFriendList, friendsScrapedAt, progress, setScrapedFriends, syncStaleFriends } from '../lib/friends-service';
import { predictForPage } from '../lib/predictor-service';
import { handle, type Request } from '../lib/messaging';
import { getSettings, nextTheme, onSettingsChanged, setSettings, type ThemeMode } from '../lib/settings';
import type { Contest } from '../lib/types';

/** Register the chosen theme's stylesheet at document_start so pages never flash white. */
async function registerTheme(theme: ThemeMode) {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ours = existing.map((s) => s.id).filter((id) => id === DARK_SCRIPT_ID || id === 'cfx-dark');
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
  if (theme === 'light') return;
  await chrome.scripting.registerContentScripts([
    {
      id: DARK_SCRIPT_ID,
      matches: CF_MATCHES,
      css: [themeFile(theme)],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
}

/** Open tabs: insert the stylesheet now; the content script flips <html data-cfx-theme>. */
async function applyThemeToOpenTabs(theme: ThemeMode) {
  if (theme === 'light') return;
  const tabs = await chrome.tabs.query({ url: CF_MATCHES });
  await Promise.all(
    tabs.map((t) =>
      t.id == null
        ? null
        : chrome.scripting
            .insertCSS({ target: { tabId: t.id, allFrames: true }, files: [themeFile(theme)] })
            .catch(() => undefined),
    ),
  );
}

// ---------- contest reminders ----------

const REFRESH_ALARM = 'contests-refresh';
const FRIENDS_ALARM = 'friends-sync';
const NEWCOMERS_ALARM = 'newcomers-update';
const REMIND_PREFIX = 'remind:';

async function scheduleReminders(refresh = true) {
  const s = await getSettings();
  const all = await chrome.alarms.getAll();
  await Promise.all(all.filter((a) => a.name.startsWith(REMIND_PREFIX)).map((a) => chrome.alarms.clear(a.name)));
  if (!s.remindersEnabled) return;
  let contests: Contest[];
  try {
    contests = await getContests(refresh);
  } catch {
    return;
  }
  const now = Date.now();
  const horizon = now + 8 * 24 * 3600_000;
  for (const c of contests) {
    if (c.phase !== 'BEFORE' || !c.startTimeSeconds) continue;
    const when = c.startTimeSeconds * 1000 - s.reminderMinutes * 60_000;
    if (when > now && when < horizon) await chrome.alarms.create(`${REMIND_PREFIX}${c.id}`, { when });
  }
}

async function notifyContest(id: number) {
  const contests = await getContests(false);
  const c = contests.find((x) => x.id === id);
  if (!c) return;
  const mins = Math.max(0, Math.round(((c.startTimeSeconds ?? 0) * 1000 - Date.now()) / 60_000));
  chrome.notifications.create(`contest:${id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title: mins > 0 ? `Starts in ${mins} min` : 'Starting now',
    message: c.name,
    buttons: [{ title: 'Open contest' }],
    priority: 2,
  });
}

function openContest(notificationId: string) {
  const id = notificationId.split(':')[1];
  if (id) chrome.tabs.create({ url: `https://codeforces.com/contests/${id}` });
  chrome.notifications.clear(notificationId);
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    await registerTheme((await getSettings()).theme);
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
    await chrome.alarms.create(FRIENDS_ALARM, { periodInMinutes: 20, delayInMinutes: 2 });
    await chrome.alarms.create(NEWCOMERS_ALARM, { periodInMinutes: 12 * 60, delayInMinutes: 5 });
  });
  chrome.runtime.onStartup.addListener(async () => {
    await registerTheme((await getSettings()).theme);
  });

  onSettingsChanged(async (patch) => {
    if (patch.theme) {
      await registerTheme(patch.theme);
      await applyThemeToOpenTabs(patch.theme);
    }
    if (patch.remindersEnabled !== undefined || patch.reminderMinutes !== undefined) await scheduleReminders(false);
  });

  chrome.commands.onCommand.addListener(async (cmd) => {
    if (cmd === 'toggle-theme') await setSettings({ theme: nextTheme((await getSettings()).theme) });
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === REFRESH_ALARM) await scheduleReminders(true);
    else if (alarm.name === FRIENDS_ALARM) {
      if ((await getSettings()).friends) await syncStaleFriends(12).catch(() => undefined);
    } else if (alarm.name === NEWCOMERS_ALARM) {
      if ((await getSettings()).predictor) await updateNewcomers(60).catch(() => undefined);
    }
    else if (alarm.name.startsWith(REMIND_PREFIX)) await notifyContest(Number(alarm.name.slice(REMIND_PREFIX.length)));
  });
  chrome.notifications.onClicked.addListener(openContest);
  chrome.notifications.onButtonClicked.addListener(openContest);

  handle<Request>(async (req) => {
    switch (req.type) {
      case 'user':
        return getUser(req.handle, req.refresh);
      case 'problemset':
        return getProblemset(req.refresh ?? true);
      case 'contests':
        return getContests(req.refresh ?? true);
      case 'clearCache':
        return cacheClear();
      case 'predict':
        return predictForPage(req);
      case 'problemRatings':
        return problemRatings(req.contestIds);
      case 'friendsOnProblem':
        return friendsForProblem(req.contestId, req.index);
      case 'friendCounts':
        return friendSolvedCounts(req.keys);
      case 'setFriends':
        await setScrapedFriends(req.handles);
        void syncStaleFriends(12).catch(() => undefined);
        return;
      case 'friendList':
        return getFriendList();
      case 'friendsStatus':
        return { ...(await progress()), scrapedAt: await friendsScrapedAt() };
      case 'syncFriends':
        return { ...(await syncStaleFriends(30)), scrapedAt: await friendsScrapedAt() };
    }
  });
});
