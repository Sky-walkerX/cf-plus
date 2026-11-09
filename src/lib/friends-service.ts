/** Background: friends list, per-friend solve indexes (incremental sync under the API limit). */
import { cacheGet, cacheSet } from './cache';
import * as api from './cf-api';
import { getRatings, once } from './contest-service';
import { addSubmissions, emptyIndex, friendCounts, friendsOnProblem, type FriendIndex } from './friends';
import { getSettings } from './settings';

const HOUR = 3600_000;
const STALE = 3 * HOUR;
const PAGE = 100;

interface FriendList {
  scraped: string[];
  scrapedAt: number;
}

/** Friends from Codeforces (scraped while logged in) plus handles added in CF+ settings. */
export async function getFriendList(): Promise<string[]> {
  const scraped = (await cacheGet<FriendList>('friends'))?.value.scraped ?? [];
  const { extraFriends } = await getSettings();
  const all = new Map<string, string>();
  for (const h of [...scraped, ...extraFriends]) {
    const t = h.trim();
    if (t) all.set(t.toLowerCase(), t);
  }
  return [...all.values()];
}

export async function setScrapedFriends(handles: string[]): Promise<void> {
  await cacheSet<FriendList>('friends', { scraped: handles, scrapedAt: Date.now() });
}

export async function friendsScrapedAt(): Promise<number> {
  return (await cacheGet<FriendList>('friends'))?.value.scrapedAt ?? 0;
}

const idxKey = (h: string) => `fidx:${h.toLowerCase()}`;
const loadIndex = async (h: string) => (await cacheGet<FriendIndex>(idxKey(h)))?.value ?? null;

async function syncFriend(handle: string): Promise<void> {
  const cached = await loadIndex(handle);
  const prev = cached?.attempts ? cached : null;
  let idx = prev ?? emptyIndex(handle);
  if (!prev) {
    idx = addSubmissions(idx, await api.userStatus(handle));
  } else {
    const watermark = prev.settledId;
    const fresh: Awaited<ReturnType<typeof api.userStatus>> = [];
    let caughtUp = false;
    for (let page = 0; page < 20; page++) {
      const batch = await api.userStatus(handle, page * PAGE + 1, PAGE);
      fresh.push(...batch);
      if (batch.length < PAGE || batch.some((s) => s.id <= watermark)) { caughtUp = true; break; }
    }
    // Fold together so the submission-count watermark doesn't skip later pages.
    idx = caughtUp ? addSubmissions(idx, fresh) : addSubmissions(emptyIndex(handle), await api.userStatus(handle));
  }
  idx.syncedAt = Date.now();
  await cacheSet(idxKey(handle), idx);
}

export interface SyncProgress {
  synced: number;
  total: number;
}

/** Sync up to `limit` stale friends (oldest first). */
export async function syncStaleFriends(limit = 10): Promise<SyncProgress> {
  return once('friends-sync', async () => {
    const friends = await getFriendList();
    const indexes = await Promise.all(friends.map(async (h) => [h, await loadIndex(h)] as const));
    const stale = indexes.filter(([, i]) => !i || !i.attempts || i.syncedAt < Date.now() - STALE).sort((a, b) => (a[1]?.syncedAt ?? 0) - (b[1]?.syncedAt ?? 0));
    for (const [h] of stale.slice(0, limit)) {
      try {
        await syncFriend(h);
      } catch {
        /* renamed/deleted account or API hiccup: retried next run */
      }
    }
    return progress();
  });
}

export async function progress(): Promise<SyncProgress> {
  const friends = await getFriendList();
  let synced = 0;
  for (const h of friends) if (await loadIndex(h)) synced++;
  return { synced, total: friends.length };
}

async function loadAll(): Promise<FriendIndex[]> {
  const friends = await getFriendList();
  return (await Promise.all(friends.map(loadIndex))).filter((i): i is FriendIndex => !!i);
}

export async function friendsForProblem(contestId: number, index: string) {
  const indexes = await loadAll();
  const key = `${contestId}-${index}`;
  const involved = indexes.filter((i) => i.solved[key] || i.tried[key]).map((i) => i.handle);
  const ratings = involved.length ? await getRatings(involved).catch(() => new Map<string, number | undefined>()) : new Map();
  void syncStaleFriends(8).catch(() => undefined);
  return { ...friendsOnProblem(indexes, key, ratings), progress: await progress() };
}

export async function friendSolvedCounts(keys: string[]) {
  return friendCounts(await loadAll(), keys);
}
