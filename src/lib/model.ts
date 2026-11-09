/**
 * Pure analytics over a user's submissions. No DOM, no chrome.* — fully unit-tested.
 *
 * Counting rules (also shown to users in the heatmap tooltip/legend):
 * - A problem counts once, on the local day of its FIRST accepted submission.
 * - Div.1/Div.2 mirrors (same name, contest ids within ±1) count as one problem.
 * - Problems without a rating (gym, very new, or unrated contests) go in the "unrated" band.
 */
import type { ParticipantType, Problem, Submission } from './types';

export interface Solve {
  key: string;
  problem: Problem;
  rating?: number;
  /** Epoch seconds of the first AC. */
  firstAcAt: number;
  day: string;
  participantType: ParticipantType;
  /** Rejected tries before the first AC (compilation errors and skipped don't count). */
  attemptsBeforeAc: number;
}

export interface Attempted {
  key: string;
  problem: Problem;
  attempts: number;
  lastAt: number;
}

export interface DayBucket {
  day: string;
  solves: Solve[];
  count: number;
  /** Highest rating solved that day; undefined if every solve was unrated. */
  maxRating?: number;
}

/** Every day with at least one submission, solved or not. */
export interface ActivityDay {
  day: string;
  submissions: number;
  /** Problems submitted that day that were not newly solved that day (WAs, re-solves). */
  others: { problem: Problem; accepted: boolean }[];
}

export interface Model {
  solves: Solve[];
  attempted: Attempted[];
  days: Map<string, DayBucket>;
  /** Superset of `days`: also days with only rejected submissions or re-solves. */
  activity: Map<string, ActivityDay>;
  solvedKeys: Set<string>;
  attemptedKeys: Set<string>;
  submissions: Submission[];
}

// ---------- keys & dates ----------

