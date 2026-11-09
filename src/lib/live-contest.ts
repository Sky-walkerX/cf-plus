import type { ProblemResult, Standings, StandingsRow } from './cf-api';
import type { Submission } from './types';

export interface LiveContest {
  contest: Standings['contest'];
  problems: Standings['problems'];
  row: StandingsRow | null;
  submissions: Submission[];
  fetchedAt: number;
  verdictsStale?: boolean;
}

export function ownRow(rows: StandingsRow[], handle: string): StandingsRow | null {
  return rows.find((r) => (r.members ?? [r.handle]).some((h) => h.toLowerCase() === handle.toLowerCase())) ?? null;
}

/** Standard CF scoring: elapsed whole minutes, 50 per rejected attempt, 30% floor. */
export function pointsIfSolved(base: number, seconds: number, rejected: number): number {
  return Math.floor(Math.max(base * 0.3, base * (1 - Math.max(0, Math.floor(seconds / 60)) / 250) - 50 * rejected));
}

export type VerdictState = 'accepted' | 'partial' | 'rejected' | 'testing' | 'unattempted';
export function problemState(result: ProblemResult | undefined, submissions: Submission[], type: string, base?: number): { state: VerdictState; label: string } {
  const latest = [...submissions].sort((a, b) => b.id - a.id)[0];
  if (latest && (!latest.verdict || latest.verdict === 'TESTING')) return { state: 'testing', label: 'Testing' };
  if (result && result.points > 0) {
    if (type === 'IOI' && (base == null || result.points < base)) return { state: 'partial', label: 'Partial score' };
    return { state: 'accepted', label: result.type === 'PRELIMINARY' ? 'Pretests passed' : 'Accepted' };
  }
  if (latest?.verdict === 'OK') return { state: 'accepted', label: 'Accepted' };
  if (latest || (result?.rejectedAttemptCount ?? 0) > 0) return { state: 'rejected', label: latest?.verdict?.toLowerCase().replaceAll('_', ' ') ?? 'Rejected' };
  return { state: 'unattempted', label: 'Not attempted' };
}
