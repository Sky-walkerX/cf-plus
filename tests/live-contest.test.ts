import { describe, expect, it } from 'vitest';
import { ownRow, pointsIfSolved, problemState } from '../src/lib/live-contest';
import type { ProblemResult, StandingsRow } from '../src/lib/cf-api';
import { sub } from './helpers';
import { normalize } from '../src/lib/settings';

describe('contest score estimates', () => {
  it('uses whole elapsed minutes and 50-point rejection penalties', () => {
    expect(pointsIfSolved(1000, 10 * 60, 2)).toBe(860);
    expect(pointsIfSolved(1000, 10 * 60 + 59, 2)).toBe(860);
    expect(pointsIfSolved(1000, 11 * 60, 2)).toBe(856);
  });
  it('never goes below 30% and clamps pre-contest time', () => {
    expect(pointsIfSolved(500, 250 * 60, 20)).toBe(150);
    expect(pointsIfSolved(500, -60, 0)).toBe(500);
  });
});

describe('contest verdicts', () => {
  const accepted: ProblemResult = { points: 450, rejectedAttemptCount: 1, type: 'PRELIMINARY' };
  const attempt = (id: number, verdict?: string) => ({ ...sub({ id, contestId: 10, index: 'A', at: '2026-11-08' }), verdict });
  it('shows testing before a stale score and handles missing verdicts', () => {
    expect(problemState(accepted, [attempt(10, 'TESTING')], 'CF').state).toBe('testing');
    expect(problemState(undefined, [attempt(11)], 'CF').state).toBe('testing');
  });
  it('distinguishes pretests, rejection, unattempted and partial IOI scores', () => {
    expect(problemState(accepted, [], 'CF').label).toBe('Pretests passed');
    expect(problemState(undefined, [attempt(10, 'WRONG_ANSWER')], 'CF').label).toBe('wrong answer');
    expect(problemState(undefined, [], 'ICPC').state).toBe('unattempted');
    expect(problemState(accepted, [], 'IOI', 1000).state).toBe('partial');
  });
  it('uses the newest verdict even when the input is unordered', () => {
    expect(problemState(undefined, [attempt(9, 'WRONG_ANSWER'), attempt(11, 'OK'), attempt(10, 'TESTING')], 'CF').state).toBe('accepted');
  });
  it('finds teammates case insensitively without inventing missing ranks', () => {
    const row: StandingsRow = { handle: 'captain', members: ['captain', 'Alice'], rank: 12, points: 100, penalty: 0, solved: [true], team: true };
    expect(ownRow([row], 'alice')).toBe(row);
    expect(ownRow([row], 'virtualUser')).toBeNull();
  });
});

it('migrates old settings and rejects corrupt positions/extra handles', () => {
  const settings = normalize({ theme: 'auto', contestPanelPosition: 'bottom', extraFriends: [null, 5, 'tourist'] });
  expect(settings.contestPanelPosition).toBe('right');
  expect(settings.extraFriends).toEqual(['tourist']);
  expect(settings.profilePreview).toBe(true);
});
