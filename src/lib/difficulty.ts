/**
 * Estimated problem rating, for problems Codeforces hasn't rated yet.
 *
 * Codeforces describes a problem's rating as the rating of a participant who solves it in contest
 * with probability ½. We fit that directly: find D such that the expected number of solvers under
 * P(solve | r) = 1 / (1 + 10^((D − r) / 400)) equals the observed number (the maximum-likelihood
 * estimate for this one-parameter logistic model), then apply a calibration fitted on contests whose
 * official ratings are known, round to 100 and clamp to [800, 3500] like Codeforces.
 */
export interface Attempt {
  /** Contestant's (real) rating before the contest. */
  rating: number;
  solved: boolean;
}

/** Raw maximum-likelihood difficulty (unrounded). Null when nobody or everybody solved it. */
export function fitDifficulty(attempts: Attempt[]): number | null {
  const solved = attempts.filter((a) => a.solved).length;
  if (!attempts.length || solved === 0 || solved === attempts.length) return null;
  const expected = (d: number) => {
    let s = 0;
    for (const a of attempts) s += 1 / (1 + Math.pow(10, (d - a.rating) / 400));
    return s;
  };
  let lo = -2000;
  let hi = 6000;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (expected(mid) > solved) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const roundRating = (d: number) => Math.min(3500, Math.max(800, Math.round(d / 100) * 100));
