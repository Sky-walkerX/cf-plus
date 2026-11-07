/**
 * Every Codeforces selector CF+ depends on, in one place.
 * Verified against live pages (profile, problemset, problem) on 2026-11-07.
 */
export const SEL = {
  // header
  headerLangChooser: '#header .lang-chooser',

  // profile
  activityFrame: '._UserActivityFrame_frame',
  activityRoundBox: '._UserActivityFrame_frame .userActivityRoundBox',
  activityHeader: '._UserActivityFrame_header',
  activityYearSelector: '._UserActivityFrame_selector',
  activityGraph: '#userActivityGraph',
  activityFooter: '._UserActivityFrame_footer',
  ratingGraph: '#usersRatingGraphPlaceholder',
  ratingGraphTypeForm: '#typeSelectForm',
  userbox: '.userbox',

  // problemset
  problemsTable: 'table.problems',
  problemRating: 'span.ProblemRating',
  problemRowTag: 'a.notice[href*="tags="]',

  // problem page
  statement: '.problem-statement',
  statementTitle: '.problem-statement .header .title',
  sidebar: '#sidebar',
  sideboxCaption: '.roundbox.sidebox .caption',
  tagBox: '.tag-box',
} as const;

/** Handle of the logged-in user, read from the header ("Handle | Logout"). */
export function detectLoggedInHandle(doc: Document = document): string | null {
  const box = doc.querySelector(SEL.headerLangChooser);
  if (!box) return null;
  for (const a of box.querySelectorAll<HTMLAnchorElement>('a[href*="/profile/"]')) {
    const m = new URL(a.href, location.origin).pathname.match(/^\/profile\/([^/]+)$/);
    if (m && !a.href.includes('locale=')) return decodeURIComponent(m[1]);
  }
  return null;
}

/** Problem identity from any problem URL form: /problemset/problem/1/A, /contest/1/problem/A, /gym/…/problem/A. */
export function parseProblemUrl(path = location.pathname): { contestId: number; index: string } | null {
  const m =
    path.match(/^\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/) ??
    path.match(/^\/(?:contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)/);
  return m ? { contestId: Number(m[1]), index: m[2].toUpperCase() } : null;
}

export function profileHandleFromUrl(path = location.pathname): string | null {
  const m = path.match(/^\/profile\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function waitFor<T extends Element>(selector: string, timeoutMs = 8000): Promise<T | null> {
  const found = document.querySelector<T>(selector);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      obs.disconnect();
      resolve(document.querySelector<T>(selector));
    }, timeoutMs);
  });
}
