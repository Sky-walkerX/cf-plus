/**
 * Rating predictions for a contest's standings (pure; the background service feeds it data).
 *
 *  - final:     Codeforces has published rating changes → show them exactly; performance is computed.
 *  - predicted: no rating changes yet → run the rating algorithm on the official (trusted) standings
 *               with current ratings, newcomer-aware (hidden ratings + display bonuses).
 *  - what-if:   an unofficial row (virtual, out of competition) → slot it into the real rated field
 *               by its score and compute the change it would have received.
 */
import { displayBonus, hiddenOffset, type ChangeRow } from './newcomers';
import { BANDS, bandOf } from './ranks';
import { predict, ranksFromScores, type Contestant } from './rating-calc';

export const UNRATED_HINTS = ['unrated', 'fools', 'q#', 'kotlin', 'marathon', 'teams'];
export const isUnratedByName = (name: string) => UNRATED_HINTS.some((h) => name.toLowerCase().includes(h));
export const isEducational = (name: string) => name.toLowerCase().includes('educational');
/** Educational rounds rate only participants below this rating. */
export const EDU_RATED_BELOW = 2100;

export type CellKind = 'final' | 'predicted' | 'whatif';

export interface PredictionCell {
  kind: CellKind;
  /** Change in the *displayed* rating (what Codeforces will show). */
  delta: number;
  oldRating: number;
  newRating: number;
  /** Rating at which this result breaks even (real scale). Infinity for rank 1. */
  performance: number | null;
  /** Points still needed for the next rank after this contest, if any. */
  nextRank?: { label: string; need: number };
}

export interface ScoredRow {
  handle: string;
  points: number;
  penalty: number;
}

/** Number of completed rated contests: 0 for unrated, from the newcomer map if < 6, else 6. */
export function contestCount(handle: string, display: number | null | undefined, newcomers: Map<string, number>): number {
  if (display == null || display === 0) return 0;
  return newcomers.get(handle) ?? 6;
}

/** Real (calculation) rating: null means "first contest" (1400 internally). */
export function realRating(display: number | null | undefined, k: number): number | null {
  if (display == null || (display === 0 && k === 0)) return null;
  return display + hiddenOffset(k);
}

function nextRankAfter(newRating: number): PredictionCell['nextRank'] {
  const id = bandOf(newRating);
  const i = BANDS.findIndex((b) => b.id === id);
  const next = BANDS[i + 1];
  if (!next) return undefined;
  return { label: next.label, need: next.min - newRating };
}

/** Exact changes from Codeforces, plus computed performance. */
export function finalPredictions(changes: ChangeRow[], newcomers: Map<string, number>): Map<string, PredictionCell> {
  const ks = new Map(changes.map(([h, , old]) => [h, old === 0 ? 0 : (newcomers.get(h) ?? 6)]));
  const perf = new Map(
    predict(
      changes.map(([handle, rank, old]) => ({ handle, rank, rating: realRating(old, ks.get(handle)!) })),
      { performance: true },
    ).map((p) => [p.handle, p.performance]),
  );
  return new Map(
    changes.map(([handle, , old, neu]) => [
      handle,
      { kind: 'final', delta: neu - old, oldRating: old, newRating: neu, performance: perf.get(handle) ?? null, nextRank: nextRankAfter(neu) },
    ]),
  );
}

/** Predicted changes from official standings and current ratings. */
export function livePredictions(
  rows: ScoredRow[],
  ratingOf: (handle: string) => number | undefined,
  newcomers: Map<string, number>,
  opts: { educational: boolean },
): Map<string, PredictionCell> {
  const rated = opts.educational ? rows.filter((r) => (ratingOf(r.handle) ?? 0) < EDU_RATED_BELOW) : rows;
  const ranked = ranksFromScores(rated);
  const meta = new Map(
    ranked.map((r) => {
      const display = ratingOf(r.handle);
      const k = contestCount(r.handle, display, newcomers);
      return [r.handle, { display: display ?? 0, k }];
    }),
  );
  const results = predict(
    ranked.map((r) => ({ handle: r.handle, rank: r.rank, rating: realRating(meta.get(r.handle)!.display, meta.get(r.handle)!.k) })),
    { performance: true },
  );
  return new Map(
    results.map((p) => {
      const m = meta.get(p.handle)!;
      const delta = p.delta + displayBonus(m.k);
      const newRating = m.display + delta;
      return [p.handle, { kind: 'predicted', delta, oldRating: m.display, newRating, performance: p.performance, nextRank: nextRankAfter(newRating) }];
    }),
  );
}

/**
 * Where an unofficial score would have ranked among *all* rated participants. `official` are the
 * official standings rows that have a rank in the rating changes (fullRank); participants hidden
 * from the API (untrusted) are accounted for through those ranks.
 */
export function placeInField(official: (ScoredRow & { fullRank: number })[], entry: ScoredRow): { rank: number; shiftFrom: number } {
  let better = 0; // highest fullRank among strictly better rows
  let tie: number | null = null;
  for (const r of official) {
    if (r.points > entry.points || (r.points === entry.points && r.penalty < entry.penalty)) better = Math.max(better, r.fullRank);
    else if (r.points === entry.points && r.penalty === entry.penalty) tie = Math.max(tie ?? 0, r.fullRank);
  }
  // Joining a tie pushes the tie's (worst) shared rank down by one; otherwise slot in right after `better`.
  return tie != null ? { rank: tie + 1, shiftFrom: tie } : { rank: better + 1, shiftFrom: better + 1 };
}

/** What-if change for an unofficial participant, given the contest's final rated field. */
export function whatIfPrediction(
  field: Contestant[],
  official: (ScoredRow & { fullRank: number })[],
  entry: ScoredRow & { display: number | null | undefined; k: number },
): PredictionCell {
  const { rank, shiftFrom } = placeInField(official, entry);
  const contestants: Contestant[] = field
    .filter((c) => c.handle !== entry.handle)
    .map((c) => (c.rank >= shiftFrom ? { ...c, rank: c.rank + 1 } : c));
  contestants.push({ handle: entry.handle, rank, rating: realRating(entry.display, entry.k) });
  const me = predict(contestants, { performance: true }).find((p) => p.handle === entry.handle)!;
  const old = entry.display ?? 0;
  const delta = me.delta + displayBonus(entry.k);
  return { kind: 'whatif', delta, oldRating: old, newRating: old + delta, performance: me.performance, nextRank: nextRankAfter(old + delta) };
}

/** The final rated field (ranks + real ratings) from Codeforces' rating changes. */
export function fieldFromChanges(changes: ChangeRow[], newcomers: Map<string, number>): Contestant[] {
  return changes.map(([handle, rank, old]) => ({ handle, rank, rating: realRating(old, old === 0 ? 0 : (newcomers.get(handle) ?? 6)) }));
}
