/**
 * Profile page: CF's own activity grid stays (it is the only source for private gym activity);
 * the CF+ difficulty heatmap goes below it inside the same box, following CF's year dropdown.
 * The analytics box goes below the activity box. CF's rating graph is left in place (recoloured by rating-graph.content).
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountShadow } from '../../components/mount';
import { profileHandleFromUrl, SEL } from '../../lib/dom';
import { buildModel } from '../../lib/model';
import { send } from '../../lib/messaging';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import type { UserBundle } from '../../lib/types';
import { AnalyticsHost, HeatmapHost, store } from './app';

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
      mountShadow(document.querySelector(SEL.activityFooter) ?? graph, 'afterend', <HeatmapHost />, 'cfx-heatmap');

      // CF's own year dropdown drives the CF+ heatmap too.
      const year = document.querySelector(SEL.activityYearSelector)?.querySelector<HTMLSelectElement>('select');
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
