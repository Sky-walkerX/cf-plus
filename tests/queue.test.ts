import { describe, expect, it } from 'vitest';
import { createQueue, RateLimitError } from '../src/lib/queue';

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

describe('queue', () => {
  it('spaces calls at least spacingMs apart, in order', async () => {
    const c = fakeClock();
    const q = createQueue({ spacingMs: 2000, now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map((i) => q.run(async () => (starts.push(c.now()), i))));
    expect(starts).toEqual([0, 2000, 4000]);
  });

  it('retries rate-limit errors, then succeeds', async () => {
    const c = fakeClock();
    const q = createQueue({ spacingMs: 100, now: c.now, sleep: c.sleep });
    let n = 0;
    const r = await q.run(async () => {
      if (++n < 3) throw new RateLimitError('Call limit exceeded');
      return 'ok';
    });
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });

  it('does not retry other errors and keeps the queue alive', async () => {
    const q = createQueue({ spacingMs: 0 });
    await expect(q.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(q.run(async () => 7)).resolves.toBe(7);
  });
});
