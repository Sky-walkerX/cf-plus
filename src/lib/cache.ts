/** IndexedDB cache (extension origin) with per-entry timestamps. */
import { get, set, del, clear, createStore } from 'idb-keyval';

const store = createStore('cfplus', 'cache');

interface Entry<T> {
  value: T;
  at: number;
}

export async function cacheGet<T>(key: string): Promise<{ value: T; age: number } | null> {
  const e = (await get(key, store)) as Entry<T> | undefined;
  return e ? { value: e.value, age: Date.now() - e.at } : null;
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  await set(key, { value, at: Date.now() } satisfies Entry<T>, store);
}

export async function cacheDel(key: string): Promise<void> {
  await del(key, store);
}

export async function cacheClear(): Promise<void> {
  await clear(store);
}
