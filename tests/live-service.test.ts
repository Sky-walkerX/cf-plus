import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ entries: new Map<string, { value: unknown; at: number }>(), standings: vi.fn(), status: vi.fn() }));
vi.mock('../src/lib/cache', () => ({
  cacheGet: async (key: string) => { const e = mock.entries.get(key); return e ? { value: e.value, age: Date.now() - e.at } : null; },
  cacheSet: async (key: string, value: unknown) => { mock.entries.set(key, { value, at: Date.now() }); },
}));
vi.mock('../src/lib/cf-api', () => ({ contestStatus: mock.status, userInfo: vi.fn() }));
vi.mock('../src/lib/contest-service', () => ({ getStandings: mock.standings, once: (_key: string, fn: () => unknown) => fn() }));
import { getLiveContest } from '../src/lib/live-service';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  mock.entries.clear();
  mock.standings.mockReset().mockResolvedValue({ contest: { id: 99, phase: 'CODING' }, problems: [], rows: [] });
  mock.status.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

it('refreshes standings on the next 8-second poll despite slow verdict requests', async () => {
  mock.status.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)); return []; });
  const first = getLiveContest(99, 'alice');
  await vi.advanceTimersByTimeAsync(2100);
  await first;
  await vi.advanceTimersByTimeAsync(5900);
  const second = getLiveContest(99, 'alice');
  await vi.advanceTimersByTimeAsync(2100);
  await second;
  expect(mock.standings).toHaveBeenCalledTimes(2);
});

it('keeps the current rank when the verdict endpoint fails', async () => {
  mock.status.mockRejectedValue(new Error('Verdicts unavailable'));
  const snapshot = await getLiveContest(99, 'alice');
  expect(snapshot.verdictsStale).toBe(true);
  expect(snapshot.submissions).toEqual([]);
  expect(snapshot.contest.phase).toBe('CODING');
});
