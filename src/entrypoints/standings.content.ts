/**
 * Contest standings: adds Δ (rating change) and Perf (performance) columns in Codeforces' own
 * table style, a one-line note about what the numbers are, and highlights friends' rows.
 * Finished + rated: Codeforces' official changes. Running/pending: CF+ prediction.
 * Unofficial rows (virtual, out of competition) of you and your friends: what-if changes.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { send } from '../lib/messaging';
import type { PredictionCell, ScoredRow } from '../lib/predictor';
import type { PredictResponse } from '../lib/predictor-service';
import { rankClass } from '../lib/ranks';
import { getSettings } from '../lib/settings';

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

interface PageRow {
  tr: HTMLTableRowElement;
  handle: string;
  points: number;
  penalty: number;
}

function readRows(table: HTMLTableElement): { rows: PageRow[]; header: HTMLTableRowElement | null } {
  const header = table.querySelector('tr');
  const ths = [...(header?.querySelectorAll('th') ?? [])];
  const scoreCol = ths.findIndex((th) => th.getAttribute('title') === 'Score' || th.textContent?.trim() === '=');
  const penaltyCol = ths.findIndex((th) => /penalty/i.test(th.getAttribute('title') ?? '') || th.textContent?.trim() === 'Penalty');
  const rows: PageRow[] = [];
  for (const tr of table.querySelectorAll<HTMLTableRowElement>('tr[participantid]')) {
    const links = tr.querySelectorAll<HTMLAnchorElement>('td.contestant-cell a[href*="/profile/"]');
    if (links.length !== 1) continue; // teams
    const m = (links[0].getAttribute('href') ?? '').match(/\/profile\/([^/?#]+)/);
    if (!m) continue;
    const cells = tr.querySelectorAll('td');
    const num = (i: number) => (i >= 0 ? Number.parseFloat((cells[i]?.textContent ?? '').replace(/[^\d.-]/g, '')) || 0 : 0);
    rows.push({ tr, handle: decodeURIComponent(m[1]), points: num(scoreCol), penalty: num(penaltyCol) });
  }
  return { rows, header };
}

/** Append cells to every row, moving CF's "right" edge class to the new last cell. */
function appendColumn(table: HTMLTableElement, header: HTMLTableRowElement, title: string, label: string): Map<HTMLTableRowElement, HTMLTableCellElement> {
  const cells = new Map<HTMLTableRowElement, HTMLTableCellElement>();
  for (const tr of table.querySelectorAll<HTMLTableRowElement>('tr')) {
    const last = tr.lastElementChild as HTMLElement | null;
    const isHeader = tr === header;
    const cell = document.createElement(isHeader ? 'th' : 'td');
    if (last) {
      cell.className = last.className;
      last.classList.remove('right');
    }
    cell.classList.add('right', 'cfx-col');
    if (isHeader) {
      cell.textContent = label;
      cell.title = title;
      cell.style.width = '3.5em';
    }
    tr.appendChild(cell);
    cells.set(tr, cell as HTMLTableCellElement);
  }
  return cells;
}

function fillDelta(td: HTMLTableCellElement, c: PredictionCell) {
  const span = document.createElement('span');
  span.textContent = signed(c.delta);
  span.style.color = c.delta > 0 ? 'var(--cfx-ok)' : c.delta < 0 ? 'var(--cfx-bad)' : 'var(--cfx-text-muted)';
  span.style.fontWeight = c.kind === 'whatif' ? 'normal' : 'bold';
  if (c.kind === 'whatif') span.style.fontStyle = 'italic';
  const parts = [`${c.oldRating} → ${c.newRating}`];
  if (c.kind === 'predicted') parts.push('Predicted by CF+.');
  if (c.kind === 'whatif') parts.push('Unofficial: the change this result would have earned if it had been rated.');
  if (c.nextRank && c.nextRank.need > 0) parts.push(`${c.nextRank.need} more for ${c.nextRank.label}.`);
  td.title = parts.join(' ');
  td.replaceChildren(span);
}

