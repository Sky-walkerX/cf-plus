/**
 * Serial request queue honouring Codeforces' API limit (1 call per 2 seconds).
 * Retries "Call limit exceeded" responses with backoff.
 */
export interface QueueOptions {
  spacingMs?: number;
  maxRetries?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimitError extends Error {}

export function createQueue(opts: QueueOptions = {}) {
  const spacing = opts.spacingMs ?? 2100;
  const maxRetries = opts.maxRetries ?? 3;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let last = -Infinity;
  let tail: Promise<unknown> = Promise.resolve();

  async function slot() {
    const wait = last + spacing - now();
    if (wait > 0) await sleep(wait);
    last = now();
  }

  function run<T>(task: () => Promise<T>): Promise<T> {
    const p = tail.then(async () => {
      for (let attempt = 0; ; attempt++) {
        await slot();
        try {
          return await task();
        } catch (e) {
          if (e instanceof RateLimitError && attempt < maxRetries) {
            await sleep(spacing * (attempt + 1));
            continue;
          }
          throw e;
        }
      }
    });
    tail = p.catch(() => undefined);
    return p;
  }

  return { run };
}
