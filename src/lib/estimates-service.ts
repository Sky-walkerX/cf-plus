/** Background: problem ratings per contest: official where Codeforces has one, estimated otherwise. */
import { cacheGet, cacheSet } from './cache';
import { getRatedList, getRatingChanges, getStandings, loadNewcomers, newcomersAt } from './contest-service';
import { fitDifficulty, roundRating, type Attempt } from './difficulty';
import { hiddenOffset } from './newcomers';

export interface ProblemRating {
  rating: number;
  estimated: boolean;
}
export type ContestRatings = Record<string, ProblemRating>;

const HOUR = 3600_000;

/** Ratings for one contest's problems. Empty while the contest is running (no spoilers). */
export async function contestProblemRatings(contestId: number): Promise<ContestRatings> {
  const key = `est:${contestId}`;
  const c = await cacheGet<{ ratings: ContestRatings; complete: boolean }>(key);
  if (c && (c.value.complete || c.age < 6 * HOUR)) return c.value.ratings;

  const standings = await getStandings(contestId);
  const { contest, problems, rows } = standings;
  if (contest.phase === 'BEFORE' || contest.phase === 'CODING') return {};

  const out: ContestRatings = {};
  const missing: number[] = [];
  problems.forEach((p, i) => {
    if (p.rating) out[p.index] = { rating: p.rating, estimated: false };
    else missing.push(i);
  });

  if (missing.length && rows.length >= 30) {
    // Ratings before the contest: exact from rating changes when published, else current ratings.
    const changes = contest.phase === 'FINISHED' ? await getRatingChanges(contestId).catch(() => null) : null;
    const store = await loadNewcomers();
    let ratingOf: (h: string) => number | undefined;
    if (changes && changes.length) {
      const ks = newcomersAt(store, changes.map((r) => r[0]), changes[0][4]);
      const old = new Map(changes.map(([h, , o]) => [h, o === 0 ? 1400 : o + hiddenOffset(ks.get(h) ?? 6)]));
      ratingOf = (h) => old.get(h);
    } else {
      const list = await getRatedList((contest.startTimeSeconds ?? 0) * 1000);
      const ks = newcomersAt(store, rows.map((r) => r.handle), Date.now() / 1000);
      ratingOf = (h) => (list[h] == null ? 1400 : list[h] + hiddenOffset(ks.get(h) ?? 6));
    }
    for (const i of missing) {
      const attempts: Attempt[] = [];
      for (const r of rows) {
        const rating = ratingOf(r.handle);
        if (rating != null) attempts.push({ rating, solved: r.solved[i] });
      }
      const d = fitDifficulty(attempts);
      if (d != null) out[problems[i].index] = { rating: roundRating(d), estimated: true };
      else if (attempts.length && attempts.every((a) => a.solved)) out[problems[i].index] = { rating: 800, estimated: true };
    }
  }

  const complete = missing.length === 0;
  await cacheSet(key, { ratings: out, complete });
  return out;
}

/** Ratings for several contests (sequential: each may need API calls). */
export async function problemRatings(contestIds: number[]): Promise<Record<number, ContestRatings>> {
  const out: Record<number, ContestRatings> = {};
  for (const id of [...new Set(contestIds)].slice(0, 12)) {
    try {
      out[id] = await contestProblemRatings(id);
    } catch {
      out[id] = {};
    }
  }
  return out;
}
