/** Compact per-friend solve index, built from user.status (pure). */
import { problemKey } from './model';
import type { Submission } from './types';

export interface FriendIndex {
  handle: string;
  /** problem key → [first AC time (s), submission id, contestId, 1 if solved in contest/virtual] */
  solved: Record<string, [number, number, number, 0 | 1]>;
  /** problem key → last rejected attempt time (s), for unsolved problems */
  tried: Record<string, number>;
  /** newest submission id with a final verdict */
  settledId: number;
  syncedAt: number;
}

const IN_CONTEST = new Set(['CONTESTANT', 'OUT_OF_COMPETITION', 'VIRTUAL']);
const IGNORE = new Set(['COMPILATION_ERROR', 'SKIPPED', 'TESTING', undefined]);

export function emptyIndex(handle: string): FriendIndex {
  return { handle, solved: {}, tried: {}, settledId: 0, syncedAt: 0 };
}

/** Fold submissions (any order) into an index. Idempotent. */
export function addSubmissions(idx: FriendIndex, subs: Submission[]): FriendIndex {
  const sorted = [...subs].sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id);
  for (const s of sorted) {
    if (s.problem.contestId == null) continue;
    const key = problemKey(s.problem);
    if (s.verdict === 'OK') {
      const cur = idx.solved[key];
      if (!cur || s.creationTimeSeconds < cur[0]) {
        idx.solved[key] = [s.creationTimeSeconds, s.id, s.problem.contestId, IN_CONTEST.has(s.participantType) ? 1 : 0];
      }
      delete idx.tried[key];
    } else if (!IGNORE.has(s.verdict) && !idx.solved[key]) {
      idx.tried[key] = Math.max(idx.tried[key] ?? 0, s.creationTimeSeconds);
    }
    if (s.verdict && s.verdict !== 'TESTING') idx.settledId = Math.max(idx.settledId, s.id);
  }
  return idx;
}

export interface FriendOnProblem {
  handle: string;
  rating?: number;
  at: number;
  submissionId?: number;
  contestId?: number;
  inContest?: boolean;
}

export function friendsOnProblem(indexes: FriendIndex[], key: string, ratings: Map<string, number | undefined>) {
  const solved: FriendOnProblem[] = [];
  const tried: FriendOnProblem[] = [];
  for (const idx of indexes) {
    const s = idx.solved[key];
    if (s) solved.push({ handle: idx.handle, rating: ratings.get(idx.handle), at: s[0], submissionId: s[1], contestId: s[2], inContest: s[3] === 1 });
    else if (idx.tried[key]) tried.push({ handle: idx.handle, rating: ratings.get(idx.handle), at: idx.tried[key] });
  }
  solved.sort((a, b) => a.at - b.at);
  tried.sort((a, b) => b.at - a.at);
  return { solved, tried };
}

/** Number of friends who solved each of `keys`. */
export function friendCounts(indexes: FriendIndex[], keys: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of keys) {
    const who = indexes.filter((i) => i.solved[k]).map((i) => i.handle);
    if (who.length) out[k] = who;
  }
  return out;
}

/** Handles from Codeforces' /friends page HTML (logged in). Excludes your own handle. */
export function parseFriendsPage(doc: Document, self: string | null): string[] {
  const root = doc.querySelector('#pageContent') ?? doc.body;
  const out = new Set<string>();
  for (const a of root.querySelectorAll<HTMLAnchorElement>('.datatable a[href*="/profile/"], table a.rated-user[href*="/profile/"]')) {
    const m = (a.getAttribute('href') ?? '').match(/\/profile\/([^/?#]+)/);
    if (m) {
      const h = decodeURIComponent(m[1]);
      if (!self || h.toLowerCase() !== self.toLowerCase()) out.add(h);
    }
  }
  return [...out];
}
