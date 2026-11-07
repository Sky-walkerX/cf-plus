/**
 * Keeps Codeforces' own rating graph (jQuery flot) and recolours it for the dark themes.
 *
 * Runs in the page's MAIN world at document_start. It wraps `$.plot` as soon as flot defines it;
 * when the profile's rating graph is plotted, the band "markings" are mixed into the theme's box
 * colour (CF's hues, dimmed), and grid/point colours follow the theme. On a theme switch
 * (<html data-cfx-theme> changes) the graph is re-plotted with the original data.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';

type Rgb = [number, number, number];

const THEMES: Record<string, { box: Rgb; mix: number; text: string; tick: string; border: string } | undefined> = {
  slate: { box: [0x18, 0x20, 0x2a], mix: 0.17, text: '#98a4b6', tick: 'rgba(255,255,255,0.06)', border: '#3a475a' },
  dark: { box: [0x10, 0x12, 0x15], mix: 0.3, text: '#8e9198', tick: 'rgba(255,255,255,0.06)', border: '#2e3238' },
};

function parseHex(hex: string): Rgb | null {
  const h = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return null;
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `pct` of `color` over `base` (sRGB), like CSS color-mix. */
export function mix(color: string, base: Rgb, pct: number): string {
  const c = parseHex(color);
  if (!c) return color;
  return toHex(c.map((v, i) => v * pct + base[i] * (1 - pct)) as Rgb);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function themedOptions(options: Any): Any {
  const theme = THEMES[document.documentElement.dataset.cfxTheme ?? 'light'];
  if (!theme || !options) return options;
  const grid = options.grid ?? {};
  return {
    ...options,
    grid: {
      ...grid,
      color: theme.text,
      tickColor: theme.tick,
      borderColor: theme.border,
      markings: Array.isArray(grid.markings)
        ? grid.markings.map((m: Any) => ({ ...m, color: typeof m.color === 'string' ? mix(m.color, theme.box, theme.mix) : m.color }))
        : grid.markings,
    },
    points: { ...(options.points ?? {}), fillColor: toHex(theme.box) },
    legend: { ...(options.legend ?? {}), backgroundColor: toHex(theme.box), backgroundOpacity: 0.9 },
  };
}

const isRatingGraph = (placeholder: Any) => {
  const el = placeholder?.jquery ? placeholder[0] : placeholder;
  return el?.id === 'usersRatingGraphPlaceholder';
};

function install() {
  const w = window as Any;
  let last: { target: Any; thisArg: Any; args: Any[] } | null = null;

  const wrap = (plot: Any) =>
    typeof plot !== 'function'
      ? plot
      : new Proxy(plot, {
          apply(target, thisArg, args: Any[]) {
            if (!isRatingGraph(args[0])) return Reflect.apply(target, thisArg, args);
            last = { target, thisArg, args };
            return Reflect.apply(target, thisArg, [args[0], args[1], themedOptions(args[2])]);
          },
        });

  const hookJQuery = (jq: Any) => {
    if (typeof jq !== 'function' || jq.__cfxPlotHooked) return;
    jq.__cfxPlotHooked = true;
    let wrapped = wrap(jq.plot);
    Object.defineProperty(jq, 'plot', {
      configurable: true,
      enumerable: true,
      get: () => wrapped,
      set: (p) => (wrapped = wrap(p)),
    });
  };

  if (w.jQuery) hookJQuery(w.jQuery);
  else {
    let jq: Any;
    Object.defineProperty(w, 'jQuery', {
      configurable: true,
      enumerable: true,
      get: () => jq,
      set: (v) => {
        jq = v;
        hookJQuery(v);
      },
    });
  }

  // Re-plot when the theme changes.
  new MutationObserver(() => {
    if (!last) return;
    const [ph, data, options] = last.args;
    try {
      Reflect.apply(last.target, last.thisArg, [ph, data, themedOptions(options)]);
    } catch {
      /* graph gone (page navigated) */
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-cfx-theme'] });
}

export default defineContentScript({
  matches: ['https://codeforces.com/profile/*', 'https://*.codeforces.com/profile/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main: install,
});
