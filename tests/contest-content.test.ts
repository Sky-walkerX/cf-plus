// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveContest } from '../src/lib/live-contest';
import { DEFAULTS, type Settings } from '../src/lib/settings';

const mock = vi.hoisted(() => ({ send: vi.fn(), change: null as null | ((s: Partial<Settings>) => void) }));
vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (s: unknown) => s }));
vi.mock('../src/lib/messaging', () => ({ send: mock.send }));
vi.mock('../src/lib/settings', async (original) => ({
  ...await original<typeof import('../src/lib/settings')>(),
  getSettings: async () => ({ ...DEFAULTS, handle: 'alice' }),
  onSettingsChanged: (fn: (s: Partial<Settings>) => void) => { mock.change = fn; return () => { mock.change = null; }; },
}));
import script from '../src/entrypoints/contest.content';

let dispose: () => void;
let listeners: (() => void)[];
const start = Date.UTC(2026, 10, 8);
function snapshot(): LiveContest {
  return {
    contest: { id: 99, name: 'Test round', type: 'CF', phase: 'CODING', durationSeconds: 7200, relativeTimeSeconds: 1200 + (Date.now() - start) / 1000 },
    problems: [{ index: 'A', name: 'Solved', points: 500 }, { index: 'B', name: 'Unsolved', points: 1000 }],
    row: { handle: 'alice', rank: 42, points: 480, penalty: 0, solved: [true, false], team: false, problemResults: [{ points: 480, rejectedAttemptCount: 0, type: 'PRELIMINARY' }, { points: 0, rejectedAttemptCount: 2, type: 'PRELIMINARY' }] },
    submissions: [], fetchedAt: Date.now(),
  };
}
async function mount() {
  await (script as unknown as { main: (ctx: unknown) => Promise<void> }).main({
    isValid: true,
    onInvalidated: (fn: () => void) => { dispose = fn; },
    addEventListener: (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn);
      listeners.push(() => target.removeEventListener(type, fn));
    },
  });
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  listeners = [];
  document.body.innerHTML = '<div id="header"><div class="lang-chooser"></div></div><div id="sidebar"></div><div id="pageContent"></div>';
  vi.stubGlobal('location', new URL('https://codeforces.com/contest/99/problem/A'));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  mock.send.mockReset().mockImplementation(async () => snapshot());
});
afterEach(() => { dispose?.(); listeners.forEach((fn) => fn()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('active contest UI', () => {
  it('refreshes rank every 8 seconds and updates projected points as time advances', async () => {
    await mount();
    expect(document.querySelector('#cfx-live-rank')?.textContent).toBe('Rank 42');
    expect(document.querySelector('[data-state="accepted"]')?.textContent).toContain('480');
    expect(document.querySelector('[data-state="rejected"]')?.textContent).toContain('820');
    await vi.advanceTimersByTimeAsync(8000);
    expect(mock.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(52_000);
    expect(document.querySelector('[data-state="rejected"]')?.textContent).toContain('816');
  });
  it('moves the panel immediately and removes disabled widgets', async () => {
    await mount();
    mock.change?.({ contestPanelPosition: 'top' });
    expect(document.querySelector('#pageContent > #cfx-contest-panel')).not.toBeNull();
    mock.change?.({ contestPanelPosition: 'left' });
    expect(document.querySelector('#cfx-contest-panel')?.getAttribute('data-position')).toBe('left');
    mock.change?.({ liveRank: false, contestPanel: false });
    expect(document.querySelector('#cfx-contest-panel')).toBeNull();
    expect(document.querySelector('#cfx-live-rank')).toBeNull();
  });
  it('pauses hidden tabs and resumes immediately when visible', async () => {
    await mount();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.send).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.send).toHaveBeenCalledTimes(2);
  });
  it('rebuilds the navigator after changing handles even when the scores are identical', async () => {
    await mount();
    mock.change?.({ handle: 'bob' });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('.cfx-contest-problem')).toHaveLength(2);
    expect(mock.send).toHaveBeenLastCalledWith({ type: 'liveContest', contestId: 99, handle: 'bob' });
  });
  it('retains data with an explicit stale label when refresh fails', async () => {
    await mount();
    mock.send.mockRejectedValue(new Error('Offline'));
    await vi.advanceTimersByTimeAsync(8000);
    expect(document.querySelector('#cfx-live-rank')?.textContent).toBe('Rank 42 · stale');
    expect(document.querySelector('.cfx-contest-foot')?.textContent).toContain('Update failed');
  });
  it('hides live widgets on finished practice contests and stops polling', async () => {
    mock.send.mockResolvedValue({ ...snapshot(), contest: { ...snapshot().contest, frozen: true, phase: 'FINISHED' } });
    await mount();
    expect(document.querySelector('#cfx-live-rank')).toBeNull();
    expect(document.querySelector('#cfx-contest-panel')).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it('removes the navigator automatically when a running contest finishes', async () => {
    await mount();
    expect(document.querySelector('#cfx-contest-panel')).not.toBeNull();
    mock.send.mockResolvedValue({ ...snapshot(), contest: { ...snapshot().contest, phase: 'FINISHED' } });
    await vi.advanceTimersByTimeAsync(8000);
    expect(document.querySelector('#cfx-contest-panel')).toBeNull();
    expect(document.querySelector('#cfx-live-rank')).toBeNull();
  });
});
