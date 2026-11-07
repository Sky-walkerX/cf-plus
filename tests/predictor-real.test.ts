/**
 * Optional accuracy check against real Codeforces data:
 *   CFX_CFDATA=/dir/with/{standings,changes}-<id>.json npx vitest run tests/predictor-real.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { displayBonus, hiddenOffset, newcomerCounts, type ChangeRow } from '../src/lib/newcomers';
import { fieldFromChanges, placeInField, whatIfPrediction } from '../src/lib/predictor';
import { predict, ranksFromScores } from '../src/lib/rating-calc';

const dir = process.env.CFX_CFDATA;
const ids = [2272, 2276, 2275, 2271];
const load = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).result;
const log = (s: string) => process.stderr.write(s + '\n');

function stats(diffs: number[]) {
  const abs = diffs.map(Math.abs).sort((a, b) => a - b);
  const exact = abs.filter((d) => d === 0).length / abs.length;
  const within2 = abs.filter((d) => d <= 2).length / abs.length;
  return `n=${abs.length} exact=${(exact * 100).toFixed(1)}% ≤2=${(within2 * 100).toFixed(1)}% p95=${abs[Math.floor(abs.length * 0.95)]} max=${abs.at(-1)}`;
}

describe.skipIf(!dir)('predictor vs real Codeforces rating changes', () => {
  for (const id of ids) {
    it(`contest ${id}`, () => {
      if (!existsSync(`${dir}/changes-${id}.json`)) return;
      const changes = load(`changes-${id}.json`) as { handle: string; rank: number; oldRating: number; newRating: number }[];
      const actual = new Map(changes.map((c) => [c.handle, c]));
      const displayDelta = (c: { oldRating: number; newRating: number }, predicted: number) =>
        c.oldRating === 0 ? predicted + 500 : predicted; // first contest: +500 display bonus

      // A) the full rated set, CF's ranks and ratings → should reproduce CF exactly
      const full = predict(changes.map((c) => ({ handle: c.handle, rank: c.rank, rating: c.oldRating === 0 ? null : c.oldRating })));
      const diffA = full.map((p) => displayDelta(actual.get(p.handle)!, p.delta) - (actual.get(p.handle)!.newRating - actual.get(p.handle)!.oldRating));
      const established = full.filter((p) => actual.get(p.handle)!.oldRating >= 1400);
      const diffA2 = established.map((p) => p.delta - (actual.get(p.handle)!.newRating - actual.get(p.handle)!.oldRating));
      log(`[${id}] A full set:          ${stats(diffA)}`);
      log(`[${id}] A rated ≥1400 only:  ${stats(diffA2)}`);

      // B) live-like: only official standings rows (what the API returns), ranks from points
      const rows = load(`standings-${id}.json`).rows as { party: { members: { handle: string }[] }; points: number; penalty: number }[];
      const ranked = ranksFromScores(rows.map((r) => ({ handle: r.party.members[0].handle, points: r.points, penalty: r.penalty })));
      const live = predict(ranked.filter((r) => actual.has(r.handle)).map((r) => ({ handle: r.handle, rank: r.rank, rating: actual.get(r.handle)!.oldRating || null })));
      const diffB = live.map((p) => displayDelta(actual.get(p.handle)!, p.delta) - (actual.get(p.handle)!.newRating - actual.get(p.handle)!.oldRating));
      log(`[${id}] B official rows only: ${stats(diffB)}`);

      // C) newcomer-aware: contest counts from earlier rounds' rating changes, real ratings in the
      //    calculation, display bonus added back.
      const t0 = Math.min(...(load(`changes-${id}.json`) as { ratingUpdateTimeSeconds: number }[]).map((c) => c.ratingUpdateTimeSeconds));
      const history = readdirSync(dir!)
        .filter((f) => /^rc-\d+\.json$/.test(f))
        .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as ChangeRow[])
        .filter((rows) => rows.length && rows[0][4] < t0);
      const k = newcomerCounts(history);
      const kOf = (c: { handle: string; oldRating: number }) => (c.oldRating === 0 ? 0 : (k.get(c.handle) ?? 6));
      const real = predict(changes.map((c) => ({ handle: c.handle, rank: c.rank, rating: c.oldRating === 0 ? null : c.oldRating + hiddenOffset(kOf(c)) })));
      const diffC = real.map((p) => {
        const c = actual.get(p.handle)!;
        return p.delta + displayBonus(kOf(c)) - (c.newRating - c.oldRating);
      });
      log(`[${id}] C newcomer-aware (history ${history.length} rounds, ${k.size} newcomers): ${stats(diffC)}`);

      // D) what-if (virtual) accuracy: remove real rated participants, slot them back by score only.
      const rowsByHandle = new Map(rows.map((r) => [r.party.members[0].handle, r]));
      const changeRows: ChangeRow[] = changes.map((c) => [c.handle, c.rank, c.oldRating, c.newRating, t0]);
      const field = fieldFromChanges(changeRows, k);
      const official = changes.filter((c) => rowsByHandle.has(c.handle)).map((c) => ({ handle: c.handle, points: rowsByHandle.get(c.handle)!.points, penalty: rowsByHandle.get(c.handle)!.penalty, fullRank: c.rank }));
      const sample = official.filter((_, i) => i % Math.max(1, Math.floor(official.length / 40)) === 0).slice(0, 40);
      const diffD = sample.map((o) => {
        const c = actual.get(o.handle)!;
        const kk = kOf(c);
        const cell = whatIfPrediction(field, official.filter((x) => x.handle !== o.handle), { handle: o.handle, points: o.points, penalty: o.penalty, display: c.oldRating, k: kk });
        return cell.delta - (c.newRating - c.oldRating);
      });
      log(`[${id}] D what-if from score only: ${stats(diffD)}`);
      expect(placeInField(official, { handle: 'x', points: 1e9, penalty: 0 }).rank).toBe(1);
      expect(full.length).toBeGreaterThan(0);
    });
  }
});
