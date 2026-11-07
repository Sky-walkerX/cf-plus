# CF+ — Codeforces, upgraded

A Chrome (MV3) extension for Codeforces:

- **Three themes:** Default (stock Codeforces), Slate (blue-tinted dark) and Pure dark (near-black with vivid CF colors). Each theme's CSS is registered at `document_start`, so pages don't flash white. Switch with the header button, the popup, or **Alt+Shift+D**.
- **Rating graph:** CF's own flot graph stays. In the dark themes, a MAIN-world script (`rating-graph.content.ts`) recolors its rank bands, gridlines and points, and redraws it when you switch themes.
- **Heatmap:** replaces only CF's grid inside CF's own activity box. CF's counters and "Choose year" dropdown stay, and the dropdown drives the CF+ heatmap. A Count/Rating switch sits next to the dropdown. Rating colors each day by its hardest problem and dims days with fewer solves. Hover a day to see its problems; click to pin.
- **Profile analytics:** one CF-style box with tabs. Ratings shows bars by rank color, with numbers on hover. Tags shows a pie of the top 8 topics plus Other, next to a table of solved count, share, average and max rating. Unsolved, Contests and Verdicts are CF tables. Practice appears on your own profile.
- **Rating changes on standings:** Δ and Perf columns in CF's table style.
  - Finished contests show Codeforces' official numbers.
  - While ratings are pending, CF+ predicts them with CF's algorithm (`src/lib/rating-calc.ts`). It also applies CF's newcomer rule (hidden 1400-based ratings, with +500/+350/… display bonuses over the first 6 contests). Contest counts come from 120 days of rating changes, downloaded once in the background.
  - Unofficial rows for you and your friends (virtual participations, out of competition) get italic what-if changes, computed by slotting the score into the real rated field.
- **Friends:** a "→ Friends" sidebar box on problem pages (who solved it, in contest or practice, with links to their accepted code; who tried), friend counts in problem tables, and highlighted friend rows in standings. Your CF friends are read from `/friends` while you're logged in. You can add rivals in settings.
- **Estimated problem ratings:** "≈1700" for problems Codeforces hasn't rated yet, shown only after the coding phase. The estimate is the rating at which a contestant solves the problem half the time, fitted from the standings.
- **Practice tab** (your own profile): recommendations at your rating +100 to +300 in your weakest tags, problems you tried but never solved, and unsolved problems from contests you entered.
- **Spoiler-free mode:** hides tags and ratings until you solve the problem, with per-problem reveal. Solved rows can be shown, dimmed or hidden.
- **Problem toolbar:** rating badge, solved state, editorial/status/submit links, and a per-problem stopwatch that records time-to-AC.
- **Popup:** your rating and streak, upcoming contests with countdowns and add-to-Google-Calendar links, plus contest reminder notifications.

## Develop

```sh
npm install
npm run dev        # Chrome with the extension loaded, HMR
npm run build      # → .output/chrome-mv3 (Load unpacked in chrome://extensions)
npm run zip        # store-ready zip
npm test           # unit tests (TZ pinned to America/New_York so DST is exercised)
npm run compile    # typecheck
```

End-to-end smoke test (34 checks across all three themes, including the rating graph's band colors drawn by CF's real jQuery and flot). It loads the built extension in Chromium and serves captured CF pages at their real URLs, because live pages sit behind a Cloudflare human check:

```sh
CFX_FIXTURES=/dir/with/{profile,problem,problemset}.html npm run e2e -- /tmp/cfx-shots
```

## Layout

| Path | What |
|---|---|
| `src/theme/tokens.css` | Light tokens and the always-on rules (spoiler, solved rows, native-widget hiding) |
| `src/theme/palettes/*.css`, `src/theme/overrides/*.css` | Slate and Pure dark palettes, plus the shared Codeforces overrides. `wxt.config.ts` combines each palette with the overrides into `theme/slate.css` and `theme/dark.css` |
| `src/lib/model.ts` | Pure analytics: solves, day buckets, streaks, distributions (unit-tested) |
| `src/lib/data.ts`, `cf-api.ts`, `queue.ts` | Background API client: 1 call / 2 s queue, IndexedDB cache, incremental `user.status` sync |
| `src/lib/dom.ts` | Every Codeforces selector in one place |
| `src/entrypoints/*` | Background, content scripts (global, profile, problemset, problem), popup, options |
| `src/components/*` | Preact UI rendered in Shadow DOM. Colors come only from `--cfx-*` tokens |

## Prediction accuracy

Measured against 4 real rounds (`tests/predictor-real.test.ts` with `CFX_CFDATA` pointing at downloaded API data):

| Situation | Typical error (median) | Notes |
|---|---|---|
| Finished, rated | 0 | Codeforces' official numbers are shown |
| Pending, full field | 3–10 | Tail errors come from accounts with fewer than 6 contests whose first contest is older than the 120-day window |
| Live (trusted standings only) | 5 (Div. 1+2), 8 (Div. 2), 12 (Educational), 26 (Div. 3) | The API hides untrusted participants until ratings are published |

Estimated problem ratings matched Codeforces' official rating exactly on 13 of 24 problems; most others were within 100–200. Problems with very few solvers are estimated too high.

## Counting rules

A problem counts once, on the local day of its first accepted submission. Div. 1/Div. 2 mirrors (same name, adjacent contest ids) count once. Data comes from the public API. Codeforces' own profile counter also includes private group/mashup solves, so it can be higher.
