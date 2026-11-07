import { describe, expect, it } from 'vitest';
import {
  activitySummary,
  addDays,
  buildModel,
  currentStreak,
  dayKey,
  indexStats,
  languageFamily,
  longestStreak,
  ratingHistogram,
  solveStats,
  tagStats,
  verdictStats,
} from '../src/lib/model';
import { sub } from './helpers';

describe('dates', () => {
  it('steps over the US DST change by calendar days', () => {
    expect(addDays('2025-03-08', 1)).toBe('2025-03-09');
    expect(addDays('2025-03-09', 1)).toBe('2025-03-10');
    expect(addDays('2025-11-02', 1)).toBe('2025-11-03');
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
  });

  it('buckets by local day, not UTC', () => {
    // 23:30 local in New York is already the next day in UTC.
    const m = buildModel([sub({ at: '2025-06-01 23:30' })]);
    expect([...m.days.keys()]).toEqual(['2025-06-01']);
  });
});

describe('buildModel', () => {
  it('counts a problem once, on its first AC', () => {
    const m = buildModel([
      sub({ at: '2025-01-02', index: 'A', verdict: 'OK' }),
      sub({ at: '2025-01-05', index: 'A', verdict: 'OK' }),
      sub({ at: '2025-01-01', index: 'A', verdict: 'WRONG_ANSWER' }),
    ]);
    expect(m.solves).toHaveLength(1);
    expect(m.solves[0].day).toBe('2025-01-02');
    expect(m.solves[0].attemptsBeforeAc).toBe(1);
  });

  it('ignores compilation errors when counting tries', () => {
    const m = buildModel([
      sub({ at: '2025-01-01 10:00', verdict: 'COMPILATION_ERROR' }),
      sub({ at: '2025-01-01 11:00', verdict: 'OK' }),
    ]);
    expect(m.solves[0].attemptsBeforeAc).toBe(0);
  });

  it('dedupes Div.1/Div.2 mirrors by name and adjacent contest id', () => {
    const m = buildModel([
      sub({ at: '2025-01-01', contestId: 2000, index: 'C', name: 'Same' }),
      sub({ at: '2025-01-02', contestId: 2001, index: 'A', name: 'Same' }),
      sub({ at: '2025-01-03', contestId: 2050, index: 'A', name: 'Same' }), // different round, same title
    ]);
    expect(m.solves.map((s) => s.problem.contestId)).toEqual([2000, 2050]);
    expect(m.solvedKeys.has('2001-A')).toBe(true); // still "solved" for spoiler/upsolve purposes
  });

  it('tracks tried-but-unsolved problems', () => {
    const m = buildModel([sub({ at: '2025-01-01', index: 'B', verdict: 'WRONG_ANSWER' }), sub({ at: '2025-01-02', index: 'B', verdict: 'TIME_LIMIT_EXCEEDED' })]);
    expect(m.attempted).toHaveLength(1);
    expect(m.attempted[0].attempts).toBe(2);
    expect(m.attemptedKeys.has('1000-B')).toBe(true);
  });

  it('records the max rating per day and sorts the day hardest-first', () => {
    const m = buildModel([
      sub({ at: '2025-02-01 09:00', index: 'A', rating: 800 }),
      sub({ at: '2025-02-01 10:00', index: 'B', rating: 1700 }),
      sub({ at: '2025-02-01 11:00', index: 'C' }), // unrated
    ]);
    const b = m.days.get('2025-02-01')!;
    expect(b.count).toBe(3);
    expect(b.maxRating).toBe(1700);
    expect(b.solves.map((s) => s.rating)).toEqual([1700, 800, undefined]);
  });
});

describe('streaks', () => {
  const m = buildModel(
    ['2025-03-07', '2025-03-08', '2025-03-09', '2025-03-10', '2025-03-15', '2025-03-16'].map((d, i) =>
      sub({ at: d, index: String.fromCharCode(65 + i) }),
    ),
  );
  it('finds the longest run across DST', () => expect(longestStreak(m.days, '0000', '9999')).toBe(4));
  it('respects the window', () => expect(longestStreak(m.days, '2025-03-09', '9999')).toBe(2));
  it('current streak counts from today, or from yesterday if today is empty', () => {
    expect(currentStreak(m.days, '2025-03-16')).toBe(2);
    expect(currentStreak(m.days, '2025-03-17')).toBe(2);
    expect(currentStreak(m.days, '2025-03-18')).toBe(0);
  });
  it('summarises relative to now', () => {
    const s = activitySummary(m, new Date(2025, 2, 16, 12));
    expect(s).toMatchObject({ total: 6, lastMonth: 6, maxStreak: 4, currentStreak: 2 });
  });
});

describe('distributions', () => {
  const m = buildModel([
    sub({ at: '2025-01-01', index: 'A', rating: 800, tags: ['math', 'greedy'], participantType: 'CONTESTANT' }),
    sub({ at: '2025-01-02', index: 'B', rating: 1000, tags: ['math'] }),
    sub({ at: '2025-01-03', index: 'C', rating: 1200, tags: ['dp', '*special'] }),
    sub({ at: '2025-01-04', index: 'D', rating: 1200, verdict: 'WRONG_ANSWER' }),
    sub({ at: '2025-01-05', index: 'B1', rating: 900, programmingLanguage: 'PyPy 3-64' }),
  ]);

  it('fills empty rating bins between min and max', () => {
    const bins = ratingHistogram(m);
    expect(bins.map((b) => b.rating)).toEqual([800, 900, 1000, 1100, 1200]);
    expect(bins.find((b) => b.rating === 1200)!.attempted).toHaveLength(1);
  });

  it('computes tag stats and skips special tags', () => {
    const t = tagStats(m);
    expect(t[0]).toMatchObject({ tag: 'math', count: 2, avgRating: 900, maxRating: 1000 });
    expect(t.find((x) => x.tag === '*special')).toBeUndefined();
  });

  it('groups verdicts and languages', () => {
    expect(verdictStats(m)).toEqual([
      { label: 'Accepted', count: 4 },
      { label: 'Wrong answer', count: 1 },
    ]);
    expect(languageFamily('PyPy 3-64')).toBe('Python');
    expect(languageFamily('GNU C11')).toBe('C');
    expect(languageFamily('C++23 (GCC 14-64, msys2)')).toBe('C++');
    expect(languageFamily('Kotlin 2.2')).toBe('Kotlin');
    expect(languageFamily('Java 21 64bit')).toBe('Java');
  });

  it('splits index letters into contest vs practice, folding B1 into B', () => {
    expect(indexStats(m)).toEqual([
      { letter: 'A', contest: 1, practice: 0 },
      { letter: 'B', contest: 0, practice: 2 },
      { letter: 'C', contest: 0, practice: 1 },
    ]);
  });

  it('solve stats', () => {
    const s = solveStats(m);
    expect(s.solved).toBe(4);
    expect(s.maxRatingSolved).toBe(1200);
    expect(s.firstTryRate).toBe(1);
  });

  it('dayKey formats local dates', () => expect(dayKey(new Date(2025, 0, 5))).toBe('2025-01-05'));
});
