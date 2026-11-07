/**
 * Background-only data for the predictor and estimates: cached standings, rating changes, the
 * rated-users list and the newcomer history (how many rated contests each new account has done).
 */
import { cacheGet, cacheSet } from './cache';
import * as api from './cf-api';
import type { ChangeRow } from './newcomers';
import { isUnratedByName } from './predictor';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const inflight = new Map<string, Promise<unknown>>();
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---------------------------------------------------------------- standings

export async function getStandings(contestId: number): Promise<api.Standings> {
  const key = `standings:${contestId}`;
  const c = await cacheGet<api.Standings>(key);
  if (c) {
    const phase = c.value.contest.phase;
    const ttl = phase === 'FINISHED' ? DAY : phase === 'CODING' ? MIN : 5 * MIN;
    if (c.age < ttl) return c.value;
  }
  return once(key, async () => {
    try {
      const s = await api.contestStandings(contestId);
      await cacheSet(key, s);
      return s;
    } catch (e) {
      if (c) return c.value;
      throw e;
    }
  });
}

// ---------------------------------------------------------------- rating changes

/** Final rating changes: rows, [] while pending, or null when Codeforces says the contest is unrated. */
export async function getRatingChanges(contestId: number): Promise<ChangeRow[] | null> {
  const key = `changes:${contestId}`;
  const c = await cacheGet<ChangeRow[] | null>(key);
  // Published changes never change; an empty answer (pending) is re-checked every 10 minutes.
  if (c && (c.value === null || c.value.length > 0 || c.age < 10 * MIN)) return c.value;
  return once(key, async () => {
    const v = await api.contestRatingChanges(contestId);
    await cacheSet(key, v);
    return v;
  });
}

// ---------------------------------------------------------------- rated list

/** Every rated user's current rating. Refetched when older than an hour before `notBeforeMs`. */
export async function getRatedList(notBeforeMs: number): Promise<Record<string, number>> {
  const key = 'ratedlist';
  const c = await cacheGet<Record<string, number>>(key);
  if (c && Date.now() - c.age >= notBeforeMs - HOUR && c.age < 3 * DAY) return c.value;
  return once(key, async () => {
    try {
      const v = await api.userRatedList();
      await cacheSet(key, v);
      return v;
    } catch (e) {
      if (c) return c.value;
      throw e;
    }
  });
}

// ---------------------------------------------------------------- user info (small batches)

export async function getRatings(handles: string[]): Promise<Map<string, number | undefined>> {
  const out = new Map<string, number | undefined>();
  const missing: string[] = [];
  for (const h of handles) {
    const c = await cacheGet<number | null>(`urating:${h.toLowerCase()}`);
    if (c && c.age < 6 * HOUR) out.set(h, c.value ?? undefined);
    else missing.push(h);
  }
  if (missing.length) {
    const infos = await api.userInfoMany(missing);
    for (const u of infos) {
      out.set(u.handle, u.rating);
      await cacheSet(`urating:${u.handle.toLowerCase()}`, u.rating ?? null);
    }
    for (const h of missing) if (!out.has(h)) out.set(h, undefined);
  }
  return out;
}

// ---------------------------------------------------------------- newcomer history

/** handle → times of its first rated contests (only accounts that started inside the window). */
interface NewcomerStore {
  processed: number[];
  times: Record<string, number[]>;
}
const NEWCOMERS_KEY = 'newcomers';
const WINDOW_DAYS = 120;

export async function loadNewcomers(): Promise<NewcomerStore> {
  return (await cacheGet<NewcomerStore>(NEWCOMERS_KEY))?.value ?? { processed: [], times: {} };
}

/** k (rated contests completed before `atSeconds`) for each handle that is still a newcomer then. */
export function newcomersAt(store: NewcomerStore, handles: Iterable<string>, atSeconds: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of handles) {
    const t = store.times[h];
    if (!t) continue;
    const k = t.filter((x) => x < atSeconds).length;
    if (k > 0 && k < 6) out.set(h, k);
  }
  return out;
}

export interface NewcomerProgress {
  processed: number;
  total: number;
}

/**
 * Download rating changes of past rated contests (oldest first) and record each newcomer's first
 * contests. Bounded by `maxCalls` per run; progress is saved after every contest.
 */
export async function updateNewcomers(maxCalls = 60): Promise<NewcomerProgress> {
  return once('newcomers-update', async () => {
    const store = await loadNewcomers();
    const done = new Set(store.processed);
    const contests = await api.contestList();
    const since = Date.now() / 1000 - WINDOW_DAYS * 86400;
    const todo = contests
      .filter((c) => c.phase === 'FINISHED' && (c.startTimeSeconds ?? 0) > since && !isUnratedByName(c.name))
      .sort((a, b) => (a.startTimeSeconds ?? 0) - (b.startTimeSeconds ?? 0));
    let calls = 0;
    for (const c of todo) {
      if (done.has(c.id)) continue;
      if (calls++ >= maxCalls) break;
      let rows: ChangeRow[] | null = null;
      try {
        // Direct call: only newcomers are kept, not the whole table (≈2 MB per contest).
        rows = await api.contestRatingChanges(c.id);
      } catch {
        continue; // try again next run
      }
      if (rows && rows.length === 0) continue; // pending: not final yet
      for (const [handle, , old, , time] of rows ?? []) {
        const t = store.times[handle];
        if (old === 0) store.times[handle] = [time, ...(t ?? []).filter((x) => x > time)].slice(0, 6);
        else if (t && t.length < 6 && !t.includes(time) && time > t[0]) t.push(time);
      }
      store.processed.push(c.id);
      // Forget accounts that are no longer newcomers, and contests that left the window.
      for (const [h, t] of Object.entries(store.times)) if (t.length >= 6 || t[0] < since - 30 * 86400) delete store.times[h];
      await cacheSet(NEWCOMERS_KEY, store);
    }
    return { processed: todo.filter((c) => store.processed.includes(c.id)).length, total: todo.length };
  });
}
