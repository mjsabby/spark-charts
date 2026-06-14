// The Chart: owns the canvases, scales, interaction and render loop.
//
// Two stacked canvases:
//   * main    – background, grid, axes, threshold lines, series. Redrawn only
//               when data / viewport / size changes.
//   * overlay – series value pills + crosshair. Redrawn on every pointer move,
//               which is why it never touches the (potentially huge) series.
//
// A tiny requestAnimationFrame scheduler coalesces invalidations so a burst of
// events results in at most one redraw per frame.

import type {
  AxisSide,
  ChartOptions,
  ChartOptionsInput,
  DataPoint,
  LineStyle,
  PlotRect,
  RenderContext,
  SeriesHost,
  Time,
} from './types';
import { resolveOptions, deepMerge } from './defaults';
import { generateTimeTicks, formatCrosshairTime } from './time';
import { valueTicks } from './scale';
import { CandlestickSeries, HistogramSeries, LineSeries, lineDashFor } from './series';
import type {
  CandlestickSeriesOptions,
  HistogramSeriesOptions,
  LineSeriesOptions,
  Series,
} from './series';
import { Legend } from './legend';
import { clamp, contrastText, roundRectPath, uniqueId } from './utils';

export interface ThresholdLineOptions {
  id?: string;
  value: number;
  color?: string;
  lineWidth?: number;
  lineStyle?: LineStyle;
  /** Name pill text (e.g. "high p90"). */
  label?: string;
  /** Value pill text; defaults to the formatted value. */
  labelValue?: string | null;
  labelColor?: string;
  labelBackground?: string;
  /** Override colours for the value pill (defaults to the label colours). */
  valueColor?: string | null;
  valueBackground?: string | null;
  /** Show the value pill next to the label. */
  showValuePill?: boolean;
  side?: AxisSide | null;
}

interface ThresholdLine {
  id: string;
  value: number;
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  label: string | null;
  labelValue: string | null;
  labelColor: string;
  labelBackground: string;
  valueColor: string;
  valueBackground: string;
  showValuePill: boolean;
  side: AxisSide | null;
}

interface PillSegment {
  text: string;
  bg: string;
  fg: string;
}

interface DragState {
  active: boolean;
  moved: boolean;
  startX: number;
  startY: number;
  fromAtStart: Time;
  toAtStart: Time;
}

interface HoverState {
  active: boolean;
  x: number;
  y: number;
}

const PILL_H = 16;

export class Chart {
  options: ChartOptions;
  private readonly container: HTMLElement;
  private readonly mainCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly mainCtx: CanvasRenderingContext2D;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly legend: Legend | null;

  private readonly series: Series[] = [];
  private readonly thresholds: ThresholdLine[] = [];

  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

  // Visible time window. `null` until there is data.
  private timeFrom: Time | null = null;
  private timeTo: Time | null = null;
  // True once the user pans/zooms/sets a range; until then the view auto-fits
  // to the data on every change (so add-then-setData "just works").
  private userRange = false;

  // Cached data extent / resolution.
  private dataMin = 0;
  private dataMax = 1;
  private medianDt = 86_400;

  // Cached scales from the last main render (used by the overlay).
  private rc: RenderContext | null = null;

  private drag: DragState = {
    active: false, moved: false, startX: 0, startY: 0, fromAtStart: 0, toAtStart: 0,
  };
  private hover: HoverState = { active: false, x: 0, y: 0 };

  private mainDirty = true;
  private overlayDirty = true;
  private frameHandle = 0;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  private readonly host: SeriesHost = {
    invalidateMain: () => { this.invalidateMain(); },
    invalidateOverlay: () => { this.invalidateOverlay(); },
    onSeriesDataChanged: () => { this.onSeriesDataChanged(); },
  };

