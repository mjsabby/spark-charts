// Series types. A Series owns sorted data and knows how to draw itself given
// a RenderContext (scales + plot rect). Dense data is decimated to a min/max
// envelope per pixel column so a 20-year daily series stays cheap to draw
// without losing spikes.

import type {
  DataPoint,
  LineStyle,
  RenderContext,
  SeriesHost,
  Time,
} from './types';
import { lowerBound, nearestIndex, withAlpha } from './utils';

export function lineDashFor(style: LineStyle): number[] {
  if (style === 'dashed') return [6, 4];
  if (style === 'dotted') return [2, 3];
  return [];
}

export interface BaseSeriesOptions {
  id?: string;
  title?: string;
  color?: string;
  visible?: boolean;
  /** Draw a value pill on the axis for the last point. */
  lastValueVisible?: boolean;
  /** Prefix the value pill with the series title (e.g. `SPY  0.42%`). */
  lastValueTitleVisible?: boolean;
  /** Draw a dashed horizontal line across the plot at the last value. */
  priceLineVisible?: boolean;
  /** Show the marker dot under the crosshair. */
  crosshairMarkerVisible?: boolean;
  /** Per-series value formatter (falls back to the axis formatter). */
  valueFormat?: ((v: number) => string) | null;
}

export abstract class Series {
  readonly id: string;
  title: string;
  color: string;
  visible: boolean;
  lastValueVisible: boolean;
  lastValueTitleVisible: boolean;
  priceLineVisible: boolean;
  crosshairMarkerVisible: boolean;
  valueFormat: ((v: number) => string) | null;
  data: DataPoint[] = [];
  protected host: SeriesHost | null = null;

  constructor(id: string, opts: BaseSeriesOptions) {
    this.id = id;
    this.title = opts.title ?? id;
    this.color = opts.color ?? '#4c8dff';
    this.visible = opts.visible ?? true;
    this.lastValueVisible = opts.lastValueVisible ?? true;
    this.lastValueTitleVisible = opts.lastValueTitleVisible ?? false;
    this.priceLineVisible = opts.priceLineVisible ?? false;
    this.crosshairMarkerVisible = opts.crosshairMarkerVisible ?? true;
    this.valueFormat = opts.valueFormat ?? null;
  }

  /** @internal */
  attach(host: SeriesHost): void {
    this.host = host;
  }

  /** Update the shared (base) options in place and request a redraw. */
  applyOptions(opts: BaseSeriesOptions): void {
    if (opts.title !== undefined) this.title = opts.title;
    if (opts.color !== undefined) this.color = opts.color;
    if (opts.visible !== undefined) this.visible = opts.visible;
    if (opts.lastValueVisible !== undefined) this.lastValueVisible = opts.lastValueVisible;
    if (opts.lastValueTitleVisible !== undefined) this.lastValueTitleVisible = opts.lastValueTitleVisible;
    if (opts.priceLineVisible !== undefined) this.priceLineVisible = opts.priceLineVisible;
    if (opts.crosshairMarkerVisible !== undefined) {
      this.crosshairMarkerVisible = opts.crosshairMarkerVisible;
    }
    if (opts.valueFormat !== undefined) this.valueFormat = opts.valueFormat;
    this.host?.invalidateMain();
  }

  setData(data: DataPoint[]): this {
    this.data = data.slice().sort((a, b) => a.time - b.time);
    this.host?.onSeriesDataChanged();
    return this;
  }

  /** Append a point, or replace the last one if the time matches. */
  update(point: DataPoint): this {
    const d = this.data;
    const last = d[d.length - 1];
    if (last && point.time < last.time) {
      // Out-of-order: fall back to a full re-sort insert.
      d.push(point);
      d.sort((a, b) => a.time - b.time);
    } else if (last && point.time === last.time) {
      d[d.length - 1] = point;
    } else {
      d.push(point);
    }
    this.host?.onSeriesDataChanged();
    return this;
  }

  setVisible(visible: boolean): this {
    if (this.visible !== visible) {
      this.visible = visible;
      this.host?.invalidateMain();
    }
    return this;
  }

  nearestIndex(time: Time): number {
    return nearestIndex(this.data, time);
  }

  /** [firstIndex, lastIndex] visible in [tMin, tMax], padded by one each side. */
  visibleRange(tMin: Time, tMax: Time): [number, number] {
    const d = this.data;
    if (d.length === 0) return [0, -1];
    const i0 = Math.max(0, lowerBound(d, tMin) - 1);
    const i1 = Math.min(d.length - 1, lowerBound(d, tMax));
    return [i0, i1];
  }

  /** Colour of the crosshair marker at a given index (sign-aware for bars). */
  markerColorAt(_index: number): string {
    return this.color;
  }

