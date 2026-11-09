import { Analytics } from '../../components/Analytics';
import { Heatmap, type HeatmapRange } from '../../components/Heatmap';
import type { Model } from '../../lib/model';
import type { Settings } from '../../lib/settings';
import { createStore } from '../../lib/store';
import type { UserBundle } from '../../lib/types';

export const store = createStore<{
  handle: string;
  settings: Settings | null;
  bundle: UserBundle | null;
  model: Model | null;
  range: HeatmapRange;
  error: string | null;
}>({ handle: '', settings: null, bundle: null, model: null, range: 'last', error: null });

/** Second heatmap, below CF's own grid (which stays: only it knows about private gym activity). */
export function HeatmapHost() {
  const { model, range } = store.use();
  if (!model) return null;
  return (
    <div class="hm-block">
      <div class="hm-title">By difficulty: hardest problem solved each day</div>
      <Heatmap days={model.days} activity={model.activity} mode="rating" range={range} />
    </div>
  );
}

export function AnalyticsHost() {
  const { model, bundle, settings, handle, error } = store.use();
  if (!settings) return null;
  if (!model || !bundle) {
    return error ? (
      <div class="box">
        <div class="box-body err">CF+ couldn't load {handle}'s submissions: {error}</div>
      </div>
    ) : null;
  }
  const own = !!settings.handle && settings.handle.toLowerCase() === handle.toLowerCase();
  return (
    <div style={{ margin: '1em 0' }}>
      <Analytics model={model} bundle={bundle} own={own} />
    </div>
  );
}
