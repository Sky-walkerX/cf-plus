import { defineConfig } from 'wxt';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CF_MATCHES = ['https://codeforces.com/*', 'https://*.codeforces.com/*'];

/**
 * Builds the dark theme stylesheets. Each = one palette (src/theme/palettes/<name>.css)
 * + the shared Codeforces overrides (src/theme/overrides/*.css, applied in filename order),
 * nested under a root selector so only the chosen theme applies:
 *
 *   theme/<name>.css         Codeforces pages (registered at document_start: no white flash)
 *   theme/tokens-<name>.css  extension pages (popup, options): palette only
 *
 * <html data-cfx-theme> switches live between them in open tabs.
 */
const DARK_THEMES = ['slate', 'dark'] as const;

function buildThemeCss(): Record<string, string> {
  const root = resolve(import.meta.dirname, 'src/theme');
  const read = (f: string) => `/* ---- ${f} ---- */\n${readFileSync(resolve(root, f), 'utf8')}`;
  const overrides = readdirSync(resolve(root, 'overrides'))
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => read(`overrides/${f}`))
    .join('\n');
  const out: Record<string, string> = {};
  for (const name of DARK_THEMES) {
    const others = ['light', ...DARK_THEMES.filter((t) => t !== name)];
    const scope = `:root${others.map((o) => `:not([data-cfx-theme="${o}"])`).join('')}`;
    const palette = read(`palettes/${name}.css`);
    out[`theme/${name}.css`] = `${scope} {\n${palette}\n${overrides}\n}\n`;
    out[`theme/tokens-${name}.css`] = `${scope} {\n${palette}\n}\n`;
  }
  return out;
}

export default defineConfig({
  srcDir: 'src',
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
  manifest: {
    name: 'CF+ — Codeforces, upgraded',
    short_name: 'CF+',
    description:
      'Proper dark mode, a merged rating heatmap, profile analytics, spoiler-free practice, upsolve lists and contest reminders for Codeforces.',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    action: { default_title: 'CF+', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
    permissions: ['storage', 'unlimitedStorage', 'scripting', 'alarms', 'notifications'],
    host_permissions: CF_MATCHES,
    commands: {
      'toggle-theme': {
        suggested_key: { default: 'Alt+Shift+D' },
        description: 'Cycle theme: Default → Slate → Pure dark',
      },
    },
  },
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const [relativeDest, contents] of Object.entries(buildThemeCss())) files.push({ relativeDest, contents });
    },
  },
});


