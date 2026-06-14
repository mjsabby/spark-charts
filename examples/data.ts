// Synthetic, deterministic data that mimics the five reference screenshots.

import type { DataPoint } from '../src/index';

const DAY = 86_400; // one day in epoch seconds (the Time unit)

/** Small seeded PRNG so the demo looks identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(values: number[], q: number): number {
  const s = values.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return base + 1 < s.length ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}

const utc = (y: number, m: number, d: number): number => Date.UTC(y, m, d) / 1000;

/** Sequence of weekday (Mon–Fri) UTC midnights ending at `end`. */
function businessDaysEndingAt(end: number, count: number): number[] {
  const out: number[] = [];
  let t = end;
  while (out.length < count) {
    const dow = new Date(t * 1000).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(t);
    t -= DAY;
  }
  return out.reverse();
}

/** Calendar days (incl. weekends) starting at `start`. */
function calendarDays(start: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(start + i * DAY);
  return out;
}

export interface ThresholdSpec {
  value: number;
  label: string;
  color: string;
}

export interface SeriesData {
  data: DataPoint[];
}

export interface SeriesWithThresholds extends SeriesData {
  thresholds: ThresholdSpec[];
}

export interface IntradayData {
  highs: DataPoint[];
  lows: DataPoint[];
  thresholds: ThresholdSpec[];
}

// 1) SPY – Intraday Moves: green "high" sticks and red "low" sticks per day,
//    with percentile threshold lines. Values are percentages.
export function intradayMoves(): IntradayData {
  const rng = mulberry32(11);
  const days = businessDaysEndingAt(utc(2026, 5, 12), 251);
  const highs: DataPoint[] = [];
  const lows: DataPoint[] = [];
  for (const time of days) {
    const baseHi = Math.abs(gaussian(rng)) * 0.42 + 0.15;
    const baseLo = -(Math.abs(gaussian(rng)) * 0.42 + 0.12);
    const hiSpike = rng() < 0.06 ? Math.abs(gaussian(rng)) * 0.9 : 0;
    const loSpike = rng() < 0.06 ? -Math.abs(gaussian(rng)) * 1.1 : 0;
    highs.push({ time, value: Math.min(2.1, baseHi + hiSpike) });
    lows.push({ time, value: Math.max(-3.0, baseLo + loSpike) });
  }
  const hv = highs.map((p) => p.value);
  const lv = lows.map((p) => p.value);
  const thresholds: ThresholdSpec[] = [
    { value: quantile(hv, 0.9), label: 'high p90', color: '#3fa860' },
    { value: quantile(hv, 0.5), label: 'high p50', color: '#3fa860' },
    { value: 0, label: 'open', color: '#8a99ad' },
    { value: quantile(lv, 0.5), label: 'low p50', color: '#e0524e' },
    { value: quantile(lv, 0.1), label: 'low p90', color: '#e0524e' },
  ];
  return { highs, lows, thresholds };
}

// 2) SPY – Drawdown (20Y): % below the running all-time-high, with percentiles.
export function drawdown(): SeriesWithThresholds {
  const rng = mulberry32(7);
  const days = calendarDays(utc(2006, 0, 2), 20 * 365 + 5);
  let logPrice = Math.log(100);
  let peak = -Infinity;
  const data: DataPoint[] = [];
  for (let i = 0; i < days.length; i++) {
    // Mild upward drift with occasional volatility regimes / crashes.
    const t = i / days.length;
    const bigCrash = t > 0.12 && t < 0.155;
    const miniCrash = (t > 0.32 && t < 0.33) || (t > 0.7 && t < 0.712);
    const crash = bigCrash || miniCrash;
    const drift = 0.0003;
    const vol = crash ? 0.024 : 0.011;
    logPrice += drift + gaussian(rng) * vol - (bigCrash ? 0.0028 : miniCrash ? 0.006 : 0);
    const price = Math.exp(logPrice);
    peak = Math.max(peak, price);
    const dd = (price / peak - 1) * 100;
    data.push({ time: days[i], value: dd });
  }
  const vals = data.map((p) => p.value);
  const thresholds: ThresholdSpec[] = [
    { value: quantile(vals, 0.9), label: '10th', color: '#7cc36a' },
    { value: quantile(vals, 0.75), label: '25th', color: '#c9d24a' },
    { value: quantile(vals, 0.5), label: '50th', color: '#e6a23c' },
    { value: quantile(vals, 0.25), label: '75th', color: '#e08a3c' },
    { value: quantile(vals, 0.0), label: '100th', color: '#e0524e' },
  ];
  return { data, thresholds };
}

