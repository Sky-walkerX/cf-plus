import { describe, expect, it } from 'vitest';
import { fitDifficulty, roundRating } from '../src/lib/difficulty';
import { BONUS, CUMULATIVE, displayBonus, hiddenOffset, newcomerCounts, type ChangeRow } from '../src/lib/newcomers';
import { contestCount, livePredictions, placeInField, realRating, whatIfPrediction } from '../src/lib/predictor';
import { predict, ranksFromScores } from '../src/lib/rating-calc';

describe('rating calculator', () => {
  it('shares the worst rank among ties', () => {
    const r = ranksFromScores([
      { handle: 'a', points: 10, penalty: 5 },
      { handle: 'b', points: 10, penalty: 5 },
      { handle: 'c', points: 9, penalty: 0 },
      { handle: 'd', points: 10, penalty: 1 },
    ]);
    expect(Object.fromEntries(r.map((x) => [x.handle, x.rank]))).toEqual({ d: 1, a: 3, b: 3, c: 4 });
  });

  it('rewards beating your seed; the average change is between −11 and 0 (CF anti-inflation)', () => {
    const field = Array.from({ length: 200 }, (_, i) => ({ handle: `u${i}`, rank: i + 1, rating: 1500 }));
    // A 1200 who wins and a 1800 who comes last.
    field[0].rating = 1200;
    field[199].rating = 1800;
    const res = new Map(predict(field).map((p) => [p.handle, p]));
    expect(res.get('u0')!.delta).toBeGreaterThan(100);
    expect(res.get('u199')!.delta).toBeLessThan(-100);
    const mean = [...res.values()].reduce((a, p) => a + p.delta, 0) / field.length;
    expect(mean).toBeLessThanOrEqual(0);
    expect(mean).toBeGreaterThanOrEqual(-11);
  });

  it('equal ratings: better rank never gets a smaller change', () => {
    const res = predict(Array.from({ length: 50 }, (_, i) => ({ handle: `u${i}`, rank: i + 1, rating: 1600 })));
    for (let i = 1; i < res.length; i++) expect(res[i].delta).toBeLessThanOrEqual(res[i - 1].delta);
  });

  it('performance breaks even: delta at that rating is ~0', () => {
    const field = Array.from({ length: 300 }, (_, i) => ({ handle: `u${i}`, rank: i + 1, rating: 1000 + ((i * 37) % 1200) }));
    const res = predict(field, { performance: true });
    const mid = res.find((p) => p.rank === 150)!;
    expect(Number.isFinite(mid.performance)).toBe(true);
    expect(res.find((p) => p.rank === 1)!.performance).toBe(Infinity);
    const again = predict(field.map((c) => (c.handle === mid.handle ? { ...c, rating: mid.performance } : c)));
    expect(Math.abs(again.find((p) => p.handle === mid.handle)!.delta)).toBeLessThanOrEqual(6);
  });
});

describe('newcomers', () => {
  it('bonuses add up to 1400 and offsets shrink to 0', () => {
    expect(BONUS.reduce((a, b) => a + b, 0)).toBe(1400);
    expect(CUMULATIVE[6]).toBe(1400);
    expect([0, 1, 2, 3, 4, 5, 6].map(hiddenOffset)).toEqual([1400, 900, 550, 300, 150, 50, 0]);
    expect(displayBonus(0)).toBe(500);
    expect(displayBonus(7)).toBe(0);
  });

  it('counts contests from the first-ever one (oldRating 0)', () => {
    const c = (t: number, rows: [string, number][]): ChangeRow[] => rows.map(([h, old]) => [h, 1, old, old + 10, t]);
    const k = newcomerCounts([
      c(100, [['new', 0], ['old', 1500]]),
      c(200, [['new', 510], ['old', 1510], ['later', 0]]),
      c(300, [['new', 870]]),
    ]);
    expect(k.get('new')).toBe(3);
    expect(k.get('later')).toBe(1);
    expect(k.has('old')).toBe(false);
  });

  it('real rating and contest count', () => {
    expect(realRating(undefined, 0)).toBeNull();
    expect(realRating(500, 1)).toBe(1400);
    expect(realRating(1700, 6)).toBe(1700);
    expect(contestCount('x', undefined, new Map())).toBe(0);
    expect(contestCount('x', 600, new Map([['x', 1]]))).toBe(1);
    expect(contestCount('x', 1600, new Map())).toBe(6);
  });
});

