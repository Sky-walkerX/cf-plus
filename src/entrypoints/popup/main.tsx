import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import '../../theme/tokens.css';
import '../../components/ui.css';
import '../../components/page.css';
import './popup.css';
import { Seg } from '../../components/common';
import { ContestSettings, loadThemeSheets, Setting, Switch, useSettings } from '../../components/settings-ui';
import { send } from '../../lib/messaging';
import { activitySummary, buildModel, dayKey } from '../../lib/model';
import { bandOf, bandVar } from '../../lib/ranks';
import { setSettings, type Settings, type ThemeMode } from '../../lib/settings';
import type { Contest, UserBundle } from '../../lib/types';
import { avatarSrc } from '../../lib/urls';

loadThemeSheets();

const gcalDate = (s: number) => new Date(s * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const gcalLink = (c: Contest) =>
  `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(c.name)}&dates=${gcalDate(
    c.startTimeSeconds!,
  )}/${gcalDate(c.startTimeSeconds! + c.durationSeconds)}&details=${encodeURIComponent(`https://codeforces.com/contests/${c.id}`)}`;

function countdown(sec: number): string {
  if (sec <= 0) return 'now';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `in ${d}d ${h}h`;
  if (h) return `in ${h}h ${m}m`;
  return `in ${m}m ${Math.floor(sec % 60)}s`;
}
const dur = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

function HandleForm() {
  const [v, setV] = useState('');
  return (
    <form
      class="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) setSettings({ handle: v.trim() });
      }}
    >
      <input class="text grow" placeholder="Your Codeforces handle" value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} />
      <button class="btn" type="submit">
        Save
      </button>
    </form>
  );
}

function Me({ s }: { s: Settings }) {
  const [bundle, setBundle] = useState<UserBundle | null>(null);
  useEffect(() => {
    if (!s.handle) return;
    send({ type: 'user', handle: s.handle, refresh: false })
      .then((b) => {
        setBundle(b);
        return send({ type: 'user', handle: s.handle!, refresh: true });
      })
      .then(setBundle)
      .catch(() => undefined);
  }, [s.handle]);
  const summary = useMemo(() => (bundle ? { a: activitySummary(buildModel(bundle.submissions)), m: buildModel(bundle.submissions) } : null), [bundle]);

  if (!s.handle) return <HandleForm />;
  const info = bundle?.info;
  const today = summary?.m.days.get(dayKey(new Date()))?.count ?? 0;
  return (
    <div>
      <div class="row">
        {avatarSrc(info?.avatar) && (
          <img class="avatar" src={avatarSrc(info?.avatar)!} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        )}
        <div class="grow">
          <a class="handle" href={`https://codeforces.com/profile/${s.handle}`} target="_blank" style={{ color: bandVar(bandOf(info?.rating)) }}>
            {info?.handle ?? s.handle}
          </a>
          <div class="muted" style={{ fontSize: '12px' }}>
            {info?.rating ? `${info.rating} · max ${info.maxRating} · ${info.rank}` : 'unrated'}
          </div>
        </div>
        <button class="btn" title="Change handle" onClick={() => setSettings({ handle: null })}>
          Change
        </button>
      </div>
      <div class="stats" style={{ marginTop: '10px' }}>
        <div class="stat">
          <div class="v">{summary ? `${summary.a.currentStreak}d` : '—'}</div>
          <div class="l">current streak</div>
        </div>
        <div class="stat">
          <div class="v">{summary ? today : '—'}</div>
          <div class="l">solved today</div>
        </div>
        <div class="stat">
          <div class="v">{summary ? summary.a.lastMonth : '—'}</div>
          <div class="l">last 30 days</div>
        </div>
      </div>
    </div>
  );
}

function Contests() {
  const [list, setList] = useState<Contest[] | null>(null);
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    send({ type: 'contests' }).then(setList, () => setList([]));
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  const upcoming = (list ?? [])
    .filter((c) => (c.phase === 'BEFORE' || c.phase === 'CODING') && c.startTimeSeconds)
    .sort((a, b) => a.startTimeSeconds! - b.startTimeSeconds!)
    .slice(0, 6);
  if (!list) return <div class="skel" style={{ height: '120px' }} />;
  if (!upcoming.length) return <div class="empty">No upcoming contests.</div>;
  return (
    <ul class="contests">
      {upcoming.map((c) => {
        const live = c.phase === 'CODING';
        return (
          <li>
            <div class="grow">
              <a href={`https://codeforces.com/contests/${c.id}`} target="_blank" title={c.name}>
                {c.name}
              </a>
              <div class="muted num" style={{ fontSize: '11.5px' }}>
                {live ? <b style={{ color: 'var(--cfx-ok)' }}>Running</b> : countdown(c.startTimeSeconds! - now)} ·{' '}
                {new Date(c.startTimeSeconds! * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} · {dur(c.durationSeconds)}
              </div>
            </div>
            {!live && (
              <a class="btn" href={gcalLink(c)} target="_blank" title="Add to Google Calendar" aria-label="Add to Google Calendar">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
                </svg>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Popup() {
  const s = useSettings();
  return (
    <main>
      <header class="row top">
        <b class="logo">
          CF<span>+</span>
        </b>
        <span class="grow" />
        <Seg<ThemeMode>
          label="Theme"
          value={s.theme}
          onChange={(theme) => setSettings({ theme })}
          options={[
            { value: 'light', label: 'Default' },
            { value: 'slate', label: 'Slate' },
            { value: 'dark', label: 'Pure dark' },
          ]}
        />
      </header>
      <section class="block">
        <Me s={s} />
      </section>
      <section class="block">
        <h3>Upcoming contests</h3>
        <Contests />
      </section>
      <section class="block">
        <Setting name="Spoiler-free practice" desc="Hide tags and ratings until solved">
          <Switch label="Spoiler-free practice" checked={s.spoilerFree} onChange={(spoilerFree) => setSettings({ spoilerFree })} />
        </Setting>
        <Setting name="Solved problems" desc="In problemset tables">
          <Seg
            label="Solved problems"
            value={s.solvedRows}
            onChange={(solvedRows) => setSettings({ solvedRows })}
            options={[
              { value: 'show', label: 'Show' },
              { value: 'dim', label: 'Dim' },
              { value: 'hide', label: 'Hide' },
            ]}
          />
        </Setting>
        <Setting name="Contest reminders" desc={`Notify ${s.reminderMinutes} min before start`}>
          <Switch label="Contest reminders" checked={s.remindersEnabled} onChange={(remindersEnabled) => setSettings({ remindersEnabled })} />
        </Setting>
      </section>
      <section class="block">
        <ContestSettings s={s} />
        <Setting name="Profile previews">
          <Switch label="Profile previews" checked={s.profilePreview} onChange={(profilePreview) => setSettings({ profilePreview })} />
        </Setting>
      </section>
      <footer class="row">
        <a href="https://codeforces.com/problemset" target="_blank">
          Problemset
        </a>
        <span class="grow" />
        <a href="#" onClick={(e) => (e.preventDefault(), chrome.runtime.openOptionsPage())}>
          All settings
        </a>
      </footer>
    </main>
  );
}

render(<Popup />, document.getElementById('app')!);