// 3) 15-Day Rolling Returns: a single oscillating line in %.
export function rollingReturns(): SeriesData {
  const rng = mulberry32(23);
  const days = calendarDays(utc(2021, 6, 1), Math.round(5 * 365));
  const daily: number[] = [];
  for (let i = 0; i < days.length; i++) daily.push(gaussian(rng) * 0.9 + 0.03);
  const data: DataPoint[] = [];
  for (let i = 14; i < days.length; i++) {
    let sum = 0;
    for (let k = i - 14; k <= i; k++) sum += daily[k];
    data.push({ time: days[i], value: sum });
  }
  return { data };
}

// 4) Relative Performance: many holdings normalised to 0% at the start.
export interface NamedSeries {
  id: string;
  color: string;
  data: DataPoint[];
}

export function relativePerformance(): NamedSeries[] {
  const specs: Array<{ id: string; color: string; drift: number; vol: number; seed: number }> = [
    { id: 'QQQ', color: '#e0524e', drift: 0.16, vol: 1.1, seed: 1 },
    { id: 'VEA', color: '#e07b3c', drift: 0.12, vol: 0.8, seed: 2 },
    { id: 'VTI', color: '#3fa860', drift: 0.11, vol: 0.85, seed: 3 },
    { id: 'SPY', color: '#4c8dff', drift: 0.105, vol: 0.8, seed: 4 },
    { id: 'VUG', color: '#8a6cff', drift: 0.1, vol: 1.0, seed: 5 },
    { id: 'SCHG', color: '#36b3c2', drift: 0.09, vol: 1.0, seed: 6 },
    { id: 'JPM', color: '#5fb35a', drift: 0.088, vol: 1.05, seed: 7 },
    { id: 'XLV', color: '#5aa9e0', drift: 0.066, vol: 0.7, seed: 8 },
    { id: 'VZ', color: '#e0b13c', drift: 0.06, vol: 0.7, seed: 9 },
    { id: 'AXP', color: '#d559b0', drift: 0.05, vol: 1.3, seed: 10 },
    { id: 'AMZN', color: '#36c2a8', drift: 0.05, vol: 1.4, seed: 11 },
    { id: 'QQQI', color: '#e05a8a', drift: 0.045, vol: 0.9, seed: 12 },
    { id: 'HPQ', color: '#4f86d6', drift: 0.015, vol: 1.5, seed: 13 },
    { id: 'STRC', color: '#e0a93c', drift: 0.004, vol: 0.5, seed: 14 },
    { id: 'PG', color: '#5fb37a', drift: -0.035, vol: 0.7, seed: 15 },
    { id: 'V', color: '#6f86ff', drift: -0.045, vol: 1.1, seed: 16 },
    { id: 'MSFT', color: '#e0913c', drift: -0.09, vol: 1.2, seed: 17 },
    { id: 'IBIT', color: '#7cc36a', drift: -0.2, vol: 2.6, seed: 18 },
  ];
  const days = businessDaysEndingAt(utc(2026, 5, 5), 252);
  return specs.map((spec) => {
    const rng = mulberry32(spec.seed * 97 + 5);
    let cum = 0;
    const data: DataPoint[] = [];
    const perStepDrift = (spec.drift * 100) / days.length;
    for (let i = 0; i < days.length; i++) {
      cum += perStepDrift + gaussian(rng) * spec.vol;
      data.push({ time: days[i], value: i === 0 ? 0 : cum });
    }
    return { id: spec.id, color: spec.color, data };
  });
}

// 5) SPY/TLT ratio (5Y): a rising line with an area fill and percentile lines.
export function ratio(): SeriesWithThresholds {
  const rng = mulberry32(42);
  const days = calendarDays(utc(2021, 6, 1), Math.round(5 * 365));
  let v = 1.0;
  const data: DataPoint[] = [];
  for (let i = 0; i < days.length; i++) {
    const t = i / days.length;
    const drift = 0.0011 - (t > 0.55 && t < 0.62 ? 0.01 : 0);
    v *= Math.exp(drift + gaussian(rng) * 0.011);
    data.push({ time: days[i], value: v });
  }
  const vals = data.map((p) => p.value);
  const thresholds: ThresholdSpec[] = [
    { value: quantile(vals, 0.9), label: '90th', color: '#e0524e' },
    { value: quantile(vals, 0.75), label: '75th', color: '#e08a3c' },
    { value: quantile(vals, 0.5), label: '50th', color: '#e0b13c' },
    { value: quantile(vals, 0.25), label: '25th', color: '#36b3c2' },
    { value: quantile(vals, 0.1), label: '10th', color: '#4c8dff' },
  ];
  return { data, thresholds };
}