  /** Lowest / highest plotted value at an index — overridden by OHLC series so
   *  the value axis auto-scales to the wicks, not just the close. */
  lowAt(index: number): number {
    return this.data[index].value;
  }

  highAt(index: number): number {
    return this.data[index].value;
  }

  abstract draw(rc: RenderContext): void;

  /**
   * Build the visible polyline, decimating to a min/max envelope when there
   * are far more points than pixels.
   */
  protected buildPoints(rc: RenderContext): { x: number[]; y: number[] } {
    const x: number[] = [];
    const y: number[] = [];
    const [i0, i1] = this.visibleRange(rc.timeMin, rc.timeMax);
    const count = i1 - i0 + 1;
    if (count <= 0) return { x, y };
    const d = this.data;

    if (count <= rc.plot.width * 2) {
      for (let i = i0; i <= i1; i++) {
        x.push(rc.timeToX(d[i].time));
        y.push(rc.valueToY(d[i].value));
      }
      return { x, y };
    }

    // Dense path: one column at a time, emitting first, min, max, last so the
    // line preserves vertical spikes while staying ~4 points per pixel.
    let col = Math.floor(rc.timeToX(d[i0].time));
    let firstT = d[i0].time, firstV = d[i0].value;
    let lastT = firstT, lastV = firstV;
    let minT = firstT, minV = firstV, maxT = firstT, maxV = firstV;

    const flush = (): void => {
      x.push(rc.timeToX(firstT));
      y.push(rc.valueToY(firstV));
      if (minT <= maxT) {
        x.push(rc.timeToX(minT)); y.push(rc.valueToY(minV));
        x.push(rc.timeToX(maxT)); y.push(rc.valueToY(maxV));
      } else {
        x.push(rc.timeToX(maxT)); y.push(rc.valueToY(maxV));
        x.push(rc.timeToX(minT)); y.push(rc.valueToY(minV));
      }
      x.push(rc.timeToX(lastT));
      y.push(rc.valueToY(lastV));
    };

    for (let i = i0; i <= i1; i++) {
      const t = d[i].time;
      const v = d[i].value;
      const c = Math.floor(rc.timeToX(t));
      if (c !== col) {
        flush();
        col = c;
        firstT = t; firstV = v;
        minT = maxT = t; minV = maxV = v;
      } else {
        if (v < minV) { minV = v; minT = t; }
        if (v > maxV) { maxV = v; maxT = t; }
      }
      lastT = t; lastV = v;
    }
    flush();
    return { x, y };
  }
}

// ---------------------------------------------------------------------------

export interface AreaFill {
  topColor: string;
  bottomColor: string;
  /** Baseline the fill drops to: a value, or the plot edge. */
  baseline: number | 'bottom' | 'top';
}

export interface LineSeriesOptions extends BaseSeriesOptions {
  lineWidth?: number;
  lineStyle?: LineStyle;
  /** Draw the connecting line. Set false (with point markers) for a dot cloud. */
  lineVisible?: boolean;
  /** Draw a filled dot at each (decimated) point. */
  pointMarkersVisible?: boolean;
  /** Radius of the point-marker dots, in CSS px. */
  pointMarkersRadius?: number;
  /**
   * Fill under the line. `true` derives a translucent gradient from `color`;
   * pass an object to control it explicitly.
   */
  area?: Partial<AreaFill> | boolean;
}

export class LineSeries extends Series {
  lineWidth: number;
  lineStyle: LineStyle;
  lineVisible: boolean;
  pointMarkersVisible: boolean;
  pointMarkersRadius: number;
  area: AreaFill | null;

  constructor(id: string, opts: LineSeriesOptions = {}) {
    super(id, opts);
    this.lineWidth = opts.lineWidth ?? 1.5;
    this.lineStyle = opts.lineStyle ?? 'solid';
    this.lineVisible = opts.lineVisible ?? true;
    this.pointMarkersVisible = opts.pointMarkersVisible ?? false;
    this.pointMarkersRadius = opts.pointMarkersRadius ?? 2;
    this.area = LineSeries.resolveArea(opts.area, this.color);
  }

  override applyOptions(opts: LineSeriesOptions): void {
    if (opts.lineWidth !== undefined) this.lineWidth = opts.lineWidth;
    if (opts.lineStyle !== undefined) this.lineStyle = opts.lineStyle;
    if (opts.lineVisible !== undefined) this.lineVisible = opts.lineVisible;
    if (opts.pointMarkersVisible !== undefined) this.pointMarkersVisible = opts.pointMarkersVisible;
    if (opts.pointMarkersRadius !== undefined) this.pointMarkersRadius = opts.pointMarkersRadius;
    if (opts.area !== undefined) {
      this.area = LineSeries.resolveArea(opts.area, opts.color ?? this.color);
    }
    super.applyOptions(opts);
  }

