/**
 * Problem pages: a practice stopwatch at the top of the statement, spoiler-free handling of the
 * sidebar tag box, an estimated-difficulty tag while Codeforces hasn't rated the problem yet, and
 * the friends box.
 */
import { useEffect, useState } from 'preact/hooks';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountShadow } from '../components/mount';
import { parseProblemUrl, SEL } from '../lib/dom';
import { problemKey, type Model } from '../lib/model';
import { send } from '../lib/messaging';
import { mountFriendsBox } from '../lib/friends-box';
import { getSettings } from '../lib/settings';
import { loadOwnModel } from '../lib/solved';
import { createStore } from '../lib/store';

interface TimerState {
  elapsed: number; // ms accumulated while paused
  since: number | null; // epoch ms when (re)started
  doneMs?: number;
}

const state = createStore<{ model: Model | null }>({ model: null });

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

function useTimer(key: string, solvedAtMs: number | null) {
  const storageKey = `cfx-timer:${key}`;
  const [t, setT] = useState<TimerState | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    chrome.storage.local.get(storageKey).then((r) => setT((r[storageKey] as TimerState) ?? { elapsed: 0, since: null }));
  }, []);

  const save = (next: TimerState) => {
    setT(next);
    chrome.storage.local.set({ [storageKey]: next });
  };

  // Stop and record when the problem gets accepted.
  useEffect(() => {
    if (!t || solvedAtMs == null || t.doneMs != null || (t.since == null && t.elapsed === 0)) return;
    const end = t.since != null ? Math.max(t.since, Math.min(Date.now(), solvedAtMs)) : 0;
    const total = t.elapsed + (t.since != null ? end - t.since : 0);
    save({ elapsed: total, since: null, doneMs: total });
  }, [t, solvedAtMs]);

  useEffect(() => {
    if (!t?.since) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [t?.since]);

  const value = t ? t.elapsed + (t.since ? Date.now() - t.since : 0) : 0;
  return {
    ready: !!t,
    running: !!t?.since,
    doneMs: t?.doneMs,
    value,
    toggle: () => t && save(t.since ? { elapsed: value, since: null } : { ...t, since: Date.now() }),
    reset: () => save({ elapsed: 0, since: null }),
  };
}

const Icon = ({ d }: { d: string }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Time from pressing start to the first accepted submission; stops by itself on AC. */
function Stopwatch(props: { problemKey: string }) {
  const { model } = state.use();
  const solve = model?.solves.find((s) => s.key === props.problemKey);
  const solved = !!model?.solvedKeys.has(props.problemKey);
  const timer = useTimer(props.problemKey, solved ? (solve?.firstAcAt ?? Date.now() / 1000) * 1000 : null);
  if (!timer.ready) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
      {timer.doneMs != null ? (
        <span class="muted num" title="Time from starting the stopwatch to your first accepted submission">
          ⏱ Solved in {fmt(timer.doneMs)}
        </span>
      ) : (
        <button class="btn num" onClick={timer.toggle} title={timer.running ? 'Pause stopwatch' : 'Start practice stopwatch'} aria-label={timer.running ? 'Pause stopwatch' : 'Start stopwatch'}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <Icon d={timer.running ? 'M8 5v14M16 5v14' : 'M7 4l12 8-12 8z'} />
            {timer.value ? fmt(timer.value) : 'Start timer'}
          </span>
        </button>
      )}
      {(timer.value > 0 || timer.doneMs != null) && (
        <button class="btn" onClick={timer.reset} title="Reset stopwatch" aria-label="Reset stopwatch">
          <Icon d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
        </button>
      )}
    </span>
  );
}

function findSidebox(re: RegExp): HTMLElement | null {
  for (const cap of document.querySelectorAll<HTMLElement>(`${SEL.sidebar} ${SEL.sideboxCaption}`)) {
    if (re.test(cap.textContent ?? '')) return cap.closest('.roundbox');
  }
  return null;
}

