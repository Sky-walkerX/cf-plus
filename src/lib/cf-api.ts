/** Typed Codeforces API client. Runs in the background worker only (through the queue). */
import { createQueue, RateLimitError } from './queue';
import type { Contest, ProblemsetProblem, RatingChange, Submission, UserInfo } from './types';

const API = 'https://codeforces.com/api/';
const queue = createQueue();

export class CfApiError extends Error {}

async function call<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return queue.run(async () => {
    const res = await fetch(`${API}${method}?${qs}`);
    let body: { status: string; result?: T; comment?: string };
    try {
      body = await res.json();
    } catch {
      if (res.status === 503 || res.status === 429) throw new RateLimitError(`HTTP ${res.status}`);
      throw new CfApiError(`Codeforces API returned HTTP ${res.status}`);
    }
    if (body.status === 'OK') return body.result as T;
    const comment = body.comment ?? 'Unknown error';
    if (/call limit exceeded/i.test(comment)) throw new RateLimitError(comment);
    throw new CfApiError(comment);
  });
}

/** Strip a raw API submission down to what CF+ stores. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trimSubmission(s: any): Submission {
  return {
    id: s.id,
    contestId: s.contestId,
    creationTimeSeconds: s.creationTimeSeconds,
    problem: {
      contestId: s.problem.contestId,
      problemsetName: s.problem.problemsetName,
      index: s.problem.index,
      name: s.problem.name,
      rating: s.problem.rating,
      tags: s.problem.tags ?? [],
    },
    participantType: s.author?.participantType ?? 'PRACTICE',
    programmingLanguage: s.programmingLanguage,
    verdict: s.verdict,
  };
}

export async function userStatus(handle: string, from?: number, count?: number): Promise<Submission[]> {
  const params: Record<string, string | number> = { handle };
  if (from != null) params.from = from;
  if (count != null) params.count = count;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await call<any[]>('user.status', params);
  return raw.map(trimSubmission);
}

export async function userInfo(handle: string): Promise<UserInfo> {
  const [u] = await call<UserInfo[]>('user.info', { handles: handle });
  return {
    handle: u.handle,
    rating: u.rating,
    maxRating: u.maxRating,
    rank: u.rank,
    maxRank: u.maxRank,
    avatar: u.avatar,
    titlePhoto: u.titlePhoto,
  };
}

export const userRating = (handle: string) => call<RatingChange[]>('user.rating', { handle });

export async function contestList(): Promise<Contest[]> {
  const list = await call<Contest[]>('contest.list', { gym: 'false' });
  return list.map(({ id, name, type, phase, durationSeconds, startTimeSeconds }) => ({
    id, name, type, phase, durationSeconds, startTimeSeconds,
  }));
}

export async function problemset(): Promise<ProblemsetProblem[]> {
  const r = await call<{
    problems: ProblemsetProblem[];
    problemStatistics: { contestId: number; index: string; solvedCount: number }[];
  }>('problemset.problems');
  const solved = new Map(r.problemStatistics.map((s) => [`${s.contestId}-${s.index}`, s.solvedCount]));
  return r.problems.map((p) => ({
    contestId: p.contestId,
    index: p.index,
    name: p.name,
    rating: p.rating,
    tags: p.tags,
    solvedCount: solved.get(`${p.contestId}-${p.index}`),
  }));
}

// ---------------------------------------------------------------- contests (predictor, estimates)

export interface StandingsRow {
  handle: string;
  points: number;
  penalty: number;
  /** points > 0 per problem, in problem order */
  solved: boolean[];
  /** true if the party is a team (team contests are unrated) */
  team: boolean;
}

export interface Standings {
  contest: { id: number; name: string; phase: string; startTimeSeconds?: number; durationSeconds: number; type: string };
  problems: { index: string; name: string; rating?: number }[];
  rows: StandingsRow[];
}

/**
 * Official standings. Codeforces only allows the anonymous, parameter-free form for non-gym
 * contests (no showUnofficial, no handles), so these are the official (trusted) rows.
 */
export async function contestStandings(contestId: number): Promise<Standings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await call<any>('contest.standings', { contestId });
  return {
    contest: {
      id: r.contest.id,
      name: r.contest.name,
      phase: r.contest.phase,
      startTimeSeconds: r.contest.startTimeSeconds,
      durationSeconds: r.contest.durationSeconds,
      type: r.contest.type,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    problems: r.problems.map((p: any) => ({ index: p.index, name: p.name, rating: p.rating })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: r.rows.map((row: any) => ({
      handle: row.party.members[0]?.handle ?? '',
      points: row.points,
      penalty: row.penalty,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      solved: row.problemResults.map((pr: any) => pr.points > 0),
      team: row.party.teamId != null || row.party.teamName != null || row.party.members.length > 1,
    })),
  };
}

/** [handle, rank, oldRating, newRating, ratingUpdateTimeSeconds]; null when CF says the contest is unrated. */
export async function contestRatingChanges(contestId: number): Promise<[string, number, number, number, number][] | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await call<any[]>('contest.ratingChanges', { contestId });
    return r.map((c) => [c.handle, c.rank, c.oldRating, c.newRating, c.ratingUpdateTimeSeconds]);
  } catch (e) {
    if (e instanceof CfApiError && /unavailable/i.test(e.message)) return null;
    throw e;
  }
}

/** Current rating of every rated user (≈18 MB from the API; stored as handle → rating). */
export async function userRatedList(): Promise<Record<string, number>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users = await call<any[]>('user.ratedList', { activeOnly: 'false', includeRetired: 'true' });
  const out: Record<string, number> = {};
  for (const u of users) out[u.handle] = u.rating;
  return out;
}

/** user.info for many handles (batched to keep URLs short). Unknown handles are skipped. */
export async function userInfoMany(handles: string[]): Promise<UserInfo[]> {
  const out: UserInfo[] = [];
  for (let i = 0; i < handles.length; i += 300) {
    const batch = handles.slice(i, i + 300);
    try {
      const r = await call<UserInfo[]>('user.info', { handles: batch.join(';') });
      out.push(...r.map((u) => ({ handle: u.handle, rating: u.rating, maxRating: u.maxRating, rank: u.rank })));
    } catch (e) {
      // One unknown handle fails the whole batch: fall back to one at a time.
      if (!(e instanceof CfApiError) || batch.length === 1) continue;
      for (const h of batch) {
        try {
          const [u] = await call<UserInfo[]>('user.info', { handles: h });
          out.push({ handle: u.handle, rating: u.rating, maxRating: u.maxRating, rank: u.rank });
        } catch {
          /* renamed or deleted account */
        }
      }
    }
  }
  return out;
}

export const contestListAll = contestList;
