/** Background-only, small shared snapshots; full standings never cross to a tab. */
import { cacheGet, cacheSet } from './cache';
import { contestStatus, userInfo } from './cf-api';
import { getStandings, once } from './contest-service';
import { ownRow, type LiveContest } from './live-contest';
import type { UserInfo } from './types';

export function getProfilePreview(handle: string): Promise<UserInfo> {
  if (!/^[A-Za-z0-9_.-]{1,24}$/.test(handle)) return Promise.reject(new Error('Invalid handle'));
  const key = `preview:${handle.toLowerCase()}`;
  return once(key, async () => {
    const cached = await cacheGet<UserInfo>(key);
    if (cached && cached.age < 10 * 60_000) return cached.value;
    try {
      const info = await userInfo(handle);
      await cacheSet(key, info);
      return info;
    } catch (e) {
      if (cached) return cached.value;
      throw e;
    }
  });
}

export function getLiveContest(contestId: number, handle: string): Promise<LiveContest> {
  if (!Number.isInteger(contestId) || contestId <= 0 || !/^[A-Za-z0-9_.-]{1,24}$/.test(handle)) return Promise.reject(new Error('Invalid contest or handle'));
  const key = `live:${contestId}:${handle.toLowerCase()}`;
  return once(key, async () => {
    const cached = await cacheGet<LiveContest>(key);
    // Age the standings from when they were read, not after the verdict request completes.
    // Otherwise a 2-second verdict request makes the next 8-second poll reuse old standings.
    if (cached && Date.now() - cached.value.fetchedAt < 7_000) return cached.value;
    const standings = await getStandings(contestId, true);
    const fetchedAt = Date.now();
    const row = ownRow(standings.rows, handle);
    // Fetch verdicts only during coding; API rank is always explicitly official.
    let verdictsStale = false;
    const submissions = standings.contest.phase === 'CODING' ? await contestStatus(contestId, handle).catch(() => {
      verdictsStale = true;
      return [];
    }) : [];
    const snapshot: LiveContest = {
      contest: standings.contest,
      problems: standings.problems,
      row,
      submissions: submissions.filter((s) => s.participantType === 'CONTESTANT' || s.participantType === 'OUT_OF_COMPETITION'),
      fetchedAt,
      verdictsStale,
    };
    await cacheSet(key, snapshot);
    return snapshot;
  });
}