  constructor(container: HTMLElement, options?: ChartOptionsInput) {
    this.container = container;
    this.options = resolveOptions(options);

    const style = getComputedStyle(container);
    if (style.position === 'static') container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.style.background = this.options.layout.background;

    this.mainCanvas = this.createCanvas(1, 'none');
    this.overlayCanvas = this.createCanvas(2, 'none');
    this.mainCtx = must2d(this.mainCanvas);
    this.overlayCtx = must2d(this.overlayCanvas);

    this.legend = new Legend(
      this.options.layout,
      this.options.legend,
      this.options.title,
      {
        onToggle: (id) => { this.toggleSeries(id); },
        onClear: () => { this.clearSeries(); },
      },
    );
    container.appendChild(this.legend.element);

    this.attachEvents();
    this.measure();

    this.resizeObserver = new ResizeObserver(() => { this.measure(); });
    this.resizeObserver.observe(container);
  }

  // --- canvas / sizing -----------------------------------------------------

  private createCanvas(z: number, pointerEvents: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    Object.assign(c.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: String(z),
      pointerEvents,
    } as CSSStyleDeclaration);
    this.container.appendChild(c);
    return c;
  }

  private measure(): void {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(0, Math.floor(rect.width));
    const h = Math.max(0, Math.floor(rect.height));
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = w;
    this.cssHeight = h;
    for (const c of [this.mainCanvas, this.overlayCanvas]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    this.mainCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.overlayCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.invalidateMain();
  }

  private plotRect(): PlotRect {
    const { layout, valueAxis, timeAxis } = this.options;
    const axisW = valueAxis.visible ? valueAxis.width : 0;
    const left = layout.padding.left + (valueAxis.side === 'left' ? axisW : 0);
    const right = this.cssWidth - layout.padding.right - (valueAxis.side === 'right' ? axisW : 0);
    const top = layout.padding.top;
    const bottom = this.cssHeight - layout.padding.bottom - (timeAxis.visible ? timeAxis.height : 0);
    return { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  // --- public API: series --------------------------------------------------

  addLineSeries(options: LineSeriesOptions = {}): LineSeries {
    const s = new LineSeries(options.id ?? uniqueId('line'), options);
    return this.registerSeries(s) as LineSeries;
  }

  /** Convenience: a line with an area fill enabled by default. */
  addAreaSeries(options: LineSeriesOptions = {}): LineSeries {
    return this.addLineSeries({ ...options, area: options.area ?? true });
  }

  addHistogramSeries(options: HistogramSeriesOptions = {}): HistogramSeries {
    const s = new HistogramSeries(options.id ?? uniqueId('hist'), options);
    return this.registerSeries(s) as HistogramSeries;
  }

  addCandlestickSeries(options: CandlestickSeriesOptions = {}): CandlestickSeries {
    const s = new CandlestickSeries(options.id ?? uniqueId('candle'), options);
    return this.registerSeries(s) as CandlestickSeries;
  }

  /**
   * Merge new options over the current ones at runtime (deep merge; functions
   * and arrays replace). Used to re-theme in place — e.g. a dark-mode flip —
   * without recreating the chart, so series and the zoom window are preserved.
   */
  applyOptions(input: ChartOptionsInput): void {
    this.options = deepMerge(this.options, input);
    this.container.style.background = this.options.layout.background;
    this.invalidateMain();
  }

  private registerSeries(s: Series): Series {
    s.attach(this.host);
    this.series.push(s);
    this.legend?.addSeries(s.id, s.title, s.color, s.visible);
    this.recomputeExtent();
    if (this.timeFrom == null) this.fitContent();
    else this.invalidateMain();
    return s;
  }

  removeSeries(target: Series | string): void {
    const id = typeof target === 'string' ? target : target.id;
    const idx = this.series.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.series.splice(idx, 1);
    this.legend?.removeSeries(id);
    this.recomputeExtent();
    this.invalidateMain();
  }

  getSeries(): readonly Series[] {
    return this.series;
  }

  private toggleSeries(id: string): void {
    const s = this.series.find((x) => x.id === id);
    if (!s) return;
    s.setVisible(!s.visible);
    this.legend?.setActive(id, s.visible);
  }

  private clearSeries(): void {
    const anyVisible = this.series.some((s) => s.visible);
    for (const s of this.series) {
      s.visible = !anyVisible;
      this.legend?.setActive(s.id, s.visible);
    }
    this.invalidateMain();
  }

  // --- public API: thresholds ---------------------------------------------

  addThresholdLine(options: ThresholdLineOptions): string {
    const bg = options.labelBackground ?? options.color ?? '#3a4a66';
    const fg = options.labelColor ?? contrastText(bg);
    const line: ThresholdLine = {
      id: options.id ?? uniqueId('threshold'),
      value: options.value,
      color: options.color ?? '#9aa7bd',
      lineWidth: options.lineWidth ?? 1,
      lineStyle: options.lineStyle ?? 'dashed',
      label: options.label ?? null,
      labelValue: options.labelValue ?? null,
      labelColor: fg,
      labelBackground: bg,
      valueColor: options.valueColor ?? fg,
      valueBackground: options.valueBackground ?? bg,
      showValuePill: options.showValuePill ?? true,
      side: options.side ?? null,
    };
    this.thresholds.push(line);
    this.invalidateMain();
    return line.id;
  }

  removeThresholdLine(id: string): void {
    const idx = this.thresholds.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this.thresholds.splice(idx, 1);
      this.invalidateMain();
    }
  }

  // --- public API: viewport ------------------------------------------------

  /** Show the whole data range and resume auto-fitting on data changes. */
  fitContent(): void {
    this.recomputeExtent();
    if (this.dataMax > this.dataMin) {
      this.timeFrom = this.dataMin;
      this.timeTo = this.dataMax;
    } else {
      this.timeFrom = this.dataMin;
      this.timeTo = this.dataMin + this.medianDt * 10;
    }
    this.userRange = false;
    this.invalidateMain();
  }

  setVisibleRange(from: Time, to: Time): void {
    if (to <= from) return;
    const c = this.clampDomain(from, to, false);
    this.timeFrom = c.from;
    this.timeTo = c.to;
    this.userRange = true;
    this.invalidateMain();
  }

  getVisibleRange(): { from: Time; to: Time } | null {
    return this.timeFrom == null || this.timeTo == null
      ? null
      : { from: this.timeFrom, to: this.timeTo };
  }

  // --- data extent ---------------------------------------------------------

  private onSeriesDataChanged(): void {
    this.recomputeExtent();
    if (this.userRange && this.timeFrom != null && this.timeTo != null) {
      // Keep the user's window, just nudge it back inside the new data bounds.
      const c = this.clampDomain(this.timeFrom, this.timeTo, false);
      this.timeFrom = c.from;
      this.timeTo = c.to;
      this.invalidateMain();
    } else {
      this.fitContent();
    }
  }

  private recomputeExtent(): void {
    let mn = Infinity;
    let mx = -Infinity;
    let primary: Series | null = null;
    let best = -1;
    for (const s of this.series) {
      if (s.data.length === 0) continue;
      mn = Math.min(mn, s.data[0].time);
      mx = Math.max(mx, s.data[s.data.length - 1].time);
      if (s.data.length > best) {
        best = s.data.length;
        primary = s;
      }
    }
    if (!isFinite(mn)) {
      this.dataMin = 0;
      this.dataMax = 1;
      this.medianDt = 86_400;
      return;
    }
    this.dataMin = mn;
    this.dataMax = mx;
    this.medianDt = primary ? estimateMedianDt(primary.data) : 86_400;
  }

  // --- scheduling ----------------------------------------------------------

  invalidateMain(): void {
    this.mainDirty = true;
    this.schedule();
  }

  invalidateOverlay(): void {
    this.overlayDirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.frameHandle || this.destroyed) return;
    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = 0;
      this.frame();
    });
  }

  private frame(): void {
    if (this.destroyed) return;
    if (this.cssWidth === 0 || this.cssHeight === 0) return;
    if (this.mainDirty) {
      this.buildScales();
      this.renderMain();
      this.mainDirty = false;
      this.overlayDirty = true;
    }
    if (this.overlayDirty) {
      this.renderOverlay();
      this.overlayDirty = false;
    }
  }

  // --- scales --------------------------------------------------------------

  private buildScales(): void {
    const plot = this.plotRect();
    const from = this.timeFrom ?? this.dataMin;
    const to = this.timeTo ?? this.dataMin + this.medianDt * 10;
    const span = Math.max(1, to - from);
    const vd = this.computeValueDomain(from, to);
    const vSpan = vd.max - vd.min || 1;
    const invert = this.options.valueAxis.invert;

    const timeToX = (t: Time): number => plot.left + ((t - from) / span) * plot.width;
    const valueToY = (v: number): number => {
      const f = (v - vd.min) / vSpan;
      return invert ? plot.top + f * plot.height : plot.bottom - f * plot.height;
    };

    let densest = 1;
    for (const s of this.series) {
      if (!s.visible) continue;
      const [i0, i1] = s.visibleRange(from, to);
      densest = Math.max(densest, i1 - i0 + 1);
    }
    const pixelsPerPoint = plot.width / Math.max(1, densest - 1);

    this.rc = {
      ctx: this.mainCtx,
      plot,
      timeMin: from,
      timeMax: to,
      valueMin: vd.min,
      valueMax: vd.max,
      timeToX,
      valueToY,
      pixelsPerPoint,
    };
  }

  private xToTime(x: number): Time {
    const rc = this.rc!;
    const span = rc.timeMax - rc.timeMin;
    return rc.timeMin + ((x - rc.plot.left) / Math.max(1, rc.plot.width)) * span;
  }

  private yToValue(y: number): number {
    const rc = this.rc!;
    const f = (rc.plot.bottom - y) / Math.max(1, rc.plot.height);
    const v = rc.valueMin + f * (rc.valueMax - rc.valueMin);
    return this.options.valueAxis.invert
      ? rc.valueMin + (1 - f) * (rc.valueMax - rc.valueMin)
      : v;
  }

  private computeValueDomain(from: Time, to: Time): { min: number; max: number } {
    const o = this.options.valueAxis;
    let mn = Infinity;
    let mx = -Infinity;
    for (const s of this.series) {
      if (!s.visible || s.data.length === 0) continue;
      const [i0, i1] = s.visibleRange(from, to);
      for (let i = i0; i <= i1; i++) {
        const lo = s.lowAt(i);
        const hi = s.highAt(i);
        if (lo < mn) mn = lo;
        if (hi > mx) mx = hi;
      }
      if (s instanceof HistogramSeries) {
        if (s.base < mn) mn = s.base;
        if (s.base > mx) mx = s.base;
      }
    }
    if (o.includeThresholds) {
      for (const t of this.thresholds) {
        if (t.value < mn) mn = t.value;
        if (t.value > mx) mx = t.value;
      }
    }
    if (!isFinite(mn) || !isFinite(mx)) {
      mn = 0;
      mx = 1;
    }
    if (mn === mx) {
      mn -= 1;
      mx += 1;
    }
    const range = mx - mn;
    mn -= range * o.scaleMargins.bottom;
    mx += range * o.scaleMargins.top;
    if (o.minValue != null) mn = o.minValue;
    if (o.maxValue != null) mx = o.maxValue;
    return { min: mn, max: mx };
  }

  // --- main render ---------------------------------------------------------

  private renderMain(): void {
    const rc = this.rc;
    if (!rc) return;
    const ctx = this.mainCtx;
    const o = this.options;
    const plot = rc.plot;

    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.fillStyle = o.layout.background;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.font = `${o.layout.fontSize}px ${o.layout.fontFamily}`;

    const span = rc.timeMax - rc.timeMin;
    const target = Math.max(2, Math.floor(plot.width / o.timeAxis.minTickSpacing));
    const timeTicks = generateTimeTicks(rc.timeMin, rc.timeMax, target, o.timeAxis.timezone);
    const vTicks = valueTicks(rc.valueMin, rc.valueMax, o.valueAxis.ticks);

    // Grid.
    if (o.grid.visible) {
      ctx.strokeStyle = o.grid.color;
      ctx.lineWidth = o.grid.lineWidth;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const v of vTicks) {
        const y = Math.round(rc.valueToY(v)) + 0.5;
        if (y < plot.top - 1 || y > plot.bottom + 1) continue;
        ctx.moveTo(plot.left, y);
        ctx.lineTo(plot.right, y);
      }
      for (const t of timeTicks) {
        const x = Math.round(rc.timeToX(t.time)) + 0.5;
        if (x < plot.left - 1 || x > plot.right + 1) continue;
        ctx.moveTo(x, plot.top);
        ctx.lineTo(x, plot.bottom);
      }
      ctx.stroke();
    }

    // Threshold lines (behind the series).
    for (const t of this.thresholds) {
      const y = rc.valueToY(t.value);
      if (y < plot.top || y > plot.bottom) continue;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.lineWidth;
      ctx.setLineDash(lineDashFor(t.lineStyle));
      ctx.beginPath();
      ctx.moveTo(plot.left, Math.round(y) + 0.5);
      ctx.lineTo(plot.right, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Per-series last-value price line: a dashed horizontal line at each series'
    // most recent value, in the series colour (matches the axis pill).
    for (const s of this.series) {
      if (!s.visible || !s.priceLineVisible || s.data.length === 0) continue;
      const y = rc.valueToY(s.data[s.data.length - 1].value);
      if (y < plot.top || y > plot.bottom) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(plot.left, Math.round(y) + 0.5);
      ctx.lineTo(plot.right, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Series, clipped to the plot.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.left, plot.top, plot.width, plot.height);
    ctx.clip();
    for (const s of this.series) {
      if (s.visible) s.draw(rc);
    }
    ctx.restore();

    // Axis labels.
    this.drawValueAxis(ctx, vTicks);
    this.drawTimeAxis(ctx, timeTicks, span);

    // Threshold pills (in front of the series).
    for (const t of this.thresholds) {
      const y = rc.valueToY(t.value);
      if (y < plot.top - PILL_H || y > plot.bottom + PILL_H) continue;
      const segs: PillSegment[] = [];
      if (t.label) segs.push({ text: t.label, bg: t.labelBackground, fg: t.labelColor });
      if (t.showValuePill) {
        const txt = t.labelValue ?? o.valueAxis.format(t.value);
        segs.push({ text: txt, bg: t.valueBackground, fg: t.valueColor });
      }
      if (segs.length) this.drawPill(ctx, y, segs, t.side ?? o.valueAxis.side);
    }
  }

  private drawValueAxis(ctx: CanvasRenderingContext2D, ticks: number[]): void {
    const o = this.options;
    if (!o.valueAxis.visible) return;
    const rc = this.rc!;
    const plot = rc.plot;
    ctx.fillStyle = o.layout.textColor;
    ctx.textBaseline = 'middle';
    const onRight = o.valueAxis.side === 'right';
    ctx.textAlign = onRight ? 'left' : 'right';
    const x = onRight ? plot.right + 8 : plot.left - 8;
    for (const v of ticks) {
      const y = rc.valueToY(v);
      if (y < plot.top - 1 || y > plot.bottom + 1) continue;
      ctx.fillText(o.valueAxis.format(v), x, y);
    }
  }

  private drawTimeAxis(
    ctx: CanvasRenderingContext2D,
    ticks: ReturnType<typeof generateTimeTicks>,
    _span: number,
  ): void {
    const o = this.options;
    if (!o.timeAxis.visible) return;
    const rc = this.rc!;
    const plot = rc.plot;
    ctx.fillStyle = o.layout.textColor;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    const y = plot.bottom + 7;
    for (const t of ticks) {
      const x = rc.timeToX(t.time);
      if (x < plot.left - 30 || x > plot.right + 30) continue;
      const label = o.timeAxis.format
        ? o.timeAxis.format(t.time, t.unit, null)
        : t.label;
      ctx.fillText(label, x, y);
    }
  }

  // --- overlay render ------------------------------------------------------

  private renderOverlay(): void {
    const rc = this.rc;
    if (!rc) return;
    const ctx = this.overlayCtx;
    const o = this.options;
    const plot = rc.plot;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.font = `${o.layout.fontSize}px ${o.layout.fontFamily}`;

    const hovering = this.hover.active;
    let snapTime: Time | null = null;
    let snapX = 0;
    if (hovering) {
      const tAt = this.xToTime(this.hover.x);
      const ref = this.primarySeries();
      if (o.crosshair.snap && ref && ref.data.length) {
        const idx = ref.nearestIndex(tAt);
        snapTime = ref.data[idx].time;
        snapX = rc.timeToX(snapTime);
      } else {
        snapTime = tAt;
        snapX = this.hover.x;
      }
    }

    // Crosshair lines.
    if (hovering && o.crosshair.visible) {
      ctx.save();
      ctx.strokeStyle = o.crosshair.color;
      ctx.lineWidth = o.crosshair.lineWidth;
      ctx.setLineDash(o.crosshair.lineDash);
      if (o.crosshair.verticalLine) {
        const vx = Math.round(snapX) + 0.5;
        ctx.beginPath();
        ctx.moveTo(vx, plot.top);
        ctx.lineTo(vx, plot.bottom);
        ctx.stroke();
      }
      if (o.crosshair.horizontalLine) {
        const hy = Math.round(clamp(this.hover.y, plot.top, plot.bottom)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(plot.left, hy);
        ctx.lineTo(plot.right, hy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Per-series value pills (+ markers when hovering). Shown at the cursor
    // when hovering, otherwise at the last point.
    for (const s of this.series) {
      if (!s.visible) continue;
      if (!hovering && !s.lastValueVisible) continue;
      let idx: number;
      if (hovering && snapTime != null) idx = s.nearestIndex(snapTime);
      else idx = s.data.length - 1;
      const p = s.data[idx];
      if (!p) continue;
      const y = rc.valueToY(p.value);
      const valTxt = (s.valueFormat ?? o.valueAxis.format)(p.value);
      this.legend?.setValue(s.id, valTxt);
      if (y < plot.top - PILL_H || y > plot.bottom + PILL_H) continue;

      if (hovering && s.crosshairMarkerVisible) {
        this.drawMarker(ctx, rc.timeToX(p.time), y, s.markerColorAt(idx));
      }
      if (s.lastValueVisible || hovering) {
        const fg = contrastText(s.color);
        const text = s.lastValueTitleVisible ? `${s.title}  ${valTxt}` : valTxt;
        this.drawPill(ctx, y, [{ text, bg: s.color, fg }], o.valueAxis.side);
      }
    }

    if (hovering && snapTime != null) {
      // Crosshair value pill at the cursor's Y.
      const cy = clamp(this.hover.y, plot.top, plot.bottom);
      const cv = this.yToValue(cy);
      this.drawPill(
        ctx,
        cy,
        [{ text: o.valueAxis.format(cv), bg: o.crosshair.labelBackground, fg: o.crosshair.labelColor }],
        o.valueAxis.side,
      );
      // Date readout at the bottom.
      const label = o.timeAxis.crosshairFormat
        ? o.timeAxis.crosshairFormat(snapTime)
        : formatCrosshairTime(snapTime, o.timeAxis.timezone, this.medianDt);
      this.drawTimePill(ctx, snapX, label);
    }
  }

  private primarySeries(): Series | null {
    let best: Series | null = null;
    let n = -1;
    for (const s of this.series) {
      if (s.visible && s.data.length > n) {
        n = s.data.length;
        best = s;
      }
    }
    return best;
  }

  // --- overlay primitives --------------------------------------------------

  private drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const r = this.options.crosshair.markerRadius;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = this.options.layout.background;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  /** Draw one or more adjacent pills anchored to the value axis at height `cy`. */
  private drawPill(
    ctx: CanvasRenderingContext2D,
    cy: number,
    segments: PillSegment[],
    side: AxisSide,
  ): void {
    const padX = 6;
    const widths = segments.map((s) => Math.ceil(ctx.measureText(s.text).width) + padX * 2);
    const total = widths.reduce((a, b) => a + b, 0);
    // Anchor flush to the canvas edge on the axis side so multi-segment pills
    // (name + value) are never clipped; they may extend over the plot, which
    // is the intended look.
    const margin = 2;
    let x = side === 'right' ? this.cssWidth - margin - total : margin;
    const y = clamp(Math.round(cy - PILL_H / 2), 1, this.cssHeight - PILL_H - 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < segments.length; i++) {
      const w = widths[i];
      roundRectPath(ctx, x, y, w, PILL_H, 3);
      ctx.fillStyle = segments[i].bg;
      ctx.fill();
      ctx.fillStyle = segments[i].fg;
      ctx.fillText(segments[i].text, x + w / 2, y + PILL_H / 2 + 0.5);
      x += w;
    }
  }

  private drawTimePill(ctx: CanvasRenderingContext2D, cx: number, text: string): void {
    const o = this.options;
    const plot = this.rc!.plot;
    const padX = 7;
    const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const h = Math.min(o.timeAxis.height - 2, 18);
    let x = cx - w / 2;
    x = clamp(x, plot.left, plot.right - w);
    const y = plot.bottom + (o.timeAxis.height - h) / 2 + 1;
    roundRectPath(ctx, x, y, w, h, 3);
    ctx.fillStyle = o.crosshair.labelBackground;
    ctx.fill();
    ctx.fillStyle = o.crosshair.labelColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  }

  // --- interaction ---------------------------------------------------------

  private attachEvents(): void {
    const el = this.overlayCanvas;
    el.style.pointerEvents = 'auto';
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.clearHover);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('blur', this.clearHover);
    document.addEventListener('mouseleave', this.clearHover);
  }

  private localPoint(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private insidePlot(x: number, y: number): boolean {
    const p = this.plotRect();
    return x >= p.left && x <= p.right && y >= p.top && y <= p.bottom;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.timeFrom == null || this.timeTo == null) return;
    this.overlayCanvas.setPointerCapture(e.pointerId);
    const { x, y } = this.localPoint(e);
    this.drag = {
      active: true,
      moved: false,
      startX: x,
      startY: y,
      fromAtStart: this.timeFrom,
      toAtStart: this.timeTo,
    };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.localPoint(e);
    if (this.drag.active) {
      const dx = x - this.drag.startX;
      if (Math.abs(dx) + Math.abs(y - this.drag.startY) > 2) this.drag.moved = true;
      if (this.drag.moved) {
        this.hover.active = false;
        this.overlayCanvas.style.cursor = 'grabbing';
        this.panBy(dx);
      }
      return;
    }
    this.overlayCanvas.style.cursor = 'crosshair';
    this.hover = { active: this.insidePlot(x, y), x, y };
    this.invalidateOverlay();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.overlayCanvas.hasPointerCapture(e.pointerId)) {
      this.overlayCanvas.releasePointerCapture(e.pointerId);
    }
    const wasDrag = this.drag.moved;
    this.drag.active = false;
    this.drag.moved = false;
    this.overlayCanvas.style.cursor = 'crosshair';
    const { x, y } = this.localPoint(e);
    this.hover = { active: this.insidePlot(x, y), x, y };
    if (!wasDrag) this.invalidateOverlay();
  };

  // Clears the crosshair. Bound to the canvas `pointerleave` AND to window
  // `blur` / document `mouseleave`, because those last two fire when the pointer
  // leaves via paths that never deliver a canvas `pointerleave` (tab/app switch,
  // the cursor leaving the viewport) — otherwise the crosshair + value pills
  // would freeze on screen.
  private clearHover = (): void => {
    if (this.drag.active || !this.hover.active) return;
    this.hover.active = false;
    this.invalidateOverlay();
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.timeFrom == null || this.timeTo == null || !this.rc) return;
    e.preventDefault();
    const { x, y } = this.localPoint(e);
    const speed = this.options.zoomSpeed;
    const factor = e.deltaY > 0 ? speed : 1 / speed;
    const tCursor = this.xToTime(clamp(x, this.rc.plot.left, this.rc.plot.right));
    const from = tCursor - (tCursor - this.timeFrom) * factor;
    const to = tCursor + (this.timeTo - tCursor) * factor;
    const c = this.clampDomain(from, to, false);
    this.timeFrom = c.from;
    this.timeTo = c.to;
    this.userRange = true;
    this.hover = { active: this.insidePlot(x, y), x, y };
    this.invalidateMain();
  };

  private onDoubleClick = (): void => {
    this.fitContent();
  };

  private panBy(dxPixels: number): void {
    const plot = this.plotRect();
    const span = this.drag.toAtStart - this.drag.fromAtStart;
    const dt = (dxPixels / Math.max(1, plot.width)) * span;
    const c = this.clampDomain(this.drag.fromAtStart - dt, this.drag.toAtStart - dt, true);
    this.timeFrom = c.from;
    this.timeTo = c.to;
    this.userRange = true;
    this.invalidateMain();
  }

  /**
   * Keep the window sane. `keepSpan` (panning) shifts the window back into
   * bounds without resizing it; otherwise (zoom) the span is clamped too.
   */
  private clampDomain(from: Time, to: Time, keepSpan: boolean): { from: Time; to: Time } {
    const dataSpan = Math.max(this.medianDt, this.dataMax - this.dataMin);
    let span = to - from;

    if (!keepSpan) {
      const minSpan = Math.max(this.medianDt * 3, dataSpan * 1e-4);
      const maxSpan = dataSpan;
      span = clamp(span, minSpan, maxSpan);
    }

    // Allow a small amount of overscroll past the data on each edge.
    const overscan = dataSpan * 0.04;
    const lo = this.dataMin - overscan;
    const hi = this.dataMax + overscan;

    if (from < lo) {
      from = lo;
      to = from + span;
    }
    if (to > hi) {
      to = hi;
      from = to - span;
    }
    if (from < lo) from = lo;
    return { from, to: keepSpan ? from + span : Math.max(from + span, to) };
  }

  // --- teardown ------------------------------------------------------------

  destroy(): void {
    this.destroyed = true;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.resizeObserver?.disconnect();
    const el = this.overlayCanvas;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.clearHover);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('dblclick', this.onDoubleClick);
    window.removeEventListener('blur', this.clearHover);
    document.removeEventListener('mouseleave', this.clearHover);
    this.legend?.destroy();
    this.mainCanvas.remove();
    this.overlayCanvas.remove();
  }
}

// --- module helpers --------------------------------------------------------

function must2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('spark-charts: 2D canvas context unavailable');
  return ctx;
}

function estimateMedianDt(data: DataPoint[]): number {
  if (data.length < 2) return 86_400;
  const sampleStride = Math.max(1, Math.floor((data.length - 1) / 200));
  const diffs: number[] = [];
  for (let i = sampleStride; i < data.length; i += sampleStride) {
    diffs.push((data[i].time - data[i - sampleStride].time) / sampleStride);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 86_400;
}
