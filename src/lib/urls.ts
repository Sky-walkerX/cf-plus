import type { Problem } from './types';

export function problemUrl(p: Pick<Problem, 'contestId' | 'index' | 'problemsetName'>): string {
  if (p.problemsetName) return `https://codeforces.com/problemsets/${p.problemsetName}/problem/99999/${p.index}`;
  if (p.contestId != null && p.contestId >= 100000) return `https://codeforces.com/gym/${p.contestId}/problem/${p.index}`;
  return `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
}

export const contestUrl = (id: number) =>
  id >= 100000 ? `https://codeforces.com/gym/${id}` : `https://codeforces.com/contest/${id}`;
