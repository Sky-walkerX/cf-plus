/** Background: answers "rating changes for these standings rows" for one contest. */
import { getRatedList, getRatingChanges, getRatings, getStandings, loadNewcomers, newcomersAt, updateNewcomers } from './contest-service';
import {
  contestCount,
  fieldFromChanges,
  finalPredictions,
  isEducational,
  isUnratedByName,
  livePredictions,
  whatIfPrediction,
  type PredictionCell,
  type ScoredRow,
} from './predictor';

export type PredictStatus = 'final' | 'predicted' | 'unrated' | 'upcoming';

export interface PredictRequest {
  contestId: number;
  /** Handles shown on the page (results are returned for these only). */
  handles: string[];
  /** Rows on the page that may be unofficial (virtual, out of competition), with their scores. */
  scored: ScoredRow[];
  /** Handles to compute what-if changes for (e.g. you and your friends). */
  whatIf: string[];
  /** Your handle and number of rated contests (exact newcomer status for yourself). */
  me?: { handle: string; contests: number; rating?: number };
}

export interface PredictResponse {
  status: PredictStatus;
  contestName: string;
  phase: string;
  /** How many participants the calculation used. */
  fieldSize: number;
  /** True while newcomer history is still downloading (slightly lower accuracy). */
  partialHistory: boolean;
  cells: Record<string, PredictionCell>;
}

/** Live predictions are cached briefly (the calculation over ~20k participants takes ~100 ms). */
const memo = new Map<number, { at: number; cells: Map<string, PredictionCell>; fieldSize: number }>();

export async function predictForPage(req: PredictRequest): Promise<PredictResponse> {
  const standings = await getStandings(req.contestId);
  const { contest } = standings;
  const base = { contestName: contest.name, phase: contest.phase, partialHistory: false, fieldSize: 0, cells: {} };
  if (contest.phase === 'BEFORE') return { ...base, status: 'upcoming' };
  if (isUnratedByName(contest.name) || standings.rows.some((r) => r.team)) return { ...base, status: 'unrated' };

  const changes = contest.phase === 'FINISHED' ? await getRatingChanges(req.contestId) : [];
  if (changes === null) return { ...base, status: 'unrated' };
  const endedDaysAgo = (Date.now() / 1000 - (contest.startTimeSeconds ?? 0) - contest.durationSeconds) / 86400;
  if (!changes.length && endedDaysAgo > 4) return { ...base, status: 'unrated' }; // never got rated

  const store = await loadNewcomers();
  const partialHistory = store.processed.length < 20;
  if (partialHistory) void updateNewcomers(60).catch(() => undefined); // improve accuracy for next time

  const out: Record<string, PredictionCell> = {};
  const want = new Set(req.handles);

  if (changes.length) {
    // ---- final: Codeforces' own numbers, performance computed; what-if for unofficial rows
    const t = changes[0][4];
    const ks = newcomersAt(store, changes.map((c) => c[0]), t);
    let cached = memo.get(req.contestId);
    if (!cached || cached.at < Date.now() - 6 * 3600_000) {
      cached = { at: Date.now(), cells: finalPredictions(changes, ks), fieldSize: changes.length };
      memo.set(req.contestId, cached);
    }
    for (const h of want) {
      const c = cached.cells.get(h);
      if (c) out[h] = c;
    }
    const unofficial = req.scored.filter((r) => !cached!.cells.has(r.handle) && req.whatIf.includes(r.handle)).slice(0, 25);
    if (unofficial.length) {
      const fullRank = new Map(changes.map(([h, rank]) => [h, rank]));
      const official = standings.rows.filter((r) => fullRank.has(r.handle)).map((r) => ({ ...r, fullRank: fullRank.get(r.handle)! }));
      const field = fieldFromChanges(changes, ks);
      const ratings = await getRatings(unofficial.map((r) => r.handle));
      const nowStore = newcomersAt(store, unofficial.map((r) => r.handle), Date.now() / 1000);
      for (const r of unofficial) {
        const mine = req.me && req.me.handle.toLowerCase() === r.handle.toLowerCase();
        const display = mine ? req.me!.rating : ratings.get(r.handle);
        const k = mine ? Math.min(6, req.me!.contests) : contestCount(r.handle, display, nowStore);
        out[r.handle] = whatIfPrediction(field, official, { ...r, display, k });
      }
    }
    return { ...base, status: 'final', partialHistory, fieldSize: changes.length, cells: out };
  }

  // ---- predicted: official standings + current ratings
  let cached = memo.get(req.contestId);
  const ttl = contest.phase === 'CODING' ? 60_000 : 5 * 60_000;
  if (!cached || cached.at < Date.now() - ttl) {
    const ratings = await getRatedList((contest.startTimeSeconds ?? 0) * 1000);
    const ks = newcomersAt(store, standings.rows.map((r) => r.handle), Date.now() / 1000);
    const cells = livePredictions(standings.rows, (h) => ratings[h], ks, { educational: isEducational(contest.name) });
    cached = { at: Date.now(), cells, fieldSize: cells.size };
    memo.set(req.contestId, cached);
  }
  for (const h of want) {
    const c = cached.cells.get(h);
    if (c) out[h] = c;
  }
  return { ...base, status: 'predicted', partialHistory, fieldSize: cached.fieldSize, cells: out };
}
