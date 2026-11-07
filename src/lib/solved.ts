/** Solved / attempted problem keys for the configured handle (cached first, then refreshed). */
import { send } from './messaging';
import { buildModel, type Model } from './model';
import { getSettings } from './settings';

export async function loadOwnModel(onUpdate: (m: Model) => void): Promise<void> {
  const { handle } = await getSettings();
  if (!handle) return;
  try {
    const cached = await send({ type: 'user', handle, refresh: false });
    if (cached) onUpdate(buildModel(cached.submissions));
  } catch {
    /* ignore */
  }
  try {
    const fresh = await send({ type: 'user', handle, refresh: true });
    if (fresh) onUpdate(buildModel(fresh.submissions));
  } catch {
    /* offline or API down: cached data is fine */
  }
}
