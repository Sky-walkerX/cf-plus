/** Upsolve list: what you tried and didn't finish, plus what you left behind in contests you entered. */
import { MAINSTREAM_TAGS, type Attempted, type Model } from './model';
import type { Contest, ProblemsetProblem, RatingChange } from './types';

export interface UpsolveGroup {
  contestId: number;
  contestName: string;
  problems: (ProblemsetProblem & { tried: boolean })[];
}

const ENTERED = new Set(['CONTESTANT', 'OUT_OF_COMPETITION', 'VIRTUAL']);

export function upsolveGroups(
  model: Model,
  problemset: ProblemsetProblem[],
  ratingHistory: RatingChange[],
  contests: Contest[],
  userRating: number | null,
  maxGroups = 12,
): UpsolveGroup[] {
  const entered = new Set<number>(ratingHistory.map((r) => r.contestId));
  for (const s of model.submissions) if (s.contestId && ENTERED.has(s.participantType)) entered.add(s.contestId);

  const names = new Map<number, string>(contests.map((c) => [c.id, c.name]));
  for (const r of ratingHistory) names.set(r.contestId, r.contestName);

  const cap = (userRating ?? 1200) + 400;
  const byContest = new Map<number, UpsolveGroup>();
  for (const p of problemset) {
    if (p.contestId == null || !entered.has(p.contestId)) continue;
    const key = `${p.contestId}-${p.index}`;
    if (model.solvedKeys.has(key)) continue;
    if (p.rating != null && p.rating > cap) continue;
    let g = byContest.get(p.contestId);
    if (!g) {
      g = { contestId: p.contestId, contestName: names.get(p.contestId) ?? `Contest ${p.contestId}`, problems: [] };
      byContest.set(p.contestId, g);
    }
    g.problems.push({ ...p, tried: model.attemptedKeys.has(key) });
  }
  return [...byContest.values()]
    .map((g) => ({ ...g, problems: g.problems.sort((a, b) => a.index.localeCompare(b.index, 'en', { numeric: true })) }))
    .sort((a, b) => b.contestId - a.contestId)
    .slice(0, maxGroups);
}

export function triedNotSolved(model: Model, limit = 40): Attempted[] {
  return model.attempted.slice(0, limit);
}

export { MAINSTREAM_TAGS };
