import { defineContentScript } from 'wxt/utils/define-content-script';
import { detectLoggedInHandle } from '../lib/dom';
import { pointsIfSolved, problemState, type LiveContest } from '../lib/live-contest';
import { send } from '../lib/messaging';
import { getSettings, onSettingsChanged } from '../lib/settings';

export default defineContentScript({
  matches: ['https://codeforces.com/contest/*', 'https://*.codeforces.com/contest/*'],
  runAt: 'document_end',
  async main(ctx) {
    const contestId = Number(location.pathname.match(/^\/contest\/(\d+)(?:\/|$)/)?.[1]);
    const content = document.querySelector('#pageContent');
    if (!contestId || !content) return;
    let settings = await getSettings();
    let snapshot: LiveContest | null = null;
    let stale = false;
    let busy = false;
    let problemSignature = '';
    let poll: ReturnType<typeof setTimeout> | undefined;
    const panel = document.createElement('section');
    panel.id = 'cfx-contest-panel';
    panel.className = 'roundbox sidebox borderTopRound';
    panel.setAttribute('aria-label', 'Contest problem navigator');
    const caption = document.createElement('div');
    caption.className = 'caption titled';
    caption.textContent = '→ Contest problems';
    const list = document.createElement('div');
    list.className = 'cfx-contest-problems';
    const foot = document.createElement('div');
    foot.className = 'cfx-contest-foot';
    panel.append(caption, list, foot);
    const rank = document.createElement('a');
    rank.id = 'cfx-live-rank';
    rank.href = `/contest/${contestId}/standings`;
    rank.setAttribute('aria-label', 'Live official contest rank');

    function place() {
      if (!(detectLoggedInHandle() ?? settings.handle) || !snapshot || snapshot.contest.phase === 'FINISHED' || snapshot.contest.phase === 'BEFORE') {
        panel.remove();
        rank.remove();
        return;
      }
      const sidebar = document.querySelector('#sidebar');
      panel.dataset.position = settings.contestPanelPosition;
      if (settings.contestPanel) {
        const parent = settings.contestPanelPosition === 'right' && sidebar ? sidebar : content!;
        if (panel.parentElement !== parent || panel !== parent.firstElementChild) parent.prepend(panel);
      } else panel.remove();
      const header = document.querySelector('#header .lang-chooser');
      if (settings.liveRank && header) {
        if (!rank.isConnected) header.append(rank);
      } else rank.remove();
    }

    function draw() {
      place();
      if (!snapshot) {
        list.textContent = stale ? 'Contest data unavailable. Retrying…' : 'Loading contest…';
        rank.textContent = stale ? 'Rank unavailable' : 'Rank …';
        return;
      }
      const { contest, problems, row, submissions } = snapshot;
      const coding = contest.phase === 'CODING';
      const seconds = Math.min(contest.durationSeconds, Math.max(0, contest.relativeTimeSeconds != null
        ? contest.relativeTimeSeconds + (Date.now() - snapshot.fetchedAt) / 1000
        : Date.now() / 1000 - (contest.startTimeSeconds ?? Date.now() / 1000)));
      rank.textContent = `Rank ${row?.rank?.toLocaleString() ?? '—'}${contest.frozen ? ' · frozen' : stale ? ' · stale' : ''}`;
      rank.title = `${row?.rank != null ? `Official rank for ${settings.handle ?? detectLoggedInHandle()}` : 'No official standing: virtual, unofficial or untrusted participation may be excluded'}. Updated ${new Date(snapshot.fetchedAt).toLocaleTimeString()}. Click for standings.`;
      const nodes = problems.map((p, i) => {
        const result = row?.problemResults?.[i];
        const subs = submissions.filter((s) => s.problem.index === p.index);
        const { state, label } = problemState(result, subs, contest.type, p.points);
        const a = document.createElement('a');
        a.href = `/contest/${contestId}/problem/${p.index}`;
        a.className = 'cfx-contest-problem';
        a.dataset.state = state;
        if (location.pathname === a.pathname) a.setAttribute('aria-current', 'page');
        const letter = document.createElement('b');
        letter.textContent = p.index;
        const status = document.createElement('span');
        status.className = 'cfx-problem-verdict';
        status.textContent = state === 'accepted' ? '✓' : state === 'testing' ? '…' : state === 'rejected' ? '✗' : state === 'partial' ? '◐' : '·';
        const points = document.createElement('span');
        points.className = 'cfx-problem-points';
        const rejected = result?.rejectedAttemptCount ?? subs.filter((s) => s.verdict && !['OK', 'TESTING', 'COMPILATION_ERROR', 'SKIPPED'].includes(s.verdict)).length;
        if (state === 'accepted' || state === 'partial') points.textContent = result?.points != null && result.points > 0 ? String(result.points) : 'AC';
        else if (coding && contest.type === 'CF' && p.points != null) points.textContent = String(pointsIfSolved(p.points, seconds, rejected));
        else if (contest.type === 'ICPC') points.textContent = rejected ? `−${rejected}` : '—';
        else points.textContent = p.points == null ? '—' : String(p.points);
        a.title = `${p.index}. ${p.name} · ${label}${coding && contest.type === 'CF' && state !== 'accepted' && p.points != null ? ` · ≈${points.textContent} points if solved now (${rejected} rejected attempts). Standard CF scoring; custom rules may differ.` : ''}`;
        a.setAttribute('aria-label', a.title);
        a.append(letter, status, points);
        return a;
      });
      const signature = nodes.map((a) => `${a.href}|${a.textContent}|${a.title}|${a.dataset.state}`).join('\n');
      if (signature !== problemSignature) {
        const focused = list.contains(document.activeElement) ? (document.activeElement as HTMLAnchorElement).href : null;
        list.replaceChildren(...nodes);
        problemSignature = signature;
        if (focused) nodes.find((a) => a.href === focused)?.focus({ preventScroll: true });
      }
      foot.textContent = `${stale ? 'Update failed · showing last data' : contest.frozen ? 'Standings frozen' : coding ? 'Points ≈ if solved now · 1 min' : contest.phase === 'BEFORE' ? 'Contest has not started' : 'Contest ended'}${snapshot.verdictsStale ? ' · verdicts delayed' : ''} · ${new Date(snapshot.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      foot.title = 'Rank and verdicts refresh every 8 seconds in the active tab. Point estimates use standard Codeforces scoring. Official standings can lag recent verdicts.';
    }

    async function refresh() {
      clearTimeout(poll);
      const handle = detectLoggedInHandle() ?? settings.handle;
      if (busy || document.hidden || (!settings.liveRank && !settings.contestPanel) || !handle) {
        if (!handle) { panel.remove(); rank.remove(); }
        return;
      }
      busy = true;
      const started = Date.now();
      try {
        const next = await send({ type: 'liveContest', contestId, handle });
        if (handle !== (detectLoggedInHandle() ?? settings.handle)) {
          poll = setTimeout(refresh, 0);
          return;
        }
        snapshot = next;
        stale = false;
      } catch { stale = true; }
      finally { busy = false; }
      if (!ctx.isValid) return;
      draw();
      if (!document.hidden && (settings.liveRank || settings.contestPanel) && snapshot?.contest.phase !== 'FINISHED') {
        poll = setTimeout(refresh, Math.max(1000, 8000 - (Date.now() - started)));
      }
    }
    draw();
    void refresh();
    const minute = setInterval(() => { if (!document.hidden && snapshot) draw(); }, 60_000);
    ctx.addEventListener(document, 'visibilitychange', () => { clearTimeout(poll); if (!document.hidden) void refresh(); });
    const unsubscribe = onSettingsChanged((patch) => {
      settings = { ...settings, ...patch };
      if (patch.handle !== undefined) { snapshot = null; problemSignature = ''; }
      draw();
      if (patch.liveRank !== undefined || patch.contestPanel !== undefined || patch.handle !== undefined) void refresh();
    });
    ctx.onInvalidated(() => { clearInterval(minute); clearTimeout(poll); unsubscribe(); panel.remove(); rank.remove(); });
  },
});
