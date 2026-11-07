import { describe, expect, it } from 'vitest';
import { mergeSubmissions, settledWatermark } from '../src/lib/data';
import { sub } from './helpers';

describe('incremental submission sync', () => {
  it('watermark is the newest settled id', () => {
    const cached = [sub({ id: 5, at: '2025-01-05', verdict: 'TESTING' }), sub({ id: 4, at: '2025-01-04' }), sub({ id: 3, at: '2025-01-03' })];
    expect(settledWatermark(cached)).toBe(4);
  });

  it('fresh data replaces cached entries (e.g. TESTING → OK) and keeps newest first', () => {
    const cached = [sub({ id: 5, at: '2025-01-05', verdict: 'TESTING' }), sub({ id: 4, at: '2025-01-04' })];
    const fresh = [sub({ id: 6, at: '2025-01-06' }), sub({ id: 5, at: '2025-01-05', verdict: 'OK' })];
    const merged = mergeSubmissions(cached, fresh);
    expect(merged.map((s) => s.id)).toEqual([6, 5, 4]);
    expect(merged[1].verdict).toBe('OK');
  });
});
