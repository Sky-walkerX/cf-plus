// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULTS, type Settings } from '../src/lib/settings';

const mock = vi.hoisted(() => ({ send: vi.fn(), change: null as null | ((s: Partial<Settings>) => void) }));
vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (s: unknown) => s }));
vi.mock('../src/lib/messaging', () => ({ send: mock.send }));
vi.mock('../src/lib/settings', async (original) => ({
  ...await original<typeof import('../src/lib/settings')>(),
  getSettings: async () => ({ ...DEFAULTS }),
  onSettingsChanged: (fn: (s: Partial<Settings>) => void) => { mock.change = fn; return () => { mock.change = null; }; },
}));
import script from '../src/entrypoints/profile-preview.content';

let dispose: () => void;
let cleanups: (() => void)[];
beforeEach(async () => {
  vi.useFakeTimers();
  cleanups = [];
  document.body.innerHTML = '<a id="alice" href="https://codeforces.com/profile/alice">alice</a><a id="bob" href="https://codeforces.com/profile/bob">bob</a>';
  mock.send.mockReset();
  await (script as unknown as { main: (ctx: unknown) => Promise<void> }).main({
    isValid: true,
    onInvalidated: (fn: () => void) => { dispose = fn; },
    addEventListener: (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn);
      cleanups.push(() => target.removeEventListener(type, fn));
    },
  });
});
afterEach(() => { dispose(); cleanups.forEach((fn) => fn()); vi.useRealTimers(); });
const hover = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
const card = () => document.querySelector<HTMLElement>('#cfx-profile-preview')!;

it('ignores a late response after moving to another handle', async () => {
  let resolveAlice!: (value: unknown) => void;
  mock.send.mockImplementation(({ handle }) => handle === 'alice'
    ? new Promise((resolve) => { resolveAlice = resolve; })
    : Promise.resolve({ handle: 'bob', rating: 1600, maxRating: 1800, friendOfCount: 4, contribution: 1 }));
  hover('alice');
  await vi.advanceTimersByTimeAsync(250);
  hover('bob');
  await vi.advanceTimersByTimeAsync(250);
  expect(card().textContent).toContain('bob');
  resolveAlice({ handle: 'alice', rating: 2000 });
  await vi.advanceTimersByTimeAsync(0);
  expect(card().textContent).not.toContain('alice');
  expect(card().textContent).toContain('1800');
});

it('supports keyboard focus and Escape and never shows a disabled preview', async () => {
  mock.send.mockResolvedValue({ handle: 'alice', rating: 1700 });
  document.getElementById('alice')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(250);
  expect(card().hidden).toBe(false);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(card().hidden).toBe(true);
  mock.change?.({ profilePreview: false });
  hover('bob');
  await vi.advanceTimersByTimeAsync(500);
  expect(card().hidden).toBe(true);
  expect(mock.send).toHaveBeenCalledTimes(1);
});

it('does not request previews for external links that resemble CF handles', async () => {
  const external = document.createElement('a');
  external.href = 'https://example.com/profile/alice';
  document.body.append(external);
  external.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(500);
  expect(mock.send).not.toHaveBeenCalled();
});
