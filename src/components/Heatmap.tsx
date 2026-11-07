/**
 * The merged heatmap, drawn like Codeforces' own (square cells, same layout), with two modes:
 *  - count:  CF greens by how many problems were solved
 *  - rating: colour of the day's hardest problem, dimmer on days with fewer solves
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addDays, dayKey, parseDay, type DayBucket } from '../lib/model';
import { bandOf, bandVar } from '../lib/ranks';
import type { HeatmapMode } from '../lib/settings';
import { problemUrl } from '../lib/urls';

const CELL = 11;
const STEP = 13;
const LEFT = 28;
const TOP = 14;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type HeatmapRange = 'last' | number;

export function cellFill(b: DayBucket | undefined, mode: HeatmapMode): string {
  if (!b) return 'var(--cfx-cell-empty)';
  if (mode === 'count') {
    const lvl = b.count >= 7 ? 4 : b.count >= 4 ? 3 : b.count >= 2 ? 2 : 1;
    return `var(--cfx-count-${lvl})`;
  }
  const band = bandVar(bandOf(b.maxRating));
  const pct = b.count >= 4 ? 100 : b.count >= 2 ? 70 : 45;
  return pct === 100 ? band : `color-mix(in oklch, ${band} ${pct}%, var(--cfx-cell-empty))`;
}

interface Cell {
  day: string;
  col: number;
  row: number;
}

function layout(range: HeatmapRange, today: string) {
  const first = range === 'last' ? addDays(today, -364) : `${range}-01-01`;
  const last = range === 'last' ? today : `${range}-12-31`;
  const start = addDays(first, -parseDay(first).getDay()); // back to Sunday
  const startTime = parseDay(start).getTime();
  const cells: Cell[] = [];
  const months: { col: number; label: string }[] = [];
  let lastCol = -10;
  for (let d = first, i = 0; d <= last; d = addDays(d, 1), i++) {
    const date = parseDay(d);
    const col = Math.floor(Math.round((date.getTime() - startTime) / 86_400_000) / 7);
    cells.push({ day: d, col, row: date.getDay() });
    const labelCol = i === 0 ? (date.getDate() < 20 ? col : -1) : date.getDate() === 1 ? (date.getDay() === 0 ? col : col + 1) : -1;
    if (labelCol >= 0 && labelCol - lastCol >= 3) {
      months.push({ col: labelCol, label: MONTHS[date.getMonth()] });
      lastCol = labelCol;
    }
  }
  const cols = (cells.at(-1)?.col ?? 0) + 1;
  return { cells, cols, months: months.filter((m) => m.col < cols - 1) };
}

const fmtDay = (d: string) => parseDay(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export function Heatmap(props: { days: Map<string, DayBucket>; mode: HeatmapMode; range: HeatmapRange }) {
  const today = dayKey(new Date());
  const { cells, cols, months } = useMemo(() => layout(props.range, today), [props.range, today]);
  const width = LEFT + cols * STEP;
  const height = TOP + 7 * STEP;

  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; right: boolean } | null>(null);

  const show = (day: string) => {
    setActive(day);
    const el = svg.current?.querySelector<SVGRectElement>(`rect[data-day="${day}"]`);
    const w = wrap.current;
    if (!el || !w) return;
    const r = el.getBoundingClientRect();
    const wr = w.getBoundingClientRect();
    const x = r.left - wr.left + r.width / 2;
    setPos({ x, y: r.bottom - wr.top + 6, right: x > wr.width * 0.6 });
  };
  const hide = () => {
    setPinned(false);
    setActive(null);
  };

  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e: Event) => !e.composedPath().includes(wrap.current!) && hide();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  const onKey = (e: KeyboardEvent) => {
    const cur = active ?? cells.at(-1)?.day;
    if (!cur) return;
    const delta = ({ ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[e.key];
    if (delta) {
      e.preventDefault();
      const next = addDays(cur, delta);
      if (cells.some((c) => c.day === next)) show(next);
    } else if (e.key === 'Enter') setPinned((p) => !p);
  };

  const b = active ? props.days.get(active) : undefined;

  return (
    <div class="hm" ref={wrap}>
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMin meet"
        role="img"
        tabIndex={0}
        aria-label="Problems solved per day. Arrow keys move between days; Enter pins the details."
        onKeyDown={onKey}
        onFocus={() => !active && cells.length && show(cells.at(-1)!.day)}
        onMouseLeave={() => !pinned && setActive(null)}
      >
        {months.map((m) => (
          <text x={LEFT + m.col * STEP} y={9}>
            {m.label}
          </text>
        ))}
        {[
          [1, 'Mon'],
          [3, 'Wed'],
          [5, 'Fri'],
        ].map(([row, l]) => (
          <text x={0} y={TOP + (row as number) * STEP + 9}>
            {l}
          </text>
        ))}
        {cells.map((c) => (
          <rect
            class={c.day === active ? 'on' : undefined}
            data-day={c.day}
            x={LEFT + c.col * STEP}
            y={TOP + c.row * STEP}
            width={CELL}
            height={CELL}
            style={{ fill: c.day > today ? 'transparent' : cellFill(props.days.get(c.day), props.mode) }}
            onMouseEnter={() => !pinned && show(c.day)}
            onClick={(e) => {
              e.stopPropagation();
              if (pinned && active === c.day) setPinned(false);
              else {
                show(c.day);
                setPinned(true);
              }
            }}
          />
        ))}
      </svg>

      {active && pos && (
        <div
          class={`tip${pinned ? ' pinned' : ''}`}
          role="tooltip"
          style={{ left: `${pos.x}px`, top: `${pos.y}px`, transform: pos.right ? 'translateX(-100%)' : 'translateX(-10px)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="t-head">
            {fmtDay(active)}: {b ? `${b.count} problem${b.count > 1 ? 's' : ''}` : 'no problems'}
          </div>
          {b?.solves.slice(0, 10).map((s) => (
            <div class="t-row">
              <b style={{ color: s.rating ? bandVar(bandOf(s.rating)) : 'var(--cfx-text-faint)' }}>{s.rating ?? '—'}</b>
              <a href={problemUrl(s.problem)} target="_blank" rel="noopener">
                {s.problem.contestId}
                {s.problem.index}. {s.problem.name}
              </a>
            </div>
          ))}
          {b && b.count > 10 && <div class="t-hint">and {b.count - 10} more</div>}
          {b && !pinned && <div class="t-hint">Click the day to keep this open</div>}
        </div>
      )}
    </div>
  );
}

/** Count / Rating switch that sits next to CF's "Choose year" dropdown. */
export function ModeSwitch(props: { mode: HeatmapMode; onChange: (m: HeatmapMode) => void }) {
  return (
    <span class="pair" role="group" aria-label="Heatmap coloring">
      <button type="button" aria-pressed={props.mode === 'count'} onClick={() => props.onChange('count')}>
        Count
      </button>
      <button type="button" aria-pressed={props.mode === 'rating'} onClick={() => props.onChange('rating')}>
        Rating
      </button>
    </span>
  );
}
