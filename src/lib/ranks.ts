/**
 * Codeforces rank bands. One table drives handle colors, chart bars, heatmap
 * cells and rating-history bands, so colors stay consistent everywhere.
 * Colors themselves live in CSS (`--cfx-rank-<id>`), so light/dark is handled there.
 */

export interface Band {
  id: BandId;
  label: string;
  min: number;
  /** Exclusive upper bound. */
  max: number;
}

export type BandId =
  | 'unrated'
  | 'newbie'
  | 'pupil'
  | 'specialist'
  | 'expert'
  | 'cm'
  | 'master'
  | 'im'
  | 'gm'
  | 'igm'
  | 'lgm';

export const BANDS: Band[] = [
  { id: 'newbie', label: 'Newbie', min: -Infinity, max: 1200 },
  { id: 'pupil', label: 'Pupil', min: 1200, max: 1400 },
  { id: 'specialist', label: 'Specialist', min: 1400, max: 1600 },
  { id: 'expert', label: 'Expert', min: 1600, max: 1900 },
  { id: 'cm', label: 'Candidate Master', min: 1900, max: 2100 },
  { id: 'master', label: 'Master', min: 2100, max: 2300 },
  { id: 'im', label: 'International Master', min: 2300, max: 2400 },
  { id: 'gm', label: 'Grandmaster', min: 2400, max: 2600 },
  { id: 'igm', label: 'International Grandmaster', min: 2600, max: 3000 },
  { id: 'lgm', label: 'Legendary Grandmaster', min: 3000, max: Infinity },
];

export function bandOf(rating: number | undefined | null): BandId {
  if (rating == null) return 'unrated';
  for (const b of BANDS) if (rating >= b.min && rating < b.max) return b.id;
  return 'lgm';
}

export function bandLabel(id: BandId): string {
  return id === 'unrated' ? 'Unrated' : BANDS.find((b) => b.id === id)!.label;
}

/** CSS custom property holding the band's color. */
export function bandVar(id: BandId): string {
  return `var(--cfx-rank-${id})`;
}

export function ratingVar(rating: number | undefined | null): string {
  return bandVar(bandOf(rating));
}

/** Codeforces' own handle colour classes, so colours follow the active theme. */
export function rankClass(r: number): string {
  if (!Number.isFinite(r)) return 'user-legendary';
  if (r < 1200) return 'user-gray';
  if (r < 1400) return 'user-green';
  if (r < 1600) return 'user-cyan';
  if (r < 1900) return 'user-blue';
  if (r < 2100) return 'user-violet';
  if (r < 2400) return 'user-orange';
  if (r < 3000) return 'user-red';
  return 'user-legendary';
}

