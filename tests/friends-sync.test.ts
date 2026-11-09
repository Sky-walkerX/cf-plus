import { expect, it, vi } from 'vitest';
import { addSubmissions, emptyIndex } from '../src/lib/friends';
import { sub } from './helpers';

const mock = vi.hoisted(() => ({ entries: new Map<string, unknown>(), status: vi.fn() }));
vi.mock('../src/lib/cache', () => ({
  cacheGet: async (key: string) => mock.entries.has(key) ? { value: structuredClone(mock.entries.get(key)), age: 0 } : null,
  cacheSet: async (key: string, value: unknown) => { mock.entries.set(key, structuredClone(value)); },
}));
vi.mock('../src/lib/settings', () => ({ getSettings: async () => ({ extraFriends: ['alice'] }) }));
vi.mock('../src/lib/cf-api', () => ({ userStatus: mock.status }));
import { syncStaleFriends } from '../src/lib/friends-service';

it('syncs multiple pages against the original watermark without skipping or double-counting attempts', async () => {
  const make = (id: number) => sub({ id, at: '2026-01-01', contestId: 5, index: 'A', verdict: 'WRONG_ANSWER' });
  mock.entries.clear();
  mock.entries.set('fidx:alice', addSubmissions(emptyIndex('alice'), [make(100)]));
  mock.status.mockImplementation(async (_handle, from: number) => {
    if (from === 1) return Array.from({ length: 100 }, (_, i) => make(300 - i));
    if (from === 101) return Array.from({ length: 100 }, (_, i) => make(200 - i));
    return [make(100)];
  });
  await syncStaleFriends();
  expect(mock.status).toHaveBeenCalledTimes(3);
  const index = mock.entries.get('fidx:alice') as ReturnType<typeof emptyIndex>;
  expect(index.attempts?.['5-A']).toBe(201);
  expect(index.settledId).toBe(300);
});