  private static resolveArea(
    area: Partial<AreaFill> | boolean | undefined,
    color: string,
  ): AreaFill | null {
    if (!area) return null;
    const base: AreaFill = {
      topColor: withAlpha(color, 0.28),
      bottomColor: withAlpha(color, 0.02),
      baseline: 'bottom',
    };
    return area === true ? base : { ...base, ...area };
  }

  draw(rc: RenderContext): void {
    const { ctx, plot } = rc;
    const { x, y } = this.buildPoints(rc);
    if (x.length === 0) return;

    if (this.area) {
      const baseY =
        this.area.baseline === 'bottom'
          ? plot.bottom
          : this.area.baseline === 'top'
            ? plot.top
            : rc.valueToY(this.area.baseline);
      ctx.beginPath();
      ctx.moveTo(x[0], baseY);
      for (let i = 0; i < x.length; i++) ctx.lineTo(x[i], y[i]);
      ctx.lineTo(x[x.length - 1], baseY);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, plot.top, 0, plot.bottom);
      grad.addColorStop(0, this.area.topColor);
      grad.addColorStop(1, this.area.bottomColor);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    if (this.lineVisible) {
      ctx.beginPath();
      ctx.moveTo(x[0], y[0]);
      for (let i = 1; i < x.length; i++) ctx.lineTo(x[i], y[i]);
      ctx.lineWidth = this.lineWidth;
      ctx.strokeStyle = this.color;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.setLineDash(lineDashFor(this.lineStyle));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.pointMarkersVisible) {
      const r = this.pointMarkersRadius;
      ctx.fillStyle = this.color;
      for (let i = 0; i < x.length; i++) {
        ctx.beginPath();
        ctx.arc(x[i], y[i], r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ---------------------------------------------------------------------------

export interface HistogramSeriesOptions extends BaseSeriesOptions {
  /** Value the bars grow from (the "open" / zero line). */
  base?: number;
  positiveColor?: string;
  negativeColor?: string;
  /** Bar width as a fraction of the point spacing (0..1). */
  barWidth?: number;
}

export class HistogramSeries extends Series {
  base: number;
  positiveColor: string;
  negativeColor: string;
  barWidthFraction: number;

  constructor(id: string, opts: HistogramSeriesOptions = {}) {
    super(id, opts);
    this.base = opts.base ?? 0;
    this.positiveColor = opts.positiveColor ?? opts.color ?? '#26a37b';
    this.negativeColor = opts.negativeColor ?? '#e0524e';
    this.barWidthFraction = opts.barWidth ?? 0.6;
  }

  override markerColorAt(index: number): string {
    const p = this.data[index];
    return p && p.value >= this.base ? this.positiveColor : this.negativeColor;
  }

  draw(rc: RenderContext): void {
    const { ctx } = rc;
    const [i0, i1] = this.visibleRange(rc.timeMin, rc.timeMax);
    if (i1 < i0) return;
    const baseY = rc.valueToY(this.base);
    let bw = rc.pixelsPerPoint * this.barWidthFraction;
    bw = Math.max(1, Math.min(bw, 48));
    const thin = bw <= 1.25;

    for (let i = i0; i <= i1; i++) {
      const p = this.data[i];
      const x = rc.timeToX(p.time);
      const y = rc.valueToY(p.value);
      ctx.fillStyle = p.value >= this.base ? this.positiveColor : this.negativeColor;
      const top = Math.min(y, baseY);
      const h = Math.max(1, Math.abs(y - baseY));
      if (thin) {
        ctx.fillRect(Math.round(x), top, 1, h);
      } else {
        ctx.fillRect(x - bw / 2, top, bw, h);
      }
    }
  }
}

// ---------------------------------------------------------------------------

/** One OHLC bar. `color` overrides the up/down colour for this bar only. */
export interface OhlcPoint {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  color?: string;
}

export type CandlestickStyle = 'candle' | 'bar';

export interface CandlestickSeriesOptions extends BaseSeriesOptions {
  /** `candle` = filled body + wick; `bar` = OHLC bar (high-low with open/close ticks). */
  style?: CandlestickStyle;
  upColor?: string;
  downColor?: string;
  wickUpColor?: string;
  wickDownColor?: string;
  borderVisible?: boolean;
  /** Body/bar width as a fraction of the point spacing (0..1). */
  barWidth?: number;
  /** OHLC-bar style: draw the open tick on the left. */
  openVisible?: boolean;
  /** Force 1px-wide marks regardless of spacing. */
  thinBars?: boolean;
}

export class CandlestickSeries extends Series {
  style: CandlestickStyle;
  upColor: string;
  downColor: string;
  wickUpColor: string;
  wickDownColor: string;
  borderVisible: boolean;
  barWidthFraction: number;
  openVisible: boolean;
  thinBars: boolean;
  /** Full OHLC data, kept in sync (and sorted) alongside the base `data`
   *  (whose `value` mirrors each bar's close for the crosshair / nearest-index). */
  bars: OhlcPoint[] = [];

  constructor(id: string, opts: CandlestickSeriesOptions = {}) {
    super(id, opts);
    this.style = opts.style ?? 'candle';
    this.upColor = opts.upColor ?? opts.color ?? '#26a37b';
    this.downColor = opts.downColor ?? '#e0524e';
    this.wickUpColor = opts.wickUpColor ?? this.upColor;
    this.wickDownColor = opts.wickDownColor ?? this.downColor;
    this.borderVisible = opts.borderVisible ?? false;
    this.barWidthFraction = opts.barWidth ?? 0.6;
    this.openVisible = opts.openVisible ?? true;
    this.thinBars = opts.thinBars ?? false;
  }

  override applyOptions(opts: CandlestickSeriesOptions): void {
    if (opts.style !== undefined) this.style = opts.style;
    if (opts.upColor !== undefined) this.upColor = opts.upColor;
    if (opts.downColor !== undefined) this.downColor = opts.downColor;
    if (opts.wickUpColor !== undefined) this.wickUpColor = opts.wickUpColor;
    if (opts.wickDownColor !== undefined) this.wickDownColor = opts.wickDownColor;
    if (opts.borderVisible !== undefined) this.borderVisible = opts.borderVisible;
    if (opts.barWidth !== undefined) this.barWidthFraction = opts.barWidth;
    if (opts.openVisible !== undefined) this.openVisible = opts.openVisible;
    if (opts.thinBars !== undefined) this.thinBars = opts.thinBars;
    super.applyOptions(opts);
  }

  /** Replace the OHLC data (analogue of `Series.setData` for bars). */
  setBars(bars: OhlcPoint[]): this {
    this.bars = bars.slice().sort((a, b) => a.time - b.time);
    this.data = this.bars.map((b) => ({ time: b.time, value: b.close }));
    this.host?.onSeriesDataChanged();
    return this;
  }

  override lowAt(index: number): number {
    return this.bars[index]?.low ?? this.data[index].value;
  }

  override highAt(index: number): number {
    return this.bars[index]?.high ?? this.data[index].value;
  }

  override markerColorAt(index: number): string {
    const b = this.bars[index];
    if (!b) return this.color;
    return b.color ?? (b.close >= b.open ? this.upColor : this.downColor);
  }

  draw(rc: RenderContext): void {
    const { ctx } = rc;
    const [i0, i1] = this.visibleRange(rc.timeMin, rc.timeMax);
    if (i1 < i0) return;
    let bw = rc.pixelsPerPoint * this.barWidthFraction;
    bw = Math.max(1, Math.min(bw, 18));
    const half = Math.max(1, bw / 2);
    const thin = this.thinBars || bw <= 1.25;

    for (let i = i0; i <= i1; i++) {
      const b = this.bars[i];
      if (!b) continue;
      const xc = Math.round(rc.timeToX(b.time)) + 0.5;
      const yH = rc.valueToY(b.high);
      const yL = rc.valueToY(b.low);
      const yO = rc.valueToY(b.open);
      const yC = rc.valueToY(b.close);
      const up = b.close >= b.open;
      const col = b.color ?? (up ? this.upColor : this.downColor);

      if (this.style === 'bar') {
        ctx.strokeStyle = col;
        ctx.lineWidth = thin ? 1 : 1.5;
        ctx.beginPath();
        ctx.moveTo(xc, yH);
        ctx.lineTo(xc, yL);
        if (this.openVisible) {
          ctx.moveTo(xc - half, yO);
          ctx.lineTo(xc, yO);
        }
        ctx.moveTo(xc, yC);
        ctx.lineTo(xc + half, yC);
        ctx.stroke();
      } else {
        ctx.strokeStyle = up ? this.wickUpColor : this.wickDownColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xc, yH);
        ctx.lineTo(xc, yL);
        ctx.stroke();

        const top = Math.min(yO, yC);
        const h = Math.max(1, Math.abs(yC - yO));
        ctx.fillStyle = col;
        if (thin) {
          ctx.fillRect(Math.round(xc), top, 1, h);
        } else {
          ctx.fillRect(xc - half, top, bw, h);
          if (this.borderVisible) {
            ctx.strokeStyle = col;
            ctx.lineWidth = 1;
            ctx.strokeRect(xc - half, top, bw, h);
          }
        }
      }
    }
  }
}
