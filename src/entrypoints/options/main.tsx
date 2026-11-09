import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../../theme/tokens.css';
import '../../components/ui.css';
import '../../components/page.css';
import { Seg } from '../../components/common';
import { ContestSettings, loadThemeSheets, Setting, Switch, useSettings } from '../../components/settings-ui';
import { send } from '../../lib/messaging';
import { setSettings, type Settings, type ThemeMode } from '../../lib/settings';

loadThemeSheets();

function Friends({ s }: { s: Settings }) {
  const [status, setStatus] = useState<{ synced: number; total: number; scrapedAt: number } | null>(null);
  const [extra, setExtra] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    send({ type: 'friendsStatus' }).then(setStatus, () => undefined);
  }, [s.extraFriends.join(',')]);
  const saveExtra = () => {
    const handles = (extra ?? '').split(/[\s,;]+/).map((h) => h.trim()).filter(Boolean);
    setSettings({ extraFriends: [...new Set(handles)] });
    setExtra(null);
  };
  return (
    <section class="card" style={{ padding: '4px 16px' }}>
      <Setting name="Friends" desc="Who solved a problem, friend counts in the problemset, highlighted rows in standings">
        <Switch label="Friends" checked={s.friends} onChange={(friends) => setSettings({ friends })} />
      </Setting>
      <Setting
        name="Friends list"
        desc={
          status
            ? `${status.total} friends, ${status.synced} synced.${status.scrapedAt ? ` Read from Codeforces ${new Date(status.scrapedAt).toLocaleString()}.` : ' Open any Codeforces page while logged in to import your friends.'}`
            : 'Loading…'
        }
      >
        <button
          class="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStatus(await send({ type: 'syncFriends' }).catch(() => status));
            setBusy(false);
          }}
        >
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </Setting>
      <div class="setting" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div>
          <div class="name">Also track</div>
          <div class="desc">Extra handles to treat as friends (rivals, teammates). Separate with spaces or commas.</div>
        </div>
        <div class="row" style={{ marginTop: '6px' }}>
          <input class="text grow" value={extra ?? s.extraFriends.join(', ')} placeholder="tourist, jiangly" onInput={(e) => setExtra((e.target as HTMLInputElement).value)} />
          <button class="btn" onClick={saveExtra} disabled={extra == null}>
            Save
          </button>
        </div>
      </div>
    </section>
  );
}

