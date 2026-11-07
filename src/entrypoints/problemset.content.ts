/** Problemset & contest problem tables: spoiler-free tags/ratings, and dim/hide solved rows. */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { parseProblemUrl, SEL } from '../lib/dom';
import { problemKey } from '../lib/model';
import { send } from '../lib/messaging';
import { getSettings } from '../lib/settings';
import { loadOwnModel } from '../lib/solved';
import { rankClass } from '../lib/ranks';

const rowLink = (tr: HTMLTableRowElement) => tr.querySelector<HTMLAnchorElement>('td a[href*="/problem/"]');

/** "≈1700" estimates (and, on contest pages, official ratings) for problems in the table. */
async function showRatings(table: HTMLTableElement, rows: HTMLTableRowElement[]) {
  const isProblemset = location.pathname.startsWith('/problemset');
  const need = new Map<HTMLTableRowElement, { contestId: number; index: string }>();
  for (const tr of rows) {
    const id = rowLink(tr) && parseProblemUrl(new URL(rowLink(tr)!.href, location.origin).pathname);
    if (!id) continue;
    if (isProblemset && tr.querySelector(SEL.problemRating)) continue; // CF already shows it
    need.set(tr, id);
  }
  if (!need.size) return;
  const ratings = await send({ type: 'problemRatings', contestIds: [...new Set([...need.values()].map((v) => v.contestId))] }).catch(() => null);
  if (!ratings) return;
  const ratingCol = [...(table.querySelector('tr')?.querySelectorAll('th') ?? [])].findIndex((th) => th.getAttribute('title') === 'Difficulty');
  for (const [tr, id] of need) {
    const r = ratings[id.contestId]?.[id.index];
    if (!r) continue;
    const span = document.createElement('span');
    span.className = `cfx-rating ${r.estimated ? 'cfx-estimated' : `rated-user ${rankClass(r.rating)}`}`;
    span.textContent = r.estimated ? `≈${r.rating}` : String(r.rating);
    span.title = r.estimated
      ? 'Estimated by CF+ from contest results: the rating at which a contestant solves it half the time. Codeforces has not rated this problem yet.'
      : 'Problem rating';
    const cell = isProblemset && ratingCol >= 0 ? tr.querySelectorAll('td')[ratingCol] : tr.querySelector('td:nth-child(2) > div')?.parentElement;
    if (!cell) continue;
    if (isProblemset) cell.replaceChildren(span);
    else {
      span.style.cssFloat = 'right';
      span.style.marginLeft = '8px';
      cell.prepend(span);
    }
  }
}

/** "3 friends" under the solved count. */
async function showFriendCounts(rows: HTMLTableRowElement[]) {
  const keyed = rows
    .map((tr) => {
      const id = rowLink(tr) && parseProblemUrl(new URL(rowLink(tr)!.href, location.origin).pathname);
      return id ? ([tr, problemKey(id)] as const) : null;
    })
    .filter((x): x is readonly [HTMLTableRowElement, string] => !!x);
  if (!keyed.length) return;
  const counts = await send({ type: 'friendCounts', keys: keyed.map(([, k]) => k) }).catch(() => ({}) as Record<string, string[]>);
  for (const [tr, key] of keyed) {
    const who = counts[key];
    if (!who?.length) continue;
    const cell = tr.lastElementChild as HTMLElement | null;
    if (!cell || cell.querySelector('.cfx-friends')) continue;
    const div = document.createElement('div');
    div.className = 'cfx-friends';
    div.textContent = `${who.length} friend${who.length > 1 ? 's' : ''}`;
    div.title = `Solved by your friends: ${who.join(', ')}`;
    cell.appendChild(div);
  }
}

function rowKey(tr: HTMLTableRowElement): string | null {
  const a = tr.querySelector<HTMLAnchorElement>('td a[href*="/problem/"]');
  if (!a) return null;
  const id = parseProblemUrl(new URL(a.href, location.origin).pathname);
  return id ? problemKey(id) : null;
}

export default defineContentScript({
  matches: [
    'https://codeforces.com/problemset*',
    'https://*.codeforces.com/problemset*',
    'https://codeforces.com/contest/*',
    'https://*.codeforces.com/contest/*',
  ],
  runAt: 'document_end',
  async main() {
    const table = document.querySelector<HTMLTableElement>(SEL.problemsTable);
    if (!table) return;
    const rows = [...table.querySelectorAll<HTMLTableRowElement>('tr')].filter((tr) => tr.querySelector('td'));

    // Reveal chips: one per row that has tags or a rating.
    for (const tr of rows) {
      const tagsDiv = tr.querySelector(SEL.problemRowTag)?.parentElement;
      const target = tagsDiv ?? tr.querySelector(SEL.problemRating)?.parentElement;
      if (!target || target.querySelector('.cfx-reveal')) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cfx-reveal';
      chip.textContent = 'show tags';
      chip.title = 'Spoiler-free mode is on. Reveal tags and rating for this problem.';
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        tr.dataset.cfxRevealed = '1';
      });
      target.prepend(chip);
    }

    // CF already marks solved rows when you're logged in; our solved set covers the rest.
    for (const tr of rows) {
      if (tr.classList.contains('accepted-problem')) {
        tr.classList.add('cfx-solved');
        tr.dataset.cfxRevealed = '1';
      }
    }
    const settings = await getSettings();
    if (settings.estimates) void showRatings(table, rows);
    if (settings.friends) void showFriendCounts(rows);

    await loadOwnModel((model) => {
      for (const tr of rows) {
        const key = rowKey(tr);
        if (key && model.solvedKeys.has(key)) {
          tr.classList.add('cfx-solved');
          tr.dataset.cfxRevealed = '1';
        }
      }
    });
  },
});
