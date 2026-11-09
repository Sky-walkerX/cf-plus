import { defineContentScript } from 'wxt/utils/define-content-script';
import { CF_MATCHES } from '../lib/constants';
import { send } from '../lib/messaging';
import { rankClass } from '../lib/ranks';
import { getSettings, onSettingsChanged } from '../lib/settings';
import type { UserInfo } from '../lib/types';
import { avatarSrc } from '../lib/urls';

/** Only profile links on Codeforces; event delegation also covers newly loaded comments. */
function profileLink(target: EventTarget | null): HTMLAnchorElement | null {
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!link || !/(^|\.)codeforces\.com$/.test(link.hostname) || !/^\/profile\/[A-Za-z0-9_.-]{1,24}\/?$/.test(link.pathname)) return null;
  return link;
}

export default defineContentScript({
  matches: CF_MATCHES,
  runAt: 'document_end',
  async main(ctx) {
    let settings = await getSettings();
    let anchor: HTMLAnchorElement | null = null;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const card = document.createElement('aside');
    card.id = 'cfx-profile-preview';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Codeforces profile preview');
    card.hidden = true;
    document.body.append(card);

    function hide() {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      generation++;
      card.hidden = true;
      anchor = null;
    }
    function position() {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const h = card.offsetHeight;
      const w = card.offsetWidth;
      card.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
      card.style.top = `${Math.max(8, r.bottom + h + 12 <= innerHeight ? r.bottom + 6 : r.top - h - 6)}px`;
    }
    const linkFor = (u: UserInfo) => {
      const a = document.createElement('a');
      a.href = `/profile/${encodeURIComponent(u.handle)}`;
      a.className = `rated-user ${u.rating == null ? 'user-black' : rankClass(u.rating)}`;
      a.textContent = u.handle;
      return a;
    };
    function render(u: UserInfo) {
      const heading = document.createElement('div');
      heading.className = 'cfx-preview-heading';
      const src = avatarSrc(u.avatar);
      if (src) {
        // Hidden until it loads, so a slow or missing picture never leaves an empty gap.
        const img = document.createElement('img');
        img.alt = '';
        img.hidden = true;
        img.addEventListener('load', () => { img.hidden = false; position(); }, { once: true });
        img.addEventListener('error', () => img.remove(), { once: true });
        img.src = src;
        heading.append(img);
      }
      const who = document.createElement('div');
      who.append(linkFor(u));
      const rank = document.createElement('div');
      rank.textContent = u.rank ?? 'Unrated';
      rank.className = 'cfx-preview-muted';
      who.append(rank);
      heading.append(who);
      const dl = document.createElement('dl');
      for (const [label, value] of [
        ['Rating', u.rating ?? 'Unrated'], ['Max rating', u.maxRating ?? '—'],
        ['Contribution', u.contribution == null ? '—' : `${u.contribution > 0 ? '+' : ''}${u.contribution}`],
        ['Friend of', u.friendOfCount == null ? '—' : `${u.friendOfCount.toLocaleString()} users`],
      ]) {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = String(label);
        dd.textContent = String(value);
        const rating = label === 'Rating' ? u.rating : label === 'Max rating' ? u.maxRating : undefined;
        if (rating != null) dd.className = `rated-user ${rankClass(rating)}`;
        dl.append(dt, dd);
      }
      const meta = document.createElement('div');
      meta.className = 'cfx-preview-muted';
      meta.textContent = [[u.firstName, u.lastName].filter(Boolean).join(' '), [u.city, u.country].filter(Boolean).join(', '), u.organization].filter(Boolean).join(' · ');
      const open = document.createElement('a');
      open.href = `/profile/${encodeURIComponent(u.handle)}`;
      open.textContent = 'View profile →';
      open.className = 'cfx-preview-open';
      card.replaceChildren(heading, dl, meta, open);
    }
    function show(link: HTMLAnchorElement) {
      clearTimeout(hideTimer);
      if (!settings.profilePreview || link === anchor || card.contains(link)) return;
      hide();
      anchor = link;
      const version = generation;
      timer = setTimeout(async () => {
        if (!link.isConnected) return hide();
        card.textContent = 'Loading profile…';
        card.hidden = false;
        position();
        try {
          const info = await send({ type: 'profilePreview', handle: link.pathname.split('/')[2] });
          if (generation !== version || !ctx.isValid) return;
          render(info);
        } catch {
          if (generation !== version || !ctx.isValid) return;
          const a = document.createElement('a');
          a.href = link.href;
          a.textContent = 'Preview unavailable. Open profile →';
          card.replaceChildren(a);
        }
        position();
      }, 250);
    }
    const laterHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 160); };
    ctx.addEventListener(document, 'mouseover', (e) => { const a = profileLink(e.target); if (a) show(a); });
    ctx.addEventListener(document, 'mouseout', (e) => {
      if (anchor?.contains(e.target as Node) && !anchor.contains(e.relatedTarget as Node | null) && !card.contains(e.relatedTarget as Node | null)) laterHide();
    });
    ctx.addEventListener(document, 'focusin', (e) => { const a = profileLink(e.target); if (a) show(a); });
    ctx.addEventListener(document, 'focusout', (e) => { if (e.target === anchor && !card.contains(e.relatedTarget as Node | null)) laterHide(); });
    ctx.addEventListener(card, 'mouseenter', () => clearTimeout(hideTimer));
    ctx.addEventListener(card, 'mouseleave', laterHide);
    ctx.addEventListener(card, 'focusout', (e) => { if (!card.contains((e as FocusEvent).relatedTarget as Node | null)) laterHide(); });
    ctx.addEventListener(document, 'keydown', (e) => { if (e.key === 'Escape') hide(); });
    ctx.addEventListener(window, 'scroll', hide);
    ctx.addEventListener(window, 'resize', hide);

    const own = document.querySelector<HTMLAnchorElement>('#header .lang-chooser a[href*="/profile/"]');
    const original = own ? { className: own.className, title: own.title } : null;
    async function colorOwn() {
      if (!own || !original) return;
      if (!settings.colorOwnHandle) { own.className = original.className; own.title = original.title; return; }
      const handle = own.pathname.split('/')[2];
      try {
        const info = await send({ type: 'profilePreview', handle });
        if (!ctx.isValid || !settings.colorOwnHandle) return;
        own.className = `${original.className.replace(/\b(?:user-(?:gray|green|cyan|blue|violet|orange|red|legendary|black)|rated-user)\b/g, '')} rated-user ${info.rating == null ? 'user-black' : rankClass(info.rating)}`;
        own.title = `${info.rank ?? 'Unrated'}${info.rating == null ? '' : ` · ${info.rating}`}`;
      } catch { /* Keep CF's original header when offline. */ }
    }
    void colorOwn();
    const unsubscribe = onSettingsChanged((patch) => {
      settings = { ...settings, ...patch };
      if (patch.profilePreview === false) hide();
      if (patch.colorOwnHandle !== undefined) void colorOwn();
    });
    ctx.onInvalidated(() => { hide(); unsubscribe(); card.remove(); if (own && original) { own.className = original.className; own.title = original.title; } });
  },
});
