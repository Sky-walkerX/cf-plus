/** Minimal observable store shared by the several Preact roots on one page. */
import { useEffect, useState } from 'preact/hooks';

export function createStore<S extends object>(initial: S) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<S>) {
      state = { ...state, ...patch };
      subs.forEach((f) => f());
    },
    use(): S {
      const [, force] = useState(0);
      const rendered = state;
      useEffect(() => {
        const f = () => force((n) => n + 1);
        subs.add(f);
        // Effects run after paint: catch updates that landed between render and subscribe.
        if (state !== rendered) f();
        return () => void subs.delete(f);
      }, []);
      return state;
    },
  };
}