/** CF's own "Problem tags" box, for problems that have no tags yet. */
function createTagsBox(): HTMLElement | null {
  const sidebar = document.querySelector(SEL.sidebar);
  if (!sidebar) return null;
  const box = document.createElement('div');
  box.className = 'roundbox sidebox borderTopRound';
  const caption = document.createElement('div');
  caption.className = 'caption titled';
  caption.textContent = '→ Problem tags';
  const body = document.createElement('div');
  body.style.padding = '0.5em';
  const clear = document.createElement('div');
  clear.style.clear = 'both';
  body.append(clear);
  box.append(caption, body);
  sidebar.append(box);
  return box;
}

/** "≈1700" as one more tag, styled like CF's "*1700" difficulty tag. */
function addEstimateTag(tagsBox: HTMLElement, rating: number) {
  const tag = document.createElement('span');
  tag.className = 'tag-box cfx-estimate-tag';
  tag.style.fontSize = '1.2rem';
  tag.textContent = `≈${rating}`;
  tag.title = 'Estimated difficulty (CF+). Disappears once Codeforces rates this problem.';
  // CF wraps each tag in its own floated roundbox; copy that wrapper's look.
  const sibling = tagsBox.querySelector('.tag-box')?.parentElement;
  const wrap = sibling ? (sibling.cloneNode(false) as HTMLElement) : document.createElement('div');
  if (!sibling) {
    wrap.className = 'roundbox borderTopRound borderBottomRound';
    wrap.setAttribute('style', 'margin:2px; padding:0 3px 2px 3px; float:left;');
  }
  wrap.append(tag);
  const list = sibling?.parentElement ?? tagsBox.lastElementChild ?? tagsBox;
  const clear = [...list.children].find((el) => (el as HTMLElement).style.clear === 'both') ?? null;
  list.insertBefore(wrap, clear);
}

export default defineContentScript({
  matches: [
    'https://codeforces.com/problemset/problem/*',
    'https://*.codeforces.com/problemset/problem/*',
    'https://codeforces.com/contest/*/problem/*',
    'https://*.codeforces.com/contest/*/problem/*',
    'https://codeforces.com/gym/*/problem/*',
    'https://*.codeforces.com/gym/*/problem/*',
  ],
  runAt: 'document_end',
  async main(ctx) {
    const id = parseProblemUrl();
    const statement = document.querySelector(SEL.statement);
    if (!id || !statement) return;
    const settings = await getSettings();

    if (settings.stopwatch) {
      // Top-right corner of the statement, level with the problem title.
      const host = mountShadow(statement, 'afterbegin', <Stopwatch problemKey={problemKey(id)} />, 'cfx-stopwatch');
      Object.assign(host.style, { float: 'right', position: 'relative', zIndex: '1', marginLeft: '8px' });
    }

    // Official difficulty is the sidebar "*1400" tag.
    const rated = [...document.querySelectorAll<HTMLElement>(SEL.tagBox)].some((t) => /^\*\d{3,4}$/.test(t.textContent?.trim() ?? ''));

    let tagsBox = findSidebox(/problem tags|теги задачи/i);
    const makeSpoilerFree = (box: HTMLElement) => {
      box.classList.add('cfx-spoiler-tags');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cfx-reveal';
      chip.textContent = 'show';
      chip.addEventListener('click', () => (box.dataset.cfxRevealed = '1'));
      box.querySelector('.caption')?.appendChild(chip);
    };
    if (tagsBox) makeSpoilerFree(tagsBox);
    let solved = false;

    if (!rated && settings.estimates) {
      send({ type: 'problemRatings', contestIds: [id.contestId] })
        .then((r) => {
          const e = r[id.contestId]?.[id.index];
          if (!e?.estimated || !ctx.isValid) return;
          if (!tagsBox) {
            tagsBox = createTagsBox();
            if (!tagsBox) return;
            makeSpoilerFree(tagsBox);
            if (solved) tagsBox.dataset.cfxRevealed = '1';
          }
          addEstimateTag(tagsBox, e.rating);
        })
        .catch(() => undefined);
    }
    if (settings.friends) void mountFriendsBox(id.contestId, id.index, (cleanup) => ctx.onInvalidated(cleanup));

    await loadOwnModel((model) => {
      state.set({ model });
      solved = model.solvedKeys.has(problemKey(id));
      if (tagsBox && solved) tagsBox.dataset.cfxRevealed = '1';
    });
  },
});