function fillPerf(td: HTMLTableCellElement, c: PredictionCell) {
  if (c.performance == null) return;
  const span = document.createElement('span');
  span.className = `rated-user ${rankClass(c.performance)}`;
  span.textContent = Number.isFinite(c.performance) ? String(c.performance) : '∞';
  td.title = 'Performance: the rating at which this result would neither gain nor lose rating.';
  td.replaceChildren(span);
}

function note(res: PredictResponse): string | null {
  if (res.status === 'final') return 'CF+: Δ is the official rating change. Perf is the rating at which this result breaks even. Italic values are what-if changes for unofficial participations.';
  if (res.status === 'predicted') {
    const acc = res.partialHistory ? ' Accuracy improves after CF+ finishes downloading recent contest history.' : '';
    return `CF+: Δ is predicted from the official standings (${res.fieldSize.toLocaleString('en-US')} participants) and current ratings. Codeforces' final numbers can differ by a few points, more in Div. 3 and 4 where untrusted participants are hidden.${acc}`;
  }
  return null;
}

export default defineContentScript({
  matches: ['https://codeforces.com/contest/*/standings*', 'https://*.codeforces.com/contest/*/standings*'],
  runAt: 'document_end',
  async main() {
    const settings = await getSettings();
    const contestId = Number(location.pathname.match(/\/contest\/(\d+)/)?.[1]);
    const table = document.querySelector<HTMLTableElement>('table.standings');
    if (!contestId || !table) return;
    const { rows, header } = readRows(table);
    if (!rows.length || !header) return;

    // Friends' rows.
    const friends = settings.friends ? new Set((await send({ type: 'friendList' }).catch(() => [])).map((h) => h.toLowerCase())) : new Set<string>();
    for (const r of rows) if (friends.has(r.handle.toLowerCase())) r.tr.classList.add('cfx-friend-row');

    if (!settings.predictor) return;

    const me = settings.handle;
    let mine: { handle: string; contests: number; rating?: number } | undefined;
    if (me) {
      const bundle = await send({ type: 'user', handle: me, refresh: false }).catch(() => null);
      if (bundle) mine = { handle: bundle.handle, contests: bundle.ratingHistory.length, rating: bundle.info?.rating };
    }
    const scored: ScoredRow[] = rows.map(({ handle, points, penalty }) => ({ handle, points, penalty }));
    const whatIf = rows.map((r) => r.handle).filter((h) => (me && h.toLowerCase() === me.toLowerCase()) || friends.has(h.toLowerCase()));

    const deltaCells = appendColumn(table, header, 'Rating change (CF+)', 'Δ');
    const perfCells = settings.predictorPerf ? appendColumn(table, header, 'Performance (CF+)', 'Perf') : null;
    for (const r of rows) deltaCells.get(r.tr)!.textContent = '…';

    let res: PredictResponse;
    try {
      res = await send({ type: 'predict', contestId, handles: rows.map((r) => r.handle), scored, whatIf, me: mine });
    } catch (e) {
      for (const r of rows) deltaCells.get(r.tr)!.textContent = '';
      deltaCells.get(header)!.title = `CF+ couldn't compute rating changes: ${e instanceof Error ? e.message : e}`;
      return;
    }

    if (res.status === 'unrated' || res.status === 'upcoming') {
      for (const [, td] of deltaCells) td.remove();
      for (const [, td] of perfCells ?? []) td.remove();
      // Restore CF's right edge on the previous last cells.
      for (const tr of table.querySelectorAll('tr')) tr.lastElementChild?.classList.add('right');
      return;
    }
    for (const r of rows) {
      const c = res.cells[r.handle];
      const td = deltaCells.get(r.tr)!;
      if (c) fillDelta(td, c);
      else td.textContent = '';
      if (perfCells && c) fillPerf(perfCells.get(r.tr)!, c);
    }

    const text = note(res);
    const datatable = table.closest('.datatable');
    if (text && datatable && !document.getElementById('cfx-standings-note')) {
      const div = document.createElement('div');
      div.id = 'cfx-standings-note';
      div.textContent = text;
      Object.assign(div.style, { fontSize: '1.1rem', color: 'var(--cfx-text-muted)', margin: '0 0 0.5em', textAlign: 'right' });
      datatable.before(div);
    }
  },
});
