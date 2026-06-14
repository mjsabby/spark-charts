// spark-charts — a small canvas charting library for time-series data.

export { Chart } from './chart';
export type { ThresholdLineOptions } from './chart';

export {
  Series,
  LineSeries,
  HistogramSeries,
  CandlestickSeries,
  lineDashFor,
} from './series';
export type {
  BaseSeriesOptions,
  LineSeriesOptions,
  HistogramSeriesOptions,
  CandlestickSeriesOptions,
  CandlestickStyle,
  OhlcPoint,
  AreaFill,
} from './series';

export {
  DEFAULT_OPTIONS,
  resolveOptions,
  deepMerge,
  percentFormat,
  fixedFormat,
} from './defaults';

export {
  generateTimeTicks,
  chooseStep,
  formatCrosshairTime,
  MONTHS,
} from './time';
export type { TimeTick } from './time';

export { valueTicks, niceStep, decimalsForStep, autoNumberFormat } from './scale';

export type {
  Time,
  DataPoint,
  AxisSide,
  LineStyle,
  Timezone,
  TimeUnit,
  ChartOptions,
  ChartOptionsInput,
  LayoutOptions,
  GridOptions,
  ValueAxisOptions,
  TimeAxisOptions,
  CrosshairOptions,
  LegendOptions,
  PlotRect,
  RenderContext,
  DeepPartial,
} from './types';

import { Chart } from './chart';
import type { ChartOptionsInput } from './types';

/** Convenience factory mirroring the `new Chart(...)` constructor. */
export function createChart(container: HTMLElement, options?: ChartOptionsInput): Chart {
  return new Chart(container, options);
}
