/**
 * Profile analytics: one Codeforces-style box with tabs (approved design "layout B").
 * Ratings: bars by rank colour, numbers on hover. Tags: pie (top 8 + Other) and a table.
 * Unsolved, Contests, Verdicts: CF datatables. Practice (own profile): recommendations + upsolve.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { send } from '../lib/messaging';
import { ratingHistogram, solveStats, tagStats, verdictStats, type Model, type RatingBin } from '../lib/model';
import { bandOf, bandVar, ratingVar } from '../lib/ranks';
import { recommend, targetRating, weakTags } from '../lib/recommend';
import type { Contest, ProblemsetProblem, UserBundle } from '../lib/types';
import { upsolveGroups } from '../lib/upsolve';
import { contestUrl, problemUrl } from '../lib/urls';

type Tab = 'ratings' | 'tags' | 'unsolved' | 'contests' | 'verdicts' | 'practice';

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtDate = (s: number) => new Date(s * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function Analytics(props: { model: Model; bundle: UserBundle; own: boolean }) {
  const [tab, setTab] = useState<Tab>('ratings');
  const tabs: [Tab, string][] = [
    ['ratings', 'Ratings'],
    ['tags', 'Tags'],
    ['unsolved', 'Unsolved'],
    ['contests', 'Contests'],
    ['verdicts', 'Verdicts'],
  ];
  if (props.own) tabs.push(['practice', 'Practice']);

  return (
    <div class="box">
      <div class="tabs" role="tablist" aria-label="Analytics">
        {tabs.map(([id, label]) => (
          <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div class="box-body" role="tabpanel">
        {tab === 'ratings' && <Ratings model={props.model} />}
        {tab === 'tags' && <Tags model={props.model} />}
        {tab === 'unsolved' && <Unsolved model={props.model} />}
        {tab === 'contests' && <Contests bundle={props.bundle} />}
        {tab === 'verdicts' && <Verdicts model={props.model} />}
        {tab === 'practice' && <Practice model={props.model} bundle={props.bundle} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Ratings

/** Keep the hover box inside the chart: anchor it left/centre/right depending on the bar. */
export function tipPos(index: number, count: number, bottom: number) {
  const frac = (index + 0.5) / count;
  const transform = frac > 0.75 ? 'translateX(calc(-100% + 12px))' : frac < 0.25 ? 'translateX(-12px)' : 'translateX(-50%)';
  return { left: `${frac * 100}%`, bottom: `${bottom}px`, transform };
}

