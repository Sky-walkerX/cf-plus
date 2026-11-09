import { send } from './messaging';
import { rankClass } from './ranks';
import { getSettings, onSettingsChanged, setSettings } from './settings';

/** Native table with separate profile and submission links, like CF's own sideboxes. */
export async function mountFriendsBox(contestId: number, index: string, onStop?: (cleanup: () => void) => void) {
  const sidebar = document.querySelector('#sidebar');
  if (!sidebar || document.getElementById('cfx-friends-box')) return;
  const box = document.createElement('section');
  box.id = 'cfx-friends-box';
  box.className = 'roundbox sidebox borderTopRound';
  const caption = document.createElement('div');
  caption.className = 'caption titled';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'cfx-friends-toggle';
  toggle.textContent = '→ Friends submissions';
  caption.append(toggle);
  const body = document.createElement('div');
  body.id = 'cfx-friends-body';
  body.className = 'cfx-friends-scroll';
  toggle.setAttribute('aria-controls', body.id);
  const footer = document.createElement('div');
  footer.className = 'cfx-friends-footer';
  footer.textContent = 'Loading…';
  box.append(caption, body, footer);
  sidebar.prepend(box);
  let settings = await getSettings();
  const collapse = () => {
    body.hidden = !!settings.collapsed.friendsSubmissions;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
  };
  collapse();
  toggle.addEventListener('click', () => {
    settings.collapsed = { ...settings.collapsed, friendsSubmissions: !body.hidden };
    collapse();
    void setSettings({ collapsed: settings.collapsed });
  });
  const unsubscribe = onSettingsChanged((patch) => {
    settings = { ...settings, ...patch };
    box.hidden = !settings.friends;
    collapse();
  });
  let busy = false;
  let signature = '';
  async function refresh() {
    if (busy || document.hidden || !settings.friends) return;
    busy = true;
    try {
      const response = await send({ type: 'friendsOnProblem', contestId, index });
      const next = JSON.stringify(response);
      if (next === signature) return;
      signature = next;
      const { solved, tried, progress } = response;
      if (!box.isConnected) return;
      const table = document.createElement('table');
      table.className = 'rtable cfx-friends-table';
      table.setAttribute('aria-label', 'Friends submissions for this problem');
      const head = table.createTHead().insertRow();
      for (const label of ['Verdict', 'Handle', 'Submissions']) {
        const th = document.createElement('th');
        th.textContent = label;
        th.scope = 'col';
        head.append(th);
      }
      const rows = table.createTBody();
      for (const [friends, accepted] of [[solved, true], [tried, false]] as const) {
        for (const f of friends) {
          const tr = rows.insertRow();
          const status = tr.insertCell();
          const dot = document.createElement('span');
          dot.className = `cfx-friend-dot ${accepted ? 'accepted' : 'rejected'}`;
          dot.textContent = '●';
          dot.title = accepted ? `Accepted · ${f.inContest ? 'in contest' : 'practice'}` : 'Tried, not solved';
          dot.setAttribute('aria-label', dot.title);
          status.append(dot);
          const handle = document.createElement('a');
          handle.href = `/profile/${encodeURIComponent(f.handle)}`;
          handle.textContent = f.handle;
          handle.className = `rated-user ${f.rating == null ? 'user-black' : rankClass(f.rating)}`;
          tr.insertCell().append(handle);
          const count = document.createElement('a');
          const base = (f.contestId ?? contestId) >= 100000 ? '/gym' : '/contest';
          count.href = f.submissionId ? `${base}/${f.contestId ?? contestId}/submission/${f.submissionId}` : `${base}/${contestId}/status?handle=${encodeURIComponent(f.handle)}`;
          count.textContent = f.attempts == null ? '—' : String(f.attempts);
          count.title = `${f.attempts == null ? 'Submission count available after sync' : `${f.attempts} submission${f.attempts === 1 ? '' : 's'}`} · ${accepted ? 'Open accepted submission' : 'Open submissions'} · ${new Date(f.at * 1000).toLocaleDateString()}`;
          tr.insertCell().append(count);
        }
      }
      if (solved.length + tried.length) body.replaceChildren(table);
      else {
        const empty = document.createElement('p');
        empty.className = 'cfx-friends-empty';
        empty.textContent = progress.total ? 'No submissions from synced friends yet.' : 'Add Codeforces friends or rivals in CF+ settings.';
        body.replaceChildren(empty);
      }
      footer.textContent = `${solved.length + tried.length} / ${progress.total} with submissions${progress.synced < progress.total ? ` · syncing ${progress.synced}/${progress.total}` : ''}`;
    } catch {
      signature = '';
      footer.textContent = 'Could not update · retrying shortly';
    } finally { busy = false; }
  }
  void refresh();
  // Keep the box current as the background finishes importing friends.
  const interval = setInterval(() => {
    if (!box.isConnected) { clearInterval(interval); unsubscribe(); return; }
    void refresh();
  }, 15_000);
  onStop?.(() => { clearInterval(interval); unsubscribe(); box.remove(); });
}
