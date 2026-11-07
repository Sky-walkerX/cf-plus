import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULTS, getSettings, onSettingsChanged, type Settings } from '../lib/settings';

/** Live settings for extension pages; also mirrors the theme onto <html data-cfx-theme>. */
export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => {
    getSettings().then(setS);
    return onSettingsChanged((p) => setS((cur) => ({ ...cur, ...p })));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.cfxTheme = s.theme;
  }, [s.theme]);
  return s;
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="switch">
      <input type="checkbox" checked={props.checked} aria-label={props.label} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <span />
    </label>
  );
}

export function Setting(props: { name: string; desc?: string; children: ComponentChildren }) {
  return (
    <div class="setting">
      <div>
        <div class="name">{props.name}</div>
        {props.desc && <div class="desc">{props.desc}</div>}
      </div>
      {props.children}
    </div>
  );
}

/** Load the generated dark token sheets (built by wxt.config.ts) into an extension page. */
export function loadThemeSheets() {
  for (const f of ['theme/tokens-slate.css', 'theme/tokens-dark.css']) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = chrome.runtime.getURL(f);
    document.head.appendChild(l);
  }
}
