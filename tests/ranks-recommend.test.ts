import { describe, expect, it } from 'vitest';
import { buildModel, tagStats } from '../src/lib/model';
import { bandOf } from '../src/lib/ranks';
import { recommend, targetRating, weakTags } from '../src/lib/recommend';
import type { ProblemsetProblem } from '../src/lib/types';
import { upsolveGroups } from '../src/lib/upsolve';
import { sub } from './helpers';

describe('bands', () => {
  it('maps edges to the upper band', () => {
    expect(bandOf(undefined)).toBe('unrated');
    expect(bandOf(1199)).toBe('newbie');
    expect(bandOf(1200)).toBe('pupil');
    expect(bandOf(1899)).toBe('expert');
    expect(bandOf(1900)).toBe('cm');
    expect(bandOf(2399)).toBe('im');
    expect(bandOf(3000)).toBe('lgm');
  });
});

describe('recommend & upsolve', () => {
  const model = buildModel([
    sub({ at: '2025-01-01', contestId: 1, index: 'A', rating: 1500, tags: ['math'] }),
    sub({ at: '2025-01-02', contestId: 2, index: 'A', rating: 1500, tags: ['dp'], verdict: 'WRONG_ANSWER', participantType: 'CONTESTANT' }),
  ]);
  const ps: ProblemsetProblem[] = [
    { contestId: 1, index: 'A', name: 'solved', rating: 1500, tags: ['math'] },
    { contestId: 2, index: 'A', name: 'tried', rating: 1500, tags: ['dp'] },
    { contestId: 2, index: 'B', name: 'left', rating: 1700, tags: ['dp'] },
    { contestId: 2, index: 'C', name: 'too hard', rating: 2600, tags: ['dp'] },
    { contestId: 3, index: 'A', name: 'graph', rating: 1700, tags: ['graphs'], solvedCount: 5000 },
    { contestId: 3, index: 'B', name: 'graph hard', rating: 2400, tags: ['graphs'] },
  ];

  it('targets your rating, rounded', () => {
    expect(targetRating(model, 1563)).toBe(1600);
    expect(targetRating(model, null)).toBe(1500);
  });

  it('recommends only untouched problems in band and weak tags', () => {
    const recs = recommend(model, ps, ['graphs', 'dp'], 1500);
    const names = recs.map((r) => r.problem.name).sort();
    expect(names).toEqual(['graph', 'left']);
  });

  it('falls back to least-practised mainstream tags', () => {
    expect(weakTags(tagStats(model)).length).toBeGreaterThanOrEqual(3);
  });

  it('upsolve groups problems from entered contests, capped at rating + 400', () => {
    const g = upsolveGroups(model, ps, [], [{ id: 2, name: 'Round 2', type: 'CF', phase: 'FINISHED', durationSeconds: 7200 }], 1500);
    expect(g).toHaveLength(1);
    expect(g[0].contestName).toBe('Round 2');
    expect(g[0].problems.map((p) => [p.index, p.tried])).toEqual([
      ['A', true],
      ['B', false],
    ]);
  });
});


import { tipPos } from '../src/components/Analytics';
describe('tooltip placement', () => {
  it('anchors inside the chart at both edges', () => {
    expect(tipPos(0, 15, 10).transform).toBe('translateX(-12px)');
    expect(tipPos(7, 15, 10).transform).toBe('translateX(-50%)');
    expect(tipPos(14, 15, 10).transform).toBe('translateX(calc(-100% + 12px))');
  });
});
