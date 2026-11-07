import { Analytics } from '../../components/Analytics';
import { Heatmap, ModeSwitch, type HeatmapRange } from '../../components/Heatmap';
import type { Model } from '../../lib/model';
import { setSettings, type Settings } from '../../lib/settings';
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

/** Replaces CF's native grid, inside CF's own activity box. */
export function HeatmapHost() {
  const { model, settings, range } = store.use();
  if (!model || !settings) return null;
  return (
    <div style={{ margin: '2px 0 6px' }}>
      <Heatmap days={model.days} mode={settings.heatmapMode} range={range} />
    </div>
  );
}

/** Count / Rating switch next to CF's "Choose year" dropdown. */
export function SwitchHost() {
  const { model, settings } = store.use();
  if (!model || !settings) return null;
  return <ModeSwitch mode={settings.heatmapMode} onChange={(heatmapMode) => setSettings({ heatmapMode })} />;
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
