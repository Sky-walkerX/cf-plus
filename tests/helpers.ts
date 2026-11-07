import type { Submission } from '../src/lib/types';

let nextId = 1;
/** Build a submission at a LOCAL date/time, e.g. at('2025-03-09 10:00'). */
export function sub(p: Partial<Submission> & { at: string; contestId?: number; index?: string; rating?: number; tags?: string[]; name?: string }): Submission {
  const [d, t = '12:00'] = p.at.split(' ');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const secs = Math.floor(new Date(y, m - 1, dd, hh, mm).getTime() / 1000);
  const contestId = p.contestId ?? 1000;
  return {
    id: p.id ?? nextId++,
    contestId,
    creationTimeSeconds: secs,
    problem: { contestId, index: p.index ?? 'A', name: p.name ?? `P${contestId}${p.index ?? 'A'}`, rating: p.rating, tags: p.tags ?? [] },
    participantType: p.participantType ?? 'PRACTICE',
    programmingLanguage: p.programmingLanguage ?? 'C++20 (GCC 13-64)',
    verdict: p.verdict ?? 'OK',
  };
}
