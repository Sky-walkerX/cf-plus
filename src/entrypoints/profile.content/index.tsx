/**
 * Profile page: the CF+ heatmap replaces only CF's native grid (CF's box, counters and year
 * dropdown stay), a Count/Rating switch sits next to "Choose year", and the analytics box goes
 * below the activity box. CF's rating graph is left in place (recoloured by rating-graph.content).
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountShadow } from '../../components/mount';
import { profileHandleFromUrl, SEL } from '../../lib/dom';
import { buildModel } from '../../lib/model';
import { send } from '../../lib/messaging';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import type { UserBundle } from '../../lib/types';
import { AnalyticsHost, HeatmapHost, store, SwitchHost } from './app';

export default defineContentScript({
  matches: ['https://codeforces.com/profile/*', 'https://*.codeforces.com/profile/*'],
  runAt: 'document_end',
  async main() {
    const handle = profileHandleFromUrl();
    if (!handle) return;
    const settings = await getSettings();
    store.set({ handle, settings });
    onSettingsChanged((patch) => store.set({ settings: { ...store.get().settings!, ...patch } }));

    const root = document.documentElement;
    const graph = document.querySelector(SEL.activityGraph);
    const frame = document.querySelector(SEL.activityFrame);

    if (graph) {
      mountShadow(graph, 'beforebegin', <HeatmapHost />, 'cfx-heatmap');

      const selector = document.querySelector(SEL.activityYearSelector);
      const header = document.querySelector(SEL.activityHeader);
      const switchHost = selector
        ? mountShadow(selector, 'afterbegin', <SwitchHost />, 'cfx-heatmap-switch')
        : header && mountShadow(header, 'beforeend', <SwitchHost />, 'cfx-heatmap-switch');
      if (switchHost) Object.assign(switchHost.style, { display: 'inline-block', marginRight: '8px', verticalAlign: 'middle' });

      // CF's own year dropdown drives the CF+ heatmap too.
      const year = selector?.querySelector<HTMLSelectElement>('select');
      year?.addEventListener('change', () => store.set({ range: year.value ? Number(year.value) : 'last' }));
    }

    if (settings.showAnalytics) {
      const anchor = frame ?? document.querySelector(SEL.ratingGraph)?.closest('.roundbox') ?? document.querySelector(SEL.userbox);
      if (anchor) mountShadow(anchor, 'afterend', <AnalyticsHost />, 'cfx-analytics');
    }

    const apply = (bundle: UserBundle | null) => {
      if (!bundle) return;
      store.set({ bundle, model: buildModel(bundle.submissions), error: null });
      if (graph) root.dataset.cfxHeatmap = 'on';
    };

    try {
      apply(await send({ type: 'user', handle, refresh: false }));
    } catch {
      /* no cache yet */
    }
    try {
      apply(await send({ type: 'user', handle, refresh: true }));
    } catch (e) {
      store.set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
});
