// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { rampColor, topicColors } from '../src/components/Analytics';
import { addSubmissions, emptyIndex, friendCounts, friendsOnProblem, parseFriendsPage } from '../src/lib/friends';
import { sub } from './helpers';

describe('friend index', () => {
  const idx = addSubmissions(emptyIndex('alice'), [
    sub({ id: 10, at: '2025-01-01', contestId: 5, index: 'A', verdict: 'WRONG_ANSWER' }),
    sub({ id: 11, at: '2025-01-02', contestId: 5, index: 'A', verdict: 'OK', participantType: 'CONTESTANT' }),
    sub({ id: 12, at: '2025-01-03', contestId: 5, index: 'B', verdict: 'TIME_LIMIT_EXCEEDED' }),
    sub({ id: 13, at: '2025-01-04', contestId: 5, index: 'A', verdict: 'OK' }),
  ]);
  it('keeps the first AC and unsolved tries', () => {
    expect(idx.solved['5-A'][1]).toBe(11);
    expect(idx.solved['5-A'][3]).toBe(1);
    expect(idx.tried['5-B']).toBeDefined();
    expect(idx.tried['5-A']).toBeUndefined();
    expect(idx.settledId).toBe(13);
  });
  it('answers per problem and counts', () => {
    const bob = addSubmissions(emptyIndex('bob'), [sub({ id: 20, at: '2025-02-01', contestId: 5, index: 'B', verdict: 'OK' })]);
    const r = friendsOnProblem([idx, bob], '5-B', new Map([['bob', 1700]]));
    expect(r.solved.map((f) => f.handle)).toEqual(['bob']);
    expect(r.solved[0].rating).toBe(1700);
    expect(r.tried.map((f) => f.handle)).toEqual(['alice']);
    expect(friendCounts([idx, bob], ['5-A', '5-B', '6-A'])).toEqual({ '5-A': ['alice'], '5-B': ['bob'] });
  });
});

describe('friends page parsing', () => {
  it('reads handles from the friends table and skips yourself', () => {
    const doc = new DOMParser().parseFromString(
      `<div id="pageContent"><div class="second-level-menu"><a href="/profile/me">me</a></div>
       <div class="datatable"><table><tr><td><a class="rated-user user-blue" href="/profile/alice">alice</a></td></tr>
       <tr><td><a class="rated-user user-red" href="https://codeforces.com/profile/bob">bob</a></td></tr>
       <tr><td><a href="/profile/me">me</a></td></tr></table></div></div>`,
      'text/html',
    );
    expect(parseFriendsPage(doc, 'me').sort()).toEqual(['alice', 'bob']);
  });
});

describe('topic colours', () => {
  it('ramps from green to red across rank colours', () => {
    expect(rampColor(0)).toBe('var(--cfx-rank-pupil)');
    expect(rampColor(1)).toBe('var(--cfx-rank-gm)');
    expect(rampColor(0.1)).toBe('color-mix(in oklch, var(--cfx-rank-specialist) 50%, var(--cfx-rank-pupil))');
  });
  it('spreads topics over the whole ramp and keeps every colour distinct', () => {
    const c = topicColors([
      { tag: 'easy', avgRating: 1150 },
      { tag: 'mid', avgRating: 1200 },
      { tag: 'hard', avgRating: 1300 },
      { tag: 'none', avgRating: null },
    ]);
    expect(c.get('easy')).toBe('var(--cfx-rank-pupil)');
    expect(c.get('hard')).toBe('var(--cfx-rank-gm)');
    expect(c.get('none')).toBe('var(--cfx-rank-unrated)');
    expect(new Set(c.values()).size).toBe(4);
  });
});