function Ratings({ model }: { model: Model }) {
  const bins = useMemo(() => ratingHistogram(model), [model]);
  const [hover, setHover] = useState<number | null>(null);
  if (!bins.length) return <div class="empty">No rated problems solved yet.</div>;

  const max = Math.max(...bins.map((b) => b.solved.length + b.attempted.length));
  const H = 250;
  const solvedTotal = model.solves.length;
  const triedTotal = model.attempted.length;
  const hb: RatingBin | null = hover != null ? bins[hover] : null;
  const barH = (b: RatingBin) => Math.max(b.solved.length ? 2 : 0, Math.round((b.solved.length / max) * H));
  const triedH = (b: RatingBin) => (b.attempted.length ? 6 + b.attempted.length * 3 : 0);

  return (
    <div>
      <div class="note">
        {fmt(solvedTotal)} solved{triedTotal ? `, ${triedTotal} tried and not solved (outlined tops)` : ''}. Hover a bar for numbers.
      </div>
      <div style={{ position: 'relative' }}>
        <div class="bars" onMouseLeave={() => setHover(null)}>
          {bins.map((b, i) => (
            <div class={`col${hover != null && hover !== i ? ' dim' : ''}`} onMouseEnter={() => setHover(i)} aria-label={`${b.rating}: ${b.solved.length} solved, ${b.attempted.length} tried`}>
              {b.attempted.length > 0 && <div class="tried" style={{ height: `${triedH(b)}px`, borderColor: ratingVar(b.rating) }} />}
              <div style={{ height: `${barH(b)}px`, background: ratingVar(b.rating) }} />
            </div>
          ))}
        </div>
        {hb && (
          <div
            class="tip"
            role="tooltip"
            style={tipPos(hover!, bins.length, barH(hb) + triedH(hb) + 10)}
          >
            <div class="t-head" style={{ color: ratingVar(hb.rating) }}>
              {hb.rating}
            </div>
            <div>{hb.solved.length} solved</div>
            <div class="faint">{hb.attempted.length ? `${hb.attempted.length} tried, not solved` : 'nothing left unsolved'}</div>
          </div>
        )}
      </div>
      <div class="xlabels">
        {bins.map((b) => (
          <span>{bins.length > 24 && b.rating % 200 ? '' : b.rating}</span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Tags

/** Colour ramp for the difficulty wheel: Codeforces' rank colours from pupil green to grandmaster red. */
const RAMP = ['pupil', 'specialist', 'expert', 'cm', 'master', 'gm'];

/** Colour at position t ∈ [0, 1] along the ramp, blending neighbouring rank colours. */
export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = Math.round((x - i) * 100);
  const lo = `var(--cfx-rank-${RAMP[i]})`;
  const hi = `var(--cfx-rank-${RAMP[i + 1]})`;
  return f <= 0 ? lo : f >= 100 ? hi : `color-mix(in oklch, ${hi} ${f}%, ${lo})`;
}

/**
 * Colour per topic (design "difficulty wheel"): topics are ordered by your average rating in them
 * and coloured along the rank ramp from your easiest (green) to your hardest (red), so the wheel
 * always uses the full palette. Neighbouring slices alternate brightness so each stands apart.
 */
export function topicColors(stats: { tag: string; avgRating: number | null; count?: number }[]): Map<string, string> {
  const rated = stats.filter((s) => s.avgRating != null).sort((a, b) => a.avgRating! - b.avgRating! || (b.count ?? 0) - (a.count ?? 0));
  const out = new Map<string, string>();
  rated.forEach((s, i) => {
    const base = rampColor(rated.length > 1 ? i / (rated.length - 1) : 0);
    out.set(s.tag, i % 2 ? `color-mix(in oklch, ${base} 70%, var(--cfx-surface))` : base);
  });
  for (const s of stats) if (s.avgRating == null) out.set(s.tag, 'var(--cfx-rank-unrated)');
  return out;
}

function Tags({ model }: { model: Model }) {
  const stats = useMemo(() => tagStats(model), [model]);
  const [hover, setHover] = useState<string | null>(null);
  if (!stats.length) return <div class="empty">No solved problems yet.</div>;

  const total = stats.reduce((a, s) => a + s.count, 0);
  const share = (n: number) => `${Math.round((n / total) * 1000) / 10}%`;
  const colors = topicColors(stats);
  const dim = (tag: string, c: string) => (hover && hover !== tag ? `color-mix(in srgb, ${c} 30%, var(--cfx-surface))` : c);

  // Wheel: every topic is a slice, ordered by your average rating there (easiest first).
  const wheelOrder = [...stats].sort((a, b) => (a.avgRating ?? -1) - (b.avgRating ?? -1) || b.count - a.count);
  let acc = 0;
  const stops = wheelOrder
    .map((s) => {
      const a0 = (acc / total) * 360;
      acc += s.count;
      const a1 = (acc / total) * 360;
      const gap = Math.min(0.7, (a1 - a0) / 3);
      return `${dim(s.tag, colors.get(s.tag)!)} ${a0.toFixed(2)}deg ${(a1 - gap).toFixed(2)}deg, var(--cfx-surface) ${(a1 - gap).toFixed(2)}deg ${a1.toFixed(2)}deg`;
    })
    .join(', ');
  const hovered = hover ? stats.find((s) => s.tag === hover) : null;
  const half = Math.ceil(stats.length / 2);
  const columns = [stats.slice(0, half), stats.slice(half)].filter((c) => c.length);

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }} onMouseLeave={() => setHover(null)}>
      <div style={{ flex: 'none', width: '170px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        <div
          role="img"
          aria-label={`All ${stats.length} topics. Slice size is problems solved; colour runs from your easiest topic (green) to your hardest (red).`}
          style={{ width: '170px', height: '170px', borderRadius: '50%', background: `conic-gradient(${stops})` }}
        />
        <div class="faint" style={{ fontSize: '11px', textAlign: 'center', lineHeight: 1.45 }}>
          Every topic is a slice. Size: problems solved. Color: green for your easiest topics, red for your hardest.
        </div>
        <div class="muted" style={{ fontSize: '11px', textAlign: 'center', minHeight: '30px' }}>
          {hovered
            ? `${hovered.tag}: ${hovered.count} solved (${share(hovered.count)}), average ${hovered.avgRating ?? '—'}, hardest ${hovered.maxRating ?? '—'}`
            : 'Hover a topic for details.'}
        </div>
      </div>
      <div style={{ flex: '1 1 380px', minWidth: 0, display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, gap: '10px' }}>
        {columns.map((col) => (
          <div class="dt" style={{ gridTemplateColumns: 'minmax(0,1fr) 36px 38px 38px', fontSize: '11px' }}>
            <span class="h" style={{ padding: '3px 5px' }}>Topic</span>
            <span class="h c" title="Problems solved">#</span>
            <span class="h c" title="Average rating">Avg</span>
            <span class="h c" title="Hardest solved">Max</span>
            {col.map((s, i) => {
              const cls = `${hover === s.tag ? ' hl' : i % 2 ? ' alt' : ''}`;
              const enter = () => setHover(s.tag);
              return (
                <>
                  <span class={cls} style={{ padding: '3px 5px' }} onMouseEnter={enter} title={s.tag}>
                    <span class="sw" style={{ background: colors.get(s.tag), width: '8px', height: '8px', marginRight: '5px' }} />
                    <a href={`https://codeforces.com/problemset?tags=${encodeURIComponent(s.tag)}`} target="_blank" rel="noopener" style={{ color: 'var(--cfx-text)', textDecoration: 'none' }}>
                      {s.tag}
                    </a>
                  </span>
                  <span class={`c${cls}`} style={{ padding: '3px 2px' }} onMouseEnter={enter}>
                    {fmt(s.count)}
                  </span>
                  <span class={`c${cls}`} style={{ padding: '3px 2px' }} onMouseEnter={enter}>
                    <b style={{ color: s.avgRating ? ratingVar(s.avgRating) : undefined }}>{s.avgRating ?? '—'}</b>
                  </span>
                  <span class={`c${cls}`} style={{ padding: '3px 2px' }} onMouseEnter={enter}>
                    <b style={{ color: s.maxRating ? ratingVar(s.maxRating) : undefined }}>{s.maxRating ?? '—'}</b>
                  </span>
                </>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Unsolved

function Unsolved({ model }: { model: Model }) {
  if (!model.attempted.length) return <div class="empty">Nothing left unsolved. Every problem you tried was accepted.</div>;
  return (
    <div>
      <div class="note">Problems you submitted but never got accepted, most recent first.</div>
      <div class="dt" style={{ gridTemplateColumns: 'minmax(0,1fr) 70px 60px 110px' }}>
        <span class="h">Problem</span>
        <span class="h c">Rating</span>
        <span class="h c">Tries</span>
        <span class="h c">Last tried</span>
        {model.attempted.slice(0, 50).map((a, i) => {
          const alt = i % 2 ? ' alt' : '';
          return (
            <>
              <span class={alt}>
                <a href={problemUrl(a.problem)} target="_blank" rel="noopener">
                  {a.problem.contestId}
                  {a.problem.index} {a.problem.name}
                </a>
              </span>
              <span class={`c${alt}`}>
                <b style={{ color: a.problem.rating ? ratingVar(a.problem.rating) : undefined }}>{a.problem.rating ?? '—'}</b>
              </span>
              <span class={`c${alt}`}>{a.attempts}</span>
              <span class={`c muted${alt}`}>{fmtDate(a.lastAt)}</span>
            </>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Contests

function Contests({ bundle }: { bundle: UserBundle }) {
  const rh = bundle.ratingHistory;
  if (!rh.length) return <div class="empty">No rated contests yet.</div>;
  const deltas = rh.map((r) => r.newRating - r.oldRating);
  const best = Math.min(...rh.map((r) => r.rank));
  const up = Math.max(...deltas);
  const down = Math.min(...deltas);
  const last = [...rh].reverse().slice(0, 10);
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  return (
    <div>
      <div class="counters">
        <div>
          <div class="v">{rh.length}</div>
          <div class="l">rated contests</div>
        </div>
        <div>
          <div class="v">{fmt(best)}</div>
          <div class="l">best rank</div>
        </div>
        <div>
          <div class="v">{signed(up)}</div>
          <div class="l">biggest gain</div>
        </div>
        <div>
          <div class="v">{signed(down)}</div>
          <div class="l">biggest drop</div>
        </div>
      </div>
      <div class="dt" style={{ gridTemplateColumns: 'minmax(0,1fr) 70px 70px 70px' }}>
        <span class="h">Last contests</span>
        <span class="h c">Rank</span>
        <span class="h c">Change</span>
        <span class="h c">Rating</span>
        {last.map((r, i) => {
          const alt = i % 2 ? ' alt' : '';
          const d = r.newRating - r.oldRating;
          return (
            <>
              <span class={alt}>
                <a href={contestUrl(r.contestId)} target="_blank" rel="noopener" title={r.contestName}>
                  {r.contestName}
                </a>
              </span>
              <span class={`c${alt}`}>{fmt(r.rank)}</span>
              <span class={`c${alt}`}>
                <b style={{ color: d >= 0 ? 'var(--cfx-ok)' : 'var(--cfx-bad)' }}>{signed(d)}</b>
              </span>
              <span class={`c${alt}`}>
                <b style={{ color: ratingVar(r.newRating) }}>{r.newRating}</b>
              </span>
            </>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Verdicts

function Verdicts({ model }: { model: Model }) {
  const rows = useMemo(() => verdictStats(model), [model]);
  const s = useMemo(() => solveStats(model), [model]);
  if (!rows.length) return <div class="empty">No submissions yet.</div>;
  const total = rows.reduce((a, r) => a + r.count, 0);
  const max = rows[0].count;
  const firstTry = model.solves.filter((x) => x.attemptsBeforeAc === 0).length;
  const color = (label: string) => (label === 'Accepted' ? 'var(--cfx-ok)' : label === 'Wrong answer' ? 'var(--cfx-bad)' : 'var(--cfx-text-faint)');
  return (
    <div>
      <div style={{ fontSize: '12.5px', marginBottom: '12px' }}>
        {fmt(firstTry)} of {fmt(s.solved)} problems accepted on the first try ({Math.round((s.firstTryRate ?? 0) * 100)}%).
      </div>
      <div class="hrows">
        {rows.map((r) => (
          <div class="hrow">
            <span style={{ color: r.label === 'Accepted' || r.label === 'Wrong answer' ? color(r.label) : undefined }}>{r.label}</span>
            <div class="track">
              <div class="fill" style={{ width: `${Math.max(1, (r.count / max) * 100)}%`, background: color(r.label) }} />
            </div>
            <span style={{ textAlign: 'right' }}>{fmt(r.count)}</span>
            <span class="muted" style={{ textAlign: 'right' }}>
              {Math.round((r.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Practice (own profile)

function Practice({ model, bundle }: { model: Model; bundle: UserBundle }) {
  const [ps, setPs] = useState<ProblemsetProblem[] | null>(null);
  const [contests, setContests] = useState<Contest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [seed, setSeed] = useState(() => Math.floor(Date.now() / 86_400_000));

  useEffect(() => {
    send({ type: 'problemset' }).then(setPs, (e) => setErr(String(e?.message ?? e)));
    send({ type: 'contests', refresh: false }).then(setContests, () => undefined);
  }, []);

  const tags = useMemo(() => weakTags(tagStats(model)), [model]);
  const target = targetRating(model, bundle.info?.rating);
  const recs = useMemo(() => (ps ? recommend(model, ps, tags, target, seed) : []), [ps, model, tags, target, seed]);
  const groups = useMemo(() => (ps ? upsolveGroups(model, ps, bundle.ratingHistory, contests, bundle.info?.rating ?? null) : []), [ps, model, bundle, contests]);

  if (err) return <div class="err">Couldn't load the problemset: {err}</div>;
  if (!ps) return <div class="empty">Loading the problemset…</div>;

  return (
    <div>
      <div class="row" style={{ marginBottom: '8px' }}>
        <span class="grow" style={{ fontSize: '12.5px' }}>
          Recommended: rated {target + 100} to {target + 300}, in your weakest topics ({tags.join(', ')}).
        </span>
        <button type="button" class="btn" onClick={() => setSeed((s) => s + 1)}>
          Other picks
        </button>
      </div>
      {recs.length ? (
        <div class="dt" style={{ gridTemplateColumns: 'minmax(0,1fr) 70px 140px' }}>
          <span class="h">Problem</span>
          <span class="h c">Rating</span>
          <span class="h c">Topic</span>
          {recs.map((r, i) => {
            const alt = i % 2 ? ' alt' : '';
            return (
              <>
                <span class={alt}>
                  <a href={problemUrl(r.problem)} target="_blank" rel="noopener">
                    {r.problem.contestId}
                    {r.problem.index} {r.problem.name}
                  </a>
                </span>
                <span class={`c${alt}`}>
                  <b style={{ color: bandVar(bandOf(r.problem.rating)) }}>{r.problem.rating}</b>
                </span>
                <span class={`c muted${alt}`}>{r.tag}</span>
              </>
            );
          })}
        </div>
      ) : (
        <div class="empty">No unsolved problems match. You've cleared this band.</div>
      )}

      {groups.length > 0 && (
        <>
          <div class="group-title">Upsolve: unsolved problems from contests you entered (up to your rating + 400)</div>
          <div class="dt" style={{ gridTemplateColumns: 'minmax(0,1fr) 70px 70px' }}>
            <span class="h">Problem</span>
            <span class="h c">Rating</span>
            <span class="h c" />
            {groups.flatMap((g) => g.problems.map((p) => ({ g, p }))).slice(0, 40).map(({ g, p }, i) => {
              const alt = i % 2 ? ' alt' : '';
              return (
                <>
                  <span class={alt} title={g.contestName}>
                    <a href={problemUrl(p)} target="_blank" rel="noopener">
                      {p.contestId}
                      {p.index} {p.name}
                    </a>
                  </span>
                  <span class={`c${alt}`}>
                    <b style={{ color: p.rating ? ratingVar(p.rating) : undefined }}>{p.rating ?? '—'}</b>
                  </span>
                  <span class={`c faint${alt}`}>{p.tried ? 'tried' : ''}</span>
                </>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
