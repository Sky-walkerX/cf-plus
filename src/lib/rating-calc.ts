/**
 * Codeforces rating change calculation (Mike Mirzayanov's algorithm, as used by Codeforces).
 *
 * Reference: https://codeforces.com/blog/entry/20762 and https://codeforces.com/contest/1/submission/13861109,
 * as ported by TLE (cheran-senthil/TLE) and Carrot (meooow25/carrot, MIT). This is an independent
 * implementation: seeds are precomputed once per contest from a rating histogram (no FFT needed).
 *
 *   seed(r)      = 1 + Σ_others P(other beats r),   P(a beats b) = 1 / (1 + 10^((b − a) / 400))
 *   midRank      = √(rank · seed)
 *   needRating   = the rating whose seed equals midRank
 *   delta        = trunc((needRating − rating) / 2)
 *   then two corrections: make the total ≈ 0, and pull the top 4√n towards a zero sum (≥ −10).
 */

export const MIN_RATING = -500;
export const MAX_RATING = 6000;
/** Rating Codeforces uses in calculations for a participant's first contest. */
export const NEW_USER_RATING = 1400;

const RANGE = MAX_RATING - MIN_RATING; // 6500
/** WIN[d + RANGE] = probability that someone rated x beats someone rated x + d. */
const WIN = new Float64Array(2 * RANGE + 1);
for (let d = -RANGE; d <= RANGE; d++) WIN[d + RANGE] = 1 / (1 + Math.pow(10, d / 400));

/** P(rating a beats rating b). */
const winProb = (a: number, b: number) => WIN[b - a + RANGE];

export interface Contestant {
  handle: string;
  /** Final standings rank (ties share the worst rank of the tie, as on Codeforces). */
  rank: number;
  /** Rating before the contest; undefined/null for a participant's first rated contest. */
  rating?: number | null;
}

export interface Prediction {
  handle: string;
  rank: number;
  /** Rating used in the calculation (1400 for newcomers). */
  effectiveRating: number;
  delta: number;
  /** Rating at which this result would give a delta of 0. Infinity for rank 1. */
  performance: number;
  seed: number;
}

const clamp = (r: number) => Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(r)));
export const effectiveRating = (r: number | null | undefined) => (r == null ? NEW_USER_RATING : clamp(r));

/** Assign ranks from points (desc) and penalty (asc); tied participants share the worst rank. */
export function ranksFromScores<T extends { points: number; penalty: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || a.penalty - b.penalty);
  const out = sorted.map((r) => ({ ...r, rank: 0 }));
  let rank = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    const next = out[i + 1];
    if (!next || out[i].points !== next.points || out[i].penalty !== next.penalty) rank = i + 1;
    out[i].rank = rank;
  }
  return out;
}

function firstTrue(lo: number, hi: number, pred: (x: number) => boolean): number {
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export class RatingCalculator {
  /** seedAll[r − MIN_RATING] = 1 + Σ_all P(c beats r) */
  private seedAll: Float64Array;
  private adjustment = 0;
  readonly results: Prediction[];

  constructor(contestants: Contestant[]) {
    const counts = new Map<number, number>();
    for (const c of contestants) {
      const r = effectiveRating(c.rating);
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const entries = [...counts.entries()];
    this.seedAll = new Float64Array(RANGE + 1);
    for (let r = MIN_RATING; r <= MAX_RATING; r++) {
      let s = 1;
      for (const [v, n] of entries) s += n * winProb(v, r);
      this.seedAll[r - MIN_RATING] = s;
    }
    this.results = contestants.map((c) => ({
      handle: c.handle,
      rank: c.rank,
      effectiveRating: effectiveRating(c.rating),
      delta: 0,
      performance: 0,
      seed: 0,
    }));
  }

  /** Expected rank of a contestant (true rating `self`) if their rating were `r`. */
  seed(r: number, self: number): number {
    return this.seedAll[r - MIN_RATING] - winProb(self, r);
  }

  private rankToRating(rank: number, self: number): number {
    return firstTrue(2, MAX_RATING, (r) => this.seed(r, self) < rank) - 1;
  }

  private rawDelta(p: Prediction, assumed: number): number {
    const midRank = Math.sqrt(p.rank * this.seed(assumed, p.effectiveRating));
    return Math.trunc((this.rankToRating(midRank, p.effectiveRating) - assumed) / 2);
  }

  calculate({ performance = false } = {}): Prediction[] {
    const n = this.results.length;
    if (!n) return [];
    for (const p of this.results) {
      p.seed = this.seed(p.effectiveRating, p.effectiveRating);
      p.delta = this.rawDelta(p, p.effectiveRating);
    }
    // Correction 1: total change ≈ 0 (slightly negative).
    const sum = this.results.reduce((a, p) => a + p.delta, 0);
    const inc1 = Math.trunc(-sum / n) - 1;
    for (const p of this.results) p.delta += inc1;
    // Correction 2: the top 4√n by rating should not gain on average (capped at −10).
    const byRating = [...this.results].sort((a, b) => b.effectiveRating - a.effectiveRating);
    const topN = Math.min(4 * Math.round(Math.sqrt(n)), n);
    const topSum = byRating.slice(0, topN).reduce((a, p) => a + p.delta, 0);
    const inc2 = Math.min(Math.max(Math.trunc(-topSum / topN), -10), 0);
    for (const p of this.results) p.delta += inc2;
    this.adjustment = inc1 + inc2;

    if (performance) {
      for (const p of this.results) {
        p.performance =
          p.rank === 1 ? Infinity : firstTrue(MIN_RATING, MAX_RATING, (r) => this.rawDelta(p, r) + this.adjustment <= 0);
      }
    }
    return this.results;
  }
}

export function predict(contestants: Contestant[], opts?: { performance?: boolean }): Prediction[] {
  return new RatingCalculator(contestants).calculate(opts);
}
