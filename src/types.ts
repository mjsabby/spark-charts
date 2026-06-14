// Shared types for spark-charts.

/** Epoch time in **seconds** (UTC). The X axis is always time. */
export type Time = number;

/** A single point of a series. */
export interface DataPoint {
  time: Time;
  value: number;
}

export type AxisSide = 'left' | 'right';
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type Timezone = 'utc' | 'local';

/** Granularity chosen by the time-axis tick generator. */
export type TimeUnit =
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year';

/** Recursively-optional version of T, but functions/arrays are kept intact. */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? U[]
    : T extends object
      ? { [P in keyof T]?: DeepPartial<T[P]> }
      : T;

// ---------------------------------------------------------------------------
// Resolved (fully-specified) option shapes used internally.
// ---------------------------------------------------------------------------

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutOptions {
  background: string;
  textColor: string;
  /** Slightly brighter colour for titles / emphasised text. */
  titleColor: string;
  fontFamily: string;
  fontSize: number;
  padding: Padding;
}

export interface GridOptions {
  visible: boolean;
  color: string;
  lineWidth: number;
}

export interface ValueAxisOptions {
  side: AxisSide;
  visible: boolean;
  /** Width of the axis gutter in CSS px. */
  width: number;
  /** Auto-fit the value range to the visible data on every redraw. */
  autoScale: boolean;
  /** Flip the axis so larger values are at the bottom. */
  invert: boolean;
  /** Fractional padding above/below the data when auto-scaling (0..1). */
  scaleMargins: { top: number; bottom: number };
  /** Include threshold-line values when auto-scaling. */
  includeThresholds: boolean;
  /** Fixed minimum; `null` = auto. */
  minValue: number | null;
  /** Fixed maximum; `null` = auto. */
  maxValue: number | null;
  /** Target number of value ticks. */
  ticks: number;
  /** Formats a value for the axis labels / pills. */
  format: (value: number) => string;
}

export interface TimeAxisOptions {
  visible: boolean;
  height: number;
  timezone: Timezone;
  /** Minimum spacing between ticks in px (drives tick density). */
  minTickSpacing: number;
  /** Override the per-tick label. */
  format: ((time: Time, unit: TimeUnit, prev: Time | null) => string) | null;
  /** Override the crosshair date readout at the bottom. */
  crosshairFormat: ((time: Time) => string) | null;
}

export interface CrosshairOptions {
  visible: boolean;
  /** Snap the vertical line to the nearest data point of the densest series. */
  snap: boolean;
  horizontalLine: boolean;
  verticalLine: boolean;
  color: string;
  lineWidth: number;
  lineDash: number[];
  labelBackground: string;
  labelColor: string;
  markerRadius: number;
}

export interface LegendOptions {
  visible: boolean;
  /** Show a "Clear" button that toggles every series off/on. */
  showClearButton: boolean;
}

export interface ChartOptions {
  layout: LayoutOptions;
  grid: GridOptions;
  valueAxis: ValueAxisOptions;
  timeAxis: TimeAxisOptions;
  crosshair: CrosshairOptions;
  legend: LegendOptions;
  title: string;
  /** Mouse-wheel zoom sensitivity (1 = off, 1.1 = gentle). */
  zoomSpeed: number;
}

export type ChartOptionsInput = DeepPartial<ChartOptions>;

// ---------------------------------------------------------------------------
// Rendering context handed to each series' draw() method.
// ---------------------------------------------------------------------------

export interface PlotRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  plot: PlotRect;
  timeMin: Time;
  timeMax: Time;
  valueMin: number;
  valueMax: number;
  timeToX(time: Time): number;
  valueToY(value: number): number;
  /** Approximate horizontal spacing between adjacent data points, in px. */
  pixelsPerPoint: number;
}

/** Minimal surface a series uses to talk back to its chart. */
export interface SeriesHost {
  invalidateMain(): void;
  invalidateOverlay(): void;
  onSeriesDataChanged(): void;
}
