import type { ComponentChildren } from 'preact';
import { bandLabel, bandOf, bandVar } from '../lib/ranks';
import { problemUrl } from '../lib/urls';
import type { Problem } from '../lib/types';

export function Seg<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Chevron = () => (
  <svg class="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
  </svg>
);

export function Section(props: {
  id: string;
  title: string;
  sub?: ComponentChildren;
  controls?: ComponentChildren;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: ComponentChildren;
}) {
  return (
    <section class="card" data-collapsed={props.collapsed || undefined} aria-labelledby={`h-${props.id}`}>
      <header class="card-head">
        <h2
          id={`h-${props.id}`}
          tabIndex={0}
          role="button"
          aria-expanded={!props.collapsed}
          onClick={() => props.onToggle(props.id)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), props.onToggle(props.id))}
        >
          <Chevron />
          {props.title}
          {props.sub && <span class="sub">{props.sub}</span>}
        </h2>
        <span class="spacer" />
        {!props.collapsed && props.controls}
      </header>
      {!props.collapsed && <div class="card-body">{props.children}</div>}
    </section>
  );
}

export function RatingChip({ rating }: { rating?: number }) {
  const band = bandOf(rating);
  return (
    <span class="chip" title={bandLabel(band)}>
      <span class="sw" style={{ background: bandVar(band) }} />
      {rating ?? '—'}
    </span>
  );
}

export function ProblemLink({ p }: { p: Problem }) {
  return (
    <a href={problemUrl(p)} target="_blank" rel="noopener" title={`${p.contestId ?? ''}${p.index} · ${p.name}`}>
      <span class="faint">
        {p.contestId}
        {p.index}
      </span>{' '}
      {p.name}
    </a>
  );
}

export const fmtInt = (n: number) => n.toLocaleString('en-US');
export const fmtPct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
