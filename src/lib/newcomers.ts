/**
 * Codeforces' newcomer rule (since 2020, contest ≥ 1360): a new account is rated as 1400 internally,
 * but its *displayed* rating starts at 0 and gets bonuses over the first six contests:
 * +500, +350, +250, +150, +100, +50 (1400 in total). So after k < 6 contests:
 *
 *   real rating      = displayed + (1400 − CUMULATIVE[k])
 *   displayed change = real change + BONUS[k]
 *
 * Predictions must run on real ratings, or every newcomer looks far weaker than they are and the
 * zero-sum correction drags everyone else down (≈15 points in a typical Div. 2).
 */
export const BONUS = [500, 350, 250, 150, 100, 50];
export const CUMULATIVE = [0, 500, 850, 1100, 1250, 1350, 1400];

/** Hidden rating offset for someone who has completed `k` rated contests (0 once k ≥ 6). */
export const hiddenOffset = (k: number) => (k >= 6 ? 0 : 1400 - CUMULATIVE[k]);
export const displayBonus = (k: number) => (k >= 6 ? 0 : BONUS[k]);

/** [handle, rank, oldRating, newRating, ratingUpdateTimeSeconds] — compact contest.ratingChanges row. */
export type ChangeRow = [string, number, number, number, number];

/**
 * Number of rated contests completed by each newcomer, from a window of past contests' rating
 * changes (any order). A row with oldRating 0 marks someone's first rated contest, so a handle's
 * count is exact when that first contest is inside the window. Handles not found are treated as
 * established (≥ 6 contests). Only handles with fewer than 6 contests are returned.
 */
export function newcomerCounts(history: ChangeRow[][]): Map<string, number> {
  const firstSeen = new Map<string, number>(); // handle -> time of their first-ever rated contest
  const events = new Map<string, number[]>(); // handle -> times of rated contests in the window
  for (const contest of history) {
    for (const [handle, , oldRating, , time] of contest) {
      if (oldRating === 0) firstSeen.set(handle, Math.min(time, firstSeen.get(handle) ?? Infinity));
      let e = events.get(handle);
      if (!e) events.set(handle, (e = []));
      e.push(time);
    }
  }
  const out = new Map<string, number>();
  for (const [handle, first] of firstSeen) {
    const k = events.get(handle)!.filter((t) => t >= first).length;
    if (k < 6) out.set(handle, k);
  }
  return out;
}