function Options() {
  const s = useSettings();
  const [handle, setHandle] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const set = (p: Partial<Settings>) => setSettings(p);

  return (
    <main style={{ maxWidth: '640px', margin: '32px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h1 style={{ margin: 0, fontSize: '22px', letterSpacing: '-0.02em' }}>
        CF<span style={{ color: 'var(--cfx-accent)' }}>+</span> settings
      </h1>

      <section class="card" style={{ padding: '4px 16px' }}>
        <Setting name="Theme" desc="Default is stock Codeforces. Shortcut: Alt+Shift+D">
          <Seg<ThemeMode>
            label="Theme"
            value={s.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'light', label: 'Default' },
              { value: 'slate', label: 'Slate' },
              { value: 'dark', label: 'Pure dark' },
            ]}
          />
        </Setting>
        <Setting name="Statement images in dark mode" desc="Card keeps diagrams on a soft light background; Invert flips their colors">
          <Seg
            label="Statement images"
            value={s.imageMode}
            onChange={(imageMode) => set({ imageMode })}
            options={[
              { value: 'card', label: 'Card' },
              { value: 'invert', label: 'Invert' },
              { value: 'none', label: 'As is' },
            ]}
          />
        </Setting>
      </section>

      <section class="card" style={{ padding: '4px 16px' }}>
        <Setting name="Your handle" desc="Detected automatically when you're logged in to Codeforces">
          <form
            class="row"
            onSubmit={(e) => {
              e.preventDefault();
              set({ handle: (handle ?? s.handle ?? '').trim() || null });
            }}
          >
            <input class="text" value={handle ?? s.handle ?? ''} placeholder="handle" onInput={(e) => setHandle((e.target as HTMLInputElement).value)} />
            <button class="btn" type="submit">
              Save
            </button>
          </form>
        </Setting>
        <Setting name="Profile analytics" desc="Ratings, tags, unsolved, contests and verdicts below the activity box">
          <Switch label="Profile analytics" checked={s.showAnalytics} onChange={(showAnalytics) => set({ showAnalytics })} />
        </Setting>
      </section>

      <section class="card" style={{ padding: '4px 16px' }}>
        <Setting name="Spoiler-free practice" desc="Hide tags and ratings on problemset and problem pages until you solve the problem">
          <Switch label="Spoiler-free practice" checked={s.spoilerFree} onChange={(spoilerFree) => set({ spoilerFree })} />
        </Setting>
        <Setting name="Solved problems in tables">
          <Seg
            label="Solved problems"
            value={s.solvedRows}
            onChange={(solvedRows) => set({ solvedRows })}
            options={[
              { value: 'show', label: 'Show' },
              { value: 'dim', label: 'Dim' },
              { value: 'hide', label: 'Hide' },
            ]}
          />
        </Setting>
        <Setting name="Practice stopwatch" desc="Start/pause timer at the top of each problem; it stops on your first accepted submission and keeps the time">
          <Switch label="Practice stopwatch" checked={s.stopwatch} onChange={(stopwatch) => set({ stopwatch })} />
        </Setting>
      </section>

      <section class="card" style={{ padding: '4px 16px' }}>
        <Setting name="Rating changes on standings" desc="Official changes for finished contests, predictions while ratings are pending, and what-if changes for your virtual participations">
          <Switch label="Rating changes on standings" checked={s.predictor} onChange={(predictor) => set({ predictor })} />
        </Setting>
        <Setting name="Performance column" desc="The rating at which a result neither gains nor loses rating">
          <Switch label="Performance column" checked={s.predictorPerf} onChange={(predictorPerf) => set({ predictorPerf })} />
        </Setting>
        <Setting name="Estimated problem ratings" desc="For problems Codeforces hasn't rated yet, shown as an ≈1700 tag once the contest is over, until Codeforces publishes the real rating">
          <Switch label="Estimated problem ratings" checked={s.estimates} onChange={(estimates) => set({ estimates })} />
        </Setting>
      </section>

      <Friends s={s} />

      <section class="card" style={{ padding: '4px 16px' }}>
        <ContestSettings s={s} />
      </section>
      <section class="card" style={{ padding: '4px 16px' }}>
        <Setting name="Profile previews" desc="Hover or focus a handle to see rating, rank, contribution and friend count">
          <Switch label="Profile previews" checked={s.profilePreview} onChange={(profilePreview) => set({ profilePreview })} />
        </Setting>
        <Setting name="Color my header handle" desc="Use your Codeforces title color, with your rating on hover">
          <Switch label="Color my header handle" checked={s.colorOwnHandle} onChange={(colorOwnHandle) => set({ colorOwnHandle })} />
        </Setting>
      </section>

      <section class="card" style={{ padding: '4px 16px' }}>
        <Setting name="Contest reminders" desc="A notification before each Codeforces round">
          <Switch label="Contest reminders" checked={s.remindersEnabled} onChange={(remindersEnabled) => set({ remindersEnabled })} />
        </Setting>
        <Setting name="Remind me">
          <select class="sel" value={String(s.reminderMinutes)} onChange={(e) => set({ reminderMinutes: Number((e.target as HTMLSelectElement).value) })}>
            {[5, 15, 30, 60, 120].map((m) => (
              <option value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`} before</option>
            ))}
          </select>
        </Setting>
      </section>

      <section class="card" style={{ padding: '4px 16px' }}>
        <Setting name="Cached data" desc="Submissions, problemset and contests are cached locally to respect Codeforces' API limits">
          <button
            class="btn"
            onClick={async () => {
              await send({ type: 'clearCache' });
              setCleared(true);
            }}
          >
            {cleared ? 'Cleared' : 'Clear cache'}
          </button>
        </Setting>
      </section>
    </main>
  );
}

render(<Options />, document.getElementById('app')!);
