/** Background-side data service: API + IndexedDB cache, with incremental submission sync. */
import { cacheGet, cacheSet } from './cache';
import * as api from './cf-api';
import type { Contest, ProblemsetProblem, Submission, UserBundle } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const PAGE = 100;
const MAX_INCREMENTAL_PAGES = 10;

const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Merge freshly fetched (newest-first) pages into the cache. Newer data wins,
 * so verdicts that were still "TESTING" when cached get replaced.
 */
export function mergeSubmissions(cached: Submission[], fresh: Submission[]): Submission[] {
  const byId = new Map(cached.map((s) => [s.id, s]));
  for (const s of fresh) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

/** Newest cached id with a final verdict; everything at or below it is settled. */
export function settledWatermark(cached: Submission[]): number {
  let mark = 0;
  for (const s of cached) if (s.verdict && s.verdict !== 'TESTING') mark = Math.max(mark, s.id);
  return mark;
}

async function syncSubmissions(handle: string, cached: Submission[] | null): Promise<Submission[]> {
  if (!cached || cached.length === 0) return api.userStatus(handle);
  const mark = settledWatermark(cached);
  const fresh: Submission[] = [];
  for (let page = 0; page < MAX_INCREMENTAL_PAGES; page++) {
    const batch = await api.userStatus(handle, page * PAGE + 1, PAGE);
    fresh.push(...batch);
    if (batch.length < PAGE || batch.some((s) => s.id <= mark)) return mergeSubmissions(cached, fresh);
  }
  return api.userStatus(handle); // fell too far behind: full refetch
}

const userKey = (h: string) => `user:${h.toLowerCase()}`;

export async function getUser(handle: string, refresh: boolean): Promise<UserBundle | null> {
  const cached = await cacheGet<UserBundle>(userKey(handle));
  if (!refresh) return cached?.value ?? null;
  return once(userKey(handle), async () => {
    const prev = cached?.value ?? null;
    const info = await api.userInfo(handle);
    const [submissions, ratingHistory] = [
      await syncSubmissions(info.handle, prev?.submissions ?? null),
      await api.userRating(info.handle).catch(() => prev?.ratingHistory ?? []),
    ];
    const bundle: UserBundle = { handle: info.handle, info, submissions, ratingHistory, fetchedAt: Date.now() };
    await cacheSet(userKey(handle), bundle);
    return bundle;
  });
}

async function cachedFetch<T>(key: string, ttl: number, refresh: boolean, fetcher: () => Promise<T>): Promise<T> {
  const c = await cacheGet<T>(key);
  if (c && (c.age < ttl || !refresh)) return c.value;
  return once(key, async () => {
    try {
      const v = await fetcher();
      await cacheSet(key, v);
      return v;
    } catch (e) {
      if (c) return c.value; // serve stale on failure
      throw e;
    }
  });
}

export const getProblemset = (refresh = true) =>
  cachedFetch<ProblemsetProblem[]>('problemset', 24 * HOUR, refresh, api.problemset);

export const getContests = (refresh = true) => cachedFetch<Contest[]>('contests', 6 * HOUR, refresh, api.contestList);
