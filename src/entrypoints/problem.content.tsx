/**
 * Problem pages: toolbar under the statement header with the rating badge, editorial/status/submit
 * links and a per-problem practice stopwatch. Also spoiler-free handling of the sidebar tag box.
 */
import { useEffect, useState } from 'preact/hooks';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountShadow } from '../components/mount';
import { parseProblemUrl, SEL } from '../lib/dom';
import { problemKey, type Model } from '../lib/model';
import { send, type FriendsOnProblemResponse } from '../lib/messaging';
import { bandLabel, bandOf, bandVar, rankClass } from '../lib/ranks';
import { getSettings, onSettingsChanged } from '../lib/settings';
import { loadOwnModel } from '../lib/solved';
import { createStore } from '../lib/store';

interface TimerState {
  elapsed: number; // ms accumulated while paused
  since: number | null; // epoch ms when (re)started
  doneMs?: number;
}

const state = createStore<{ model: Model | null; spoiler: boolean; estimate: number | null }>({ model: null, spoiler: false, estimate: null });

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

function Toolbar(props: { cid: number; index: string; rating: number | null; editorial: string | null; inContest: boolean }) {
  const { model, spoiler, estimate } = state.use();
  const key = problemKey({ contestId: props.cid, index: props.index });
  const solve = model?.solves.find((s) => s.key === key);
  const solved = !!model?.solvedKeys.has(key);
  const [revealed, setRevealed] = useState(false);
  const timer = useTimer(key, solved ? (solve?.firstAcAt ?? Date.now() / 1000) * 1000 : null);

  const base = props.cid >= 100000 ? `/gym/${props.cid}` : props.inContest ? `/contest/${props.cid}` : null;
  const status = base ? `${base}/status/${props.index}` : `/problemset/status/${props.cid}/problem/${props.index}`;
  const submit = base ? `${base}/submit/${props.index}` : `/problemset/submit/${props.cid}/${props.index}`;
  const hideRating = spoiler && !solved && !revealed;
  const rating = props.rating ?? estimate;
  const estimated = props.rating == null && estimate != null;
  const band = bandOf(rating);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', margin: '10px 0 4px', fontSize: '12px' }}>
      {rating != null &&
        (hideRating ? (
          <button class="btn" onClick={() => setRevealed(true)} title="Spoiler-free mode is on">
            Rating hidden · show
          </button>
        ) : (
          <span
            class="chip"
            style={{ padding: '2px 8px', borderRadius: '3px', border: '1px solid var(--cfx-border-strong)', color: 'var(--cfx-text)', fontStyle: estimated ? 'italic' : undefined }}
            title={estimated ? 'Estimated by CF+ from contest results. Codeforces has not rated this problem yet.' : bandLabel(band)}
          >
            <span class="sw" style={{ background: bandVar(band), marginRight: '2px' }} />
            {estimated ? `≈${rating}` : rating}
          </span>
        ))}
      {solved && (
        <span class="chip" style={{ padding: '3px 9px', borderRadius: '999px', background: 'color-mix(in oklch, var(--cfx-ok) 16%, transparent)', color: 'var(--cfx-text)' }}>
          <Icon d="M5 12l5 5L20 7" /> Solved
        </span>
      )}
      {props.editorial && (
        <a class="btn" href={props.editorial} target="_blank" rel="noopener">
          Editorial
        </a>
      )}
      <a class="btn" href={status}>
        Status
      </a>
      <a class="btn" href={submit}>
        Submit
      </a>
      {timer.ready && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
          {timer.doneMs != null ? (
            <span class="muted num" title="Time from starting the stopwatch to your first accepted submission">
              ⏱ Solved in {fmt(timer.doneMs)}
            </span>
          ) : (
            <>
              <button class="btn num" onClick={timer.toggle} title={timer.running ? 'Pause stopwatch' : 'Start practice stopwatch'} aria-label={timer.running ? 'Pause stopwatch' : 'Start stopwatch'}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <Icon d={timer.running ? 'M8 5v14M16 5v14' : 'M7 4l12 8-12 8z'} />
                  {timer.value ? fmt(timer.value) : 'Start timer'}
                </span>
              </button>
            </>
          )}
          {(timer.value > 0 || timer.doneMs != null) && (
            <button class="btn" onClick={timer.reset} title="Reset stopwatch" aria-label="Reset stopwatch">
              <Icon d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

const fmtDate = (s: number) => new Date(s * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "→ Friends" sidebox, built from Codeforces' own sidebar markup so it is themed like the rest. */
async function mountFriendsBox(contestId: number, index: string) {
  const sidebar = document.querySelector(SEL.sidebar);
  if (!sidebar || document.getElementById('cfx-friends-box')) return;
  const box = document.createElement('div');
  box.id = 'cfx-friends-box';
  box.className = 'roundbox sidebox borderTopRound';
  const caption = document.createElement('div');
  caption.className = 'caption titled';
  caption.textContent = '→ Friends';
  const body = document.createElement('div');
  Object.assign(body.style, { padding: '0.5em 0.75em 0.75em', fontSize: '1.2rem', lineHeight: '1.6' });
  body.textContent = 'Loading…';
  box.append(caption, body);
  const anchor = sidebar.querySelector('.roundbox.sidebox');
  if (anchor) anchor.after(box);
  else sidebar.prepend(box);

  let res: FriendsOnProblemResponse;
  try {
    res = await send({ type: 'friendsOnProblem', contestId, index });
  } catch {
    box.remove();
    return;
  }
  const { solved, tried, progress } = res;
  const userLink = (h: string, rating?: number, href = `/profile/${h}`) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = h;
    a.className = `rated-user ${rating == null ? 'user-black' : rankClass(rating)}`;
    return a;
  };
  const line = (...nodes: (Node | string)[]) => {
    const div = document.createElement('div');
    div.append(...nodes);
    return div;
  };
  const muted = (t: string) => {
    const s = document.createElement('span');
    s.style.color = 'var(--cfx-text-muted)';
    s.textContent = t;
    return s;
  };
  const out: Node[] = [];
  if (!progress.total) {
    out.push(line(muted('Add friends on Codeforces, or add handles in CF+ settings, to see who solved this.')));
  } else {
    if (solved.length) {
      out.push(line(`${solved.length} of your friends solved this:`));
      for (const f of solved) {
        const base = f.contestId != null && f.contestId >= 100000 ? '/gym' : '/contest';
        const href = f.submissionId ? `${base}/${f.contestId}/submission/${f.submissionId}` : `/profile/${f.handle}`;
        out.push(line(userLink(f.handle, f.rating, href), muted(` ${f.inContest ? 'in contest' : 'practice'}, ${fmtDate(f.at)}`)));
      }
    } else out.push(line(muted('None of your friends has solved this yet.')));
    if (tried.length) {
      const l = line(muted('Tried: '));
      tried.forEach((f, i) => l.append(...(i ? [', '] : []), userLink(f.handle, f.rating)));
      out.push(l);
    }
    if (progress.synced < progress.total) out.push(line(muted(`Syncing friends: ${progress.synced} of ${progress.total}…`)));
  }
  body.replaceChildren(...out);
}

function findSidebox(re: RegExp): HTMLElement | null {
  for (const cap of document.querySelectorAll<HTMLElement>(`${SEL.sidebar} ${SEL.sideboxCaption}`)) {
    if (re.test(cap.textContent ?? '')) return cap.closest('.roundbox');
  }
  return null;
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
  async main() {
    const id = parseProblemUrl();
    const header = document.querySelector('.problem-statement .header');
    if (!id || !header) return;
    const settings = await getSettings();
    state.set({ spoiler: settings.spoilerFree });
    onSettingsChanged((p) => p.spoilerFree !== undefined && state.set({ spoiler: p.spoilerFree }));

    // Rating from the sidebar "*1400" tag; editorial from "Contest materials".
    let rating: number | null = null;
    for (const tag of document.querySelectorAll<HTMLElement>(SEL.tagBox)) {
      const m = tag.textContent?.trim().match(/^\*(\d{3,4})$/);
      if (m) rating = Number(m[1]);
    }
    const materials = findSidebox(/contest materials|материалы/i);
    const editorial =
      [...(materials?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].find((a) => /tutorial|editorial|разбор/i.test(a.textContent ?? ''))?.href ?? null;

    // Spoiler-free sidebar tags.
    const tagsBox = findSidebox(/problem tags|теги задачи/i);
    if (tagsBox) {
      tagsBox.classList.add('cfx-spoiler-tags');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cfx-reveal';
      chip.textContent = 'show';
      chip.addEventListener('click', () => (tagsBox.dataset.cfxRevealed = '1'));
      tagsBox.querySelector('.caption')?.appendChild(chip);
    }

    if (settings.problemTools) {
      mountShadow(
        header,
        'afterend',
        <Toolbar cid={id.contestId} index={id.index} rating={rating} editorial={editorial} inContest={!location.pathname.startsWith('/problemset')} />,
        'cfx-problem-tools',
      );
    }

    if (rating == null && settings.estimates) {
      send({ type: 'problemRatings', contestIds: [id.contestId] })
        .then((r) => {
          const e = r[id.contestId]?.[id.index];
          if (e) state.set({ estimate: e.rating });
        })
        .catch(() => undefined);
    }
    if (settings.friends) void mountFriendsBox(id.contestId, id.index);

    await loadOwnModel((model) => {
      state.set({ model });
      if (tagsBox && model.solvedKeys.has(problemKey(id))) tagsBox.dataset.cfxRevealed = '1';
    });
  },
});
