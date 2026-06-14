# spark-charts

A small, dependency-free **canvas** charting library for time-series data,
written in TypeScript. Finance-style dashboards out of the box: crosshair
tracing, area fills, dashed threshold lines, pan/zoom, add/remove series, axis
labels on either side, and a date X-axis that stays sensible from minutes to
decades.

## Features

- **Canvas rendering** with a layered design: a *main* layer (grid, axes,
  series, thresholds) that only redraws on data/viewport/size changes, and a
  cheap *overlay* layer for the crosshair that redraws on every pointer move.
  A `requestAnimationFrame` scheduler coalesces invalidations to one redraw per
  frame.
- **Crosshair / trace** — vertical + horizontal lines, a snapped marker dot per
  series, a date readout pill on the time axis, and live values pushed into the
  legend. By default each series' colored pill stays **pinned at its last
  value** while you hover (so the final readout never disappears) and a neutral
  pill rides the crosshair with the value under the cursor; set
  `crosshair.pinLastValue: false` for the older behaviour where the colored pill
  follows the crosshair.
- **Series types** — `LineSeries` (with optional gradient **area** fill) and
  `HistogramSeries` (sign-coloured bars / sticks). Dense data is decimated to a
  min/max envelope per pixel column, so a 20-year daily series stays cheap to
  draw without losing spikes.
- **Threshold lines** — solid/dashed/dotted horizontal lines with coloured
  name + value pills anchored to the axis (e.g. `high p90  0.92%`).
- **Add / remove series** — programmatically (`addLineSeries`, `removeSeries`)
  or via the built-in interactive legend (click a chip to toggle, `Clear` to
  toggle all).
- **Pan / zoom** — drag to pan, mouse-wheel to zoom around the cursor,
  double-click to reset. The value axis auto-scales to what's visible.
- **Axis on the left or right** (`valueAxis.side`) with a pluggable value
  formatter (percent, fixed decimals, or your own).
- **Smart time axis** — picks a nice calendar step (… 1m, 1h, 1d, 1mo, 3mo,
  1y …) for the visible range and labels it hierarchically: months on a
  multi-month view, but the **year** at a year boundary; day numbers on a
  multi-day view, but the **month** at a month boundary.
- **HiDPI** aware and **responsive** (redraws on container resize).

No runtime dependencies; ships as ESM with type declarations.

## Install

```bash
npm install spark-charts
```

## Quick start

```ts
import { Chart, percentFormat } from 'spark-charts';

const chart = new Chart(document.getElementById('app')!, {
  title: '15-Day Rolling Returns',
  legend: { visible: true, showClearButton: false },
  valueAxis: { side: 'right', format: percentFormat(2) },
});

const spy = chart.addLineSeries({ id: 'SPY', color: '#5b7cfa' });
spy.setData([
  { time: Date.UTC(2025, 0, 1) / 1000, value: 1.2 },
  { time: Date.UTC(2025, 0, 2) / 1000, value: 0.7 },
  // time is epoch seconds (UTC by default), matching the UNIX-timestamp convention
]);
```

### Area fill

```ts
chart.addAreaSeries({
  id: 'drawdown',
  color: '#6ea8e6',
  area: { topColor: 'rgba(110,168,230,0.30)', bottomColor: 'rgba(110,168,230,0.02)' },
});
```

### Histogram / sticks

```ts
chart.addHistogramSeries({
  id: 'highs', base: 0, positiveColor: '#3fa860', negativeColor: '#e0524e', barWidth: 0.24,
}).setData(points);
```

### Threshold (dashed) lines

```ts
chart.addThresholdLine({
  value: 0.92, label: 'high p90', color: '#3fa860',
  lineStyle: 'dashed', labelValue: '0.92%',
});
```

### Add / remove at runtime

```ts
const s = chart.addLineSeries({ id: 'TLT', color: '#e0913c' });
s.setData(data);
chart.removeSeries('TLT'); // or chart.removeSeries(s)
```

## API

`new Chart(container, options?)` / `createChart(container, options?)`

| Method | Purpose |
| --- | --- |
| `addLineSeries(opts)` / `addAreaSeries(opts)` | Add a line (optionally area-filled). |
| `addHistogramSeries(opts)` | Add sign-coloured bars. |
| `removeSeries(id \| series)` | Remove a series. |
| `addThresholdLine(opts) → id` / `removeThresholdLine(id)` | Manage threshold lines. |
| `setData(points)` / `update(point)` | On a series: replace / append data. |
| `setVisibleRange(from, to)` / `fitContent()` | Control the time window. |
| `getVisibleRange()` | `{ from, to }` in epoch seconds, or `null`. |
| `destroy()` | Detach listeners and remove canvases. |

Options are deep-merged over `DEFAULT_OPTIONS`; pass only what you want to
change. Key groups: `layout`, `grid`, `valueAxis` (`side`, `autoScale`,
`scaleMargins`, `format`, `minValue`/`maxValue`), `timeAxis` (`timezone`,
`minTickSpacing`, `format`, `crosshairFormat`), `crosshair`, `legend`, `title`.

Built-in value formatters: `percentFormat(decimals)`, `fixedFormat(decimals)`,
`autoNumberFormat`.

## Design notes

- **Time is always the X axis**, stored as epoch seconds. The tick
  generator aligns to real calendar boundaries (months/years vary in length)
  and defaults to **UTC** so daily data doesn't drift across DST; set
  `timeAxis.timezone: 'local'` if you need local time.
- **Auto-fit** is active until the user pans/zooms or you call
  `setVisibleRange`; after that the window is preserved (and clamped into the
  data bounds) across data updates. `fitContent()` resumes auto-fit.
- The library renders into a container you size with CSS.

## Development

```bash
npm install   # dev tooling only (esbuild, typescript, eslint)
npm run dev   # bundle + serve the demo at http://127.0.0.1:5173
```

| Script | Description |
| --- | --- |
| `npm run build` | Bundle the demo to `examples/app.js`. |
| `npm run build:lib` | Bundle the library to `dist/index.js` + emit `.d.ts`. |
| `npm run typecheck` | Strict `tsc` over `src` + `examples` (no emit). |
| `npm run lint` | ESLint (type-checked rules). |
| `npm run check` | `typecheck` + `lint` — the gate that must stay green. |

### Strictness

The codebase type-checks with **no `any`** and lints with **zero** problems
(errors or warnings). `npm run check` is the gate.

- **TypeScript** (`tsconfig.json`): `strict` plus `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`,
  `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`.
- **ESLint** (`eslint.config.js`, flat config): `@eslint/js` recommended +
  `typescript-eslint` **recommendedTypeChecked**, plus stricter custom rules
  (`no-explicit-any`, the `no-unsafe-*` family, `consistent-type-imports`,
  `switch-exhaustiveness-check`, `no-confusing-void-expression`, …) with
  `explicit-function-return-type` raised to **error**. Node tooling scripts
  (`*.mjs`) are linted as plain ESM without type-aware rules.

## License

[MIT](./LICENSE)