export function problemKey(p: Pick<Problem, 'contestId' | 'problemsetName' | 'index'>): string {
  return `${p.contestId ?? p.problemsetName ?? 'x'}-${p.index}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-timezone YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayKeyFromSeconds(s: number): string {
  return dayKey(new Date(s * 1000));
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** DST-safe: steps by calendar days, not by 86 400 000 ms. */
export function addDays(key: string, n: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

// ---------- build ----------

const IGNORED_FOR_ATTEMPTS = new Set(['COMPILATION_ERROR', 'SKIPPED', 'TESTING', undefined]);

export function buildModel(submissions: Submission[]): Model {
  // Oldest first so the first OK we see is the first AC.
  const subs = [...submissions].sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id);

  const firstAc = new Map<string, Submission>();
  const rejected = new Map<string, number[]>(); // key -> creation times of rejected tries
  const lastSeen = new Map<string, Submission>();

  for (const s of subs) {
    const key = problemKey(s.problem);
    lastSeen.set(key, s);
    if (s.verdict === 'OK') {
      if (!firstAc.has(key)) firstAc.set(key, s);
    } else if (!IGNORED_FOR_ATTEMPTS.has(s.verdict)) {
      let arr = rejected.get(key);
      if (!arr) rejected.set(key, (arr = []));
      arr.push(s.creationTimeSeconds);
    }
  }

  // Mirror dedupe: name -> contest ids already counted.
  const byName = new Map<string, number[]>();
  const solves: Solve[] = [];
  const solvedKeys = new Set<string>();

  const acs = [...firstAc.entries()].sort((a, b) => a[1].creationTimeSeconds - b[1].creationTimeSeconds);
  for (const [key, s] of acs) {
    solvedKeys.add(key);
    const cid = s.problem.contestId;
    if (cid != null) {
      const ids = byName.get(s.problem.name) ?? [];
      if (ids.some((id) => Math.abs(id - cid) <= 1)) continue; // mirror of a problem already counted
      ids.push(cid);
      byName.set(s.problem.name, ids);
    }
    const tries = rejected.get(key)?.filter((t) => t < s.creationTimeSeconds).length ?? 0;
    solves.push({
      key,
      problem: s.problem,
      rating: s.problem.rating,
      firstAcAt: s.creationTimeSeconds,
      day: dayKeyFromSeconds(s.creationTimeSeconds),
      participantType: s.participantType,
      attemptsBeforeAc: tries,
    });
  }

  const attempted: Attempted[] = [];
  const attemptedKeys = new Set<string>();
  for (const [key, times] of rejected) {
    if (firstAc.has(key)) continue;
    attemptedKeys.add(key);
    attempted.push({ key, problem: lastSeen.get(key)!.problem, attempts: times.length, lastAt: times[times.length - 1] });
  }
  attempted.sort((a, b) => b.lastAt - a.lastAt);

  const days = new Map<string, DayBucket>();
  for (const s of solves) {
    let b = days.get(s.day);
    if (!b) days.set(s.day, (b = { day: s.day, solves: [], count: 0 }));
    b.solves.push(s);
    b.count++;
    if (s.rating != null && (b.maxRating == null || s.rating > b.maxRating)) b.maxRating = s.rating;
  }
  for (const b of days.values()) b.solves.sort((x, y) => (y.rating ?? -1) - (x.rating ?? -1));

  const activity = new Map<string, ActivityDay>();
  const othersByDay = new Map<string, Map<string, { problem: Problem; accepted: boolean }>>();
  for (const s of subs) {
    if (s.verdict === 'TESTING') continue;
    const day = dayKeyFromSeconds(s.creationTimeSeconds);
    let a = activity.get(day);
    if (!a) activity.set(day, (a = { day, submissions: 0, others: [] }));
    a.submissions++;
    const key = problemKey(s.problem);
    if (days.get(day)?.solves.some((x) => x.key === key)) continue;
    let others = othersByDay.get(day);
    if (!others) othersByDay.set(day, (others = new Map()));
    const prev = others.get(key);
    others.set(key, { problem: s.problem, accepted: !!prev?.accepted || s.verdict === 'OK' });
  }
  for (const [day, others] of othersByDay) activity.get(day)!.others = [...others.values()];

  return { solves, attempted, days, activity, solvedKeys, attemptedKeys, submissions: subs };
}

// ---------- streaks & totals ----------

/** Longest run of consecutive active days with both ends inside [from, to] (inclusive day keys). */
export function longestStreak(days: Map<string, DayBucket>, from: string, to: string): number {
  const active = [...days.keys()].filter((d) => d >= from && d <= to).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of active) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Current streak: consecutive days ending today, or ending yesterday if today has no solve yet. */
export function currentStreak(days: Map<string, DayBucket>, today: string): number {
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export interface ActivitySummary {
  total: number;
  lastYear: number;
  lastMonth: number;
  maxStreak: number;
  yearStreak: number;
  monthStreak: number;
  currentStreak: number;
}

export function activitySummary(model: Model, now = new Date()): ActivitySummary {
  const today = dayKey(now);
  const yearAgo = addDays(today, -364);
  const monthAgo = addDays(today, -29);
  let lastYear = 0;
  let lastMonth = 0;
  for (const s of model.solves) {
    if (s.day >= yearAgo) lastYear++;
    if (s.day >= monthAgo) lastMonth++;
  }
  return {
    total: model.solves.length,
    lastYear,
    lastMonth,
    maxStreak: longestStreak(model.days, '0000-00-00', today),
    yearStreak: longestStreak(model.days, yearAgo, today),
    monthStreak: longestStreak(model.days, monthAgo, today),
    currentStreak: currentStreak(model.days, today),
  };
}

// ---------- range filtering ----------

export type Range = 'all' | '1y' | '90d';

export function rangeStart(range: Range, now = new Date()): number {
  if (range === 'all') return 0;
  const d = new Date(now);
  d.setDate(d.getDate() - (range === '1y' ? 365 : 90));
  return Math.floor(d.getTime() / 1000);
}

// ---------- distributions ----------

export interface RatingBin {
  rating: number;
  solved: Solve[];
  attempted: Attempted[];
}

export function ratingHistogram(model: Model, since = 0): RatingBin[] {
  const bins = new Map<number, RatingBin>();
  const bin = (r: number) => {
    let b = bins.get(r);
    if (!b) bins.set(r, (b = { rating: r, solved: [], attempted: [] }));
    return b;
  };
  for (const s of model.solves) if (s.rating != null && s.firstAcAt >= since) bin(s.rating).solved.push(s);
  for (const a of model.attempted) if (a.problem.rating != null && a.lastAt >= since) bin(a.problem.rating).attempted.push(a);
  if (bins.size === 0) return [];
  const keys = [...bins.keys()];
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  const out: RatingBin[] = [];
  for (let r = lo; r <= hi; r += 100) out.push(bins.get(r) ?? { rating: r, solved: [], attempted: [] });
  return out;
}

export interface TagStat {
  tag: string;
  count: number;
  avgRating: number | null;
  maxRating: number | null;
  /** Share of all solves in range carrying this tag. */
  share: number;
  weak: boolean;
}

export function tagStats(model: Model, since = 0): TagStat[] {
  const inRange = model.solves.filter((s) => s.firstAcAt >= since);
  const rated = inRange.filter((s) => s.rating != null);
  const overallAvg = rated.length ? rated.reduce((a, s) => a + s.rating!, 0) / rated.length : null;

  const acc = new Map<string, { count: number; sum: number; rated: number; max: number | null }>();
  for (const s of inRange) {
    for (const tag of s.problem.tags) {
      if (tag.startsWith('*')) continue; // "*special problem"
      let t = acc.get(tag);
      if (!t) acc.set(tag, (t = { count: 0, sum: 0, rated: 0, max: null }));
      t.count++;
      if (s.rating != null) {
        t.sum += s.rating;
        t.rated++;
        t.max = t.max == null ? s.rating : Math.max(t.max, s.rating);
      }
    }
  }
  const total = inRange.length || 1;
  const stats = [...acc.entries()].map(([tag, t]) => {
    const avg = t.rated ? Math.round(t.sum / t.rated) : null;
    return { tag, count: t.count, avgRating: avg, maxRating: t.max, share: t.count / total, weak: false };
  });
  stats.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  // Weak: well-known tag where you're clearly behind your own average, or barely practiced.
  if (overallAvg != null && stats.length) {
    const median = stats[Math.floor(stats.length / 2)].count;
    for (const s of stats) {
      const lowRating = s.avgRating != null && s.avgRating < overallAvg - 100 && s.count >= 3;
      const lowVolume = s.count < Math.max(3, median / 3) && MAINSTREAM_TAGS.has(s.tag);
      s.weak = lowRating || lowVolume;
    }
  }
  return stats;
}

/** Tags common enough that "barely practiced" is meaningful. */
export const MAINSTREAM_TAGS = new Set([
  'greedy', 'math', 'implementation', 'constructive algorithms', 'brute force', 'dp', 'sortings',
  'data structures', 'binary search', 'number theory', 'two pointers', 'strings', 'dfs and similar',
  'graphs', 'bitmasks', 'combinatorics', 'trees', 'dsu', 'shortest paths', 'probabilities',
  'hashing', 'geometry', 'interactive', 'games', 'divide and conquer',
]);

export interface CountRow {
  label: string;
  count: number;
}

const VERDICT_LABELS: Record<string, string> = {
  OK: 'Accepted',
  WRONG_ANSWER: 'Wrong answer',
  TIME_LIMIT_EXCEEDED: 'Time limit',
  MEMORY_LIMIT_EXCEEDED: 'Memory limit',
  RUNTIME_ERROR: 'Runtime error',
  COMPILATION_ERROR: 'Compilation error',
  IDLENESS_LIMIT_EXCEEDED: 'Idleness limit',
  CHALLENGED: 'Hacked',
  SKIPPED: 'Skipped',
};

export function verdictStats(model: Model, since = 0): CountRow[] {
  const acc = new Map<string, number>();
  for (const s of model.submissions) {
    if (s.creationTimeSeconds < since || !s.verdict || s.verdict === 'TESTING') continue;
    const label = VERDICT_LABELS[s.verdict] ?? 'Other';
    acc.set(label, (acc.get(label) ?? 0) + 1);
  }
  return [...acc.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function languageFamily(lang: string): string {
  const l = lang.toLowerCase();
  if (l.includes('pypy') || l.includes('python')) return 'Python';
  if (l.includes('c++') || l.includes('g++') || l.includes('clang++')) return 'C++';
  if (l.includes('c#') || l.includes('.net') || l.includes('mono')) return 'C#';
  if (l.includes('kotlin')) return 'Kotlin';
  if (l.includes('java')) return 'Java';
  if (l.includes('rust')) return 'Rust';
  if (l.startsWith('go')) return 'Go';
  if (l.includes('javascript') || l.includes('node')) return 'JavaScript';
  if (l.includes('haskell')) return 'Haskell';
  if (l.includes('ruby')) return 'Ruby';
  if (/(^|\W)c(\W|$)|gnu c11|gnu c/.test(l)) return 'C';
  return lang.split(' ')[0];
}

export function languageStats(model: Model, since = 0): CountRow[] {
  const acc = new Map<string, number>();
  for (const s of model.submissions) {
    if (s.creationTimeSeconds < since) continue;
    const f = languageFamily(s.programmingLanguage);
    acc.set(f, (acc.get(f) ?? 0) + 1);
  }
  return [...acc.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export interface IndexRow {
  letter: string;
  contest: number;
  practice: number;
}

const IN_CONTEST = new Set<ParticipantType>(['CONTESTANT', 'OUT_OF_COMPETITION', 'VIRTUAL']);

export function indexStats(model: Model, since = 0): IndexRow[] {
  const acc = new Map<string, IndexRow>();
  for (const s of model.solves) {
    if (s.firstAcAt < since) continue;
    const letter = s.problem.index.replace(/\d+$/, '').toUpperCase() || s.problem.index;
    if (!/^[A-Z]$/.test(letter)) continue;
    let r = acc.get(letter);
    if (!r) acc.set(letter, (r = { letter, contest: 0, practice: 0 }));
    if (IN_CONTEST.has(s.participantType)) r.contest++;
    else r.practice++;
  }
  return [...acc.values()].sort((a, b) => a.letter.localeCompare(b.letter));
}

export interface SolveStats {
  solved: number;
  maxRatingSolved: number | null;
  recentAvgRating: number | null;
  firstTryRate: number | null;
}

export function solveStats(model: Model, since = 0): SolveStats {
  const inRange = model.solves.filter((s) => s.firstAcAt >= since);
  const rated = inRange.filter((s) => s.rating != null);
  const recent = rated.slice(-30);
  return {
    solved: inRange.length,
    maxRatingSolved: rated.length ? Math.max(...rated.map((s) => s.rating!)) : null,
    recentAvgRating: recent.length ? Math.round(recent.reduce((a, s) => a + s.rating!, 0) / recent.length) : null,
    firstTryRate: inRange.length ? inRange.filter((s) => s.attemptsBeforeAc === 0).length / inRange.length : null,
  };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}