describe('live predictions', () => {
  it('excludes 2100+ from educational rounds and adds the newcomer bonus', () => {
    const rows = [
      { handle: 'strong', points: 5, penalty: 10 },
      { handle: 'mid', points: 4, penalty: 10 },
      { handle: 'fresh', points: 3, penalty: 10 },
      ...Array.from({ length: 40 }, (_, i) => ({ handle: `p${i}`, points: 2, penalty: i })),
    ];
    const ratings: Record<string, number> = { strong: 2200, mid: 1500 };
    for (let i = 0; i < 40; i++) ratings[`p${i}`] = 1200 + i * 10;
    const cells = livePredictions(rows, (h) => ratings[h], new Map(), { educational: true });
    expect(cells.has('strong')).toBe(false);
    const fresh = cells.get('fresh')!;
    expect(fresh.oldRating).toBe(0);
    expect(fresh.delta).toBeGreaterThan(400); // +500 bonus on top of a 1400-based change
    expect(fresh.newRating).toBe(fresh.delta);
  });
});

describe('what-if placement', () => {
  const official = [
    { handle: 'a', points: 100, penalty: 0, fullRank: 1 },
    { handle: 'b', points: 80, penalty: 0, fullRank: 3 }, // someone hidden is rank 2
    { handle: 'c', points: 80, penalty: 0, fullRank: 3 },
    { handle: 'd', points: 50, penalty: 0, fullRank: 6 },
  ];
  it('slots in after the better rows, counting hidden participants', () => {
    expect(placeInField(official, { handle: 'v', points: 90, penalty: 0 })).toEqual({ rank: 2, shiftFrom: 2 });
    expect(placeInField(official, { handle: 'v', points: 60, penalty: 0 })).toEqual({ rank: 4, shiftFrom: 4 });
    expect(placeInField(official, { handle: 'v', points: 10, penalty: 0 })).toEqual({ rank: 7, shiftFrom: 7 });
  });
  it('joins a tie, pushing its shared rank down by one', () => {
    expect(placeInField(official, { handle: 'v', points: 80, penalty: 0 })).toEqual({ rank: 4, shiftFrom: 3 });
  });
  it('computes a what-if change', () => {
    const field = Array.from({ length: 100 }, (_, i) => ({ handle: `u${i}`, rank: i + 1, rating: 1500 }));
    const off = field.map((f, i) => ({ handle: f.handle, points: 1000 - i, penalty: 0, fullRank: f.rank }));
    const top = whatIfPrediction(field, off, { handle: 'me', points: 5000, penalty: 0, display: 1500, k: 6 });
    const bottom = whatIfPrediction(field, off, { handle: 'me', points: 0, penalty: 0, display: 1500, k: 6 });
    expect(top.kind).toBe('whatif');
    expect(top.delta).toBeGreaterThan(50);
    expect(bottom.delta).toBeLessThan(-50);
  });
});

describe('difficulty', () => {
  it('recovers a planted difficulty from simulated results', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (const D of [1100, 1700, 2300]) {
      const attempts = Array.from({ length: 6000 }, (_, i) => {
        const rating = 700 + (i % 2200);
        return { rating, solved: rnd() < 1 / (1 + Math.pow(10, (D - rating) / 400)) };
      });
      expect(Math.abs(fitDifficulty(attempts)! - D)).toBeLessThan(40);
    }
  });
  it('rounds and clamps like Codeforces', () => {
    expect(roundRating(612)).toBe(800);
    expect(roundRating(1749)).toBe(1700);
    expect(roundRating(1751)).toBe(1800);
    expect(roundRating(4100)).toBe(3500);
    expect(fitDifficulty([{ rating: 1500, solved: true }])).toBeNull();
  });
});
