/** Practice recommendations: unsolved problems slightly above your level, in your weakest tags. */
import { MAINSTREAM_TAGS, percentile, type Model, type TagStat } from './model';
import type { ProblemsetProblem } from './types';

export interface Recommendation {
  problem: ProblemsetProblem;
  tag: string;
}

/** Your rating if rated; otherwise the 80th percentile of your last 50 rated solves. Rounded to 100. */
export function targetRating(model: Model, userRating: number | null | undefined): number {
  if (userRating) return Math.round(userRating / 100) * 100;
  const recent = model.solves.filter((s) => s.rating != null).slice(-50).map((s) => s.rating!);
  return Math.round((percentile(recent, 80) ?? 900) / 100) * 100;
}

export function weakTags(stats: TagStat[], k = 5): string[] {
  const weak = stats.filter((s) => s.weak).map((s) => s.tag);
  if (weak.length >= 3) return weak.slice(0, k);
  // Fall back to your least-practised mainstream tags.
  const seen = new Map(stats.map((s) => [s.tag, s.count]));
  const rest = [...MAINSTREAM_TAGS]
    .filter((t) => !weak.includes(t))
    .sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0));
  return [...weak, ...rest].slice(0, k);
}

/** Small deterministic PRNG so "shuffle" is reproducible per seed. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function recommend(
  model: Model,
  problemset: ProblemsetProblem[],
  tags: string[],
  target: number,
  seed = 1,
  count = 8,
): Recommendation[] {
  const lo = target + 100;
  const hi = target + 300;
  const tagSet = new Set(tags);
  const maxContest = Math.max(1, ...problemset.map((p) => p.contestId ?? 0));

  const pool: { r: Recommendation; score: number }[] = [];
  for (const p of problemset) {
    if (p.contestId == null || p.rating == null || p.rating < lo || p.rating > hi) continue;
    const key = `${p.contestId}-${p.index}`;
    if (model.solvedKeys.has(key) || model.attemptedKeys.has(key)) continue;
    const tag = p.tags.find((t) => tagSet.has(t));
    if (!tag) continue;
    const recency = p.contestId / maxContest; // newer problems reflect today's meta
    const popularity = Math.log10((p.solvedCount ?? 0) + 10) / 5; // well-tested, has editorial traffic
    pool.push({ r: { problem: p, tag }, score: recency * 0.7 + popularity * 0.3 });
  }
  pool.sort((a, b) => b.score - a.score);
  const top = pool.slice(0, 80);
  const rand = mulberry32(seed);
  for (let i = top.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [top[i], top[j]] = [top[j], top[i]];
  }
  // Spread across tags: round-robin by tag.
  const byTag = new Map<string, Recommendation[]>();
  for (const { r } of top) {
    const arr = byTag.get(r.tag) ?? [];
    arr.push(r);
    byTag.set(r.tag, arr);
  }
  const out: Recommendation[] = [];
  while (out.length < count && [...byTag.values()].some((a) => a.length)) {
    for (const t of tags) {
      const next = byTag.get(t)?.shift();
      if (next) out.push(next);
      if (out.length >= count) break;
    }
  }
  return out;
}
