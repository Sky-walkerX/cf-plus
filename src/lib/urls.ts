import type { Problem } from './types';

export function problemUrl(p: Pick<Problem, 'contestId' | 'index' | 'problemsetName'>): string {
  if (p.problemsetName) return `https://codeforces.com/problemsets/${p.problemsetName}/problem/99999/${p.index}`;
  if (p.contestId != null && p.contestId >= 100000) return `https://codeforces.com/gym/${p.contestId}/problem/${p.index}`;
  return `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
}

export const contestUrl = (id: number) =>
  id >= 100000 ? `https://codeforces.com/gym/${id}` : `https://codeforces.com/contest/${id}`;

/**
 * Avatar/title-photo URL that actually loads. The API returns userpic.codeforces.org links, but
 * that host is often unreachable; codeforces.com serves the same files under /userpic.codeforces.org/.
 */
export function avatarSrc(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, 'https://codeforces.com');
    if (url.protocol !== 'https:') return null;
    if (/^userpic\.codeforces\.(org|com)$/.test(url.hostname)) return `https://codeforces.com/userpic.codeforces.org${url.pathname}`;
    return /(^|\.)codeforces\.(com|org)$/.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}
