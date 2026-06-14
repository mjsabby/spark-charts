// Default chart options (dark theme matching the reference screenshots) plus
// the option-merging helper and a couple of handy value formatters.

import type { ChartOptions, ChartOptionsInput } from './types';
import { autoNumberFormat } from './scale';

/** `(v) => "12.34%"` */
export function percentFormat(decimals = 2): (v: number) => string {
  return (v) => v.toFixed(decimals) + '%';
}

/** `(v) => "12.34"` */
export function fixedFormat(decimals = 2): (v: number) => string {
  return (v) => v.toFixed(decimals);
}

export const DEFAULT_OPTIONS: ChartOptions = {
  layout: {
    background: '#0e1827',
    textColor: '#8a99ad',
    titleColor: '#d7e0ec',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 11,
    padding: { top: 18, right: 6, bottom: 4, left: 6 },
  },
  grid: {
    visible: true,
    color: '#1b2740',
    lineWidth: 1,
  },
  valueAxis: {
    side: 'right',
    visible: true,
    width: 66,
    autoScale: true,
    invert: false,
    scaleMargins: { top: 0.12, bottom: 0.12 },
    includeThresholds: true,
    minValue: null,
    maxValue: null,
    ticks: 8,
    format: autoNumberFormat,
  },
  timeAxis: {
    visible: true,
    height: 26,
    timezone: 'utc',
    minTickSpacing: 90,
    format: null,
    crosshairFormat: null,
  },
  crosshair: {
    visible: true,
    snap: true,
    pinLastValue: true,
    valueLabel: 'marker',
    horizontalLine: true,
    verticalLine: true,
    color: '#7e8ca3',
    lineWidth: 1,
    lineDash: [4, 3],
    labelBackground: '#2b3a55',
    labelColor: '#eaf1fb',
    markerRadius: 4,
  },
  legend: {
    visible: false,
    showClearButton: true,
  },
  title: '',
  zoomSpeed: 1.1,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Deep-merge `override` onto a clone of `base` (functions/arrays replace). */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (isPlainObject(override)) {
    for (const key of Object.keys(override)) {
      const ov = override[key];
      if (ov === undefined) continue;
      const bv = out[key];
      out[key] = isPlainObject(bv) && isPlainObject(ov) ? deepMerge(bv, ov) : ov;
    }
  }
  return out as T;
}

export function resolveOptions(input?: ChartOptionsInput): ChartOptions {
  return deepMerge(DEFAULT_OPTIONS, input);
}
