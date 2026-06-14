// Smart time-axis tick generation + hierarchical labelling.
//
// The axis is always time. Given a visible [tMin, tMax] window and a pixel
// width, we pick a "nice" calendar step (… 1m, 5m, 1h, 1d, 1mo, 3mo, 1y …)
// and emit aligned ticks. Labels show the *most significant unit that
// changed*: months on a multi-month view, but the year at a year boundary;
// day numbers on a multi-day view, but the month name at a month boundary —
// which is what TradingView-style axes do.

import type { Time, TimeUnit, Timezone } from './types';

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Public Time is epoch **seconds**, so these durations are in seconds too.
// Calendar math bridges to the millisecond-based Date API via MS_PER_SEC.
const MS_PER_SEC = 1000;
const SEC = 1;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

interface Parts {
  Y: number;
  Mo: number; // 0..11
  D: number; // 1..31
  h: number;
  mi: number;
  s: number;
  ms: number;
  wd: number; // 0=Sun
}

function parts(t: Time, tz: Timezone): Parts {
  const d = new Date(t * MS_PER_SEC);
  if (tz === 'utc') {
    return {
      Y: d.getUTCFullYear(), Mo: d.getUTCMonth(), D: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
      ms: d.getUTCMilliseconds(), wd: d.getUTCDay(),
    };
  }
  return {
    Y: d.getFullYear(), Mo: d.getMonth(), D: d.getDate(),
    h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(),
    ms: d.getMilliseconds(), wd: d.getDay(),
  };
}

function make(tz: Timezone, Y: number, Mo: number, D: number, h = 0, mi = 0, s = 0): Time {
  const ms = tz === 'utc' ? Date.UTC(Y, Mo, D, h, mi, s) : new Date(Y, Mo, D, h, mi, s).getTime();
  return Math.round(ms / MS_PER_SEC);
}

const startOfDay = (t: Time, tz: Timezone): Time => {
  const q = parts(t, tz);
  return make(tz, q.Y, q.Mo, q.D);
};
const startOfMonth = (t: Time, tz: Timezone): Time => {
  const q = parts(t, tz);
  return make(tz, q.Y, q.Mo, 1);
};
const startOfYear = (t: Time, tz: Timezone): Time => {
  const q = parts(t, tz);
  return make(tz, q.Y, 0, 1);
};
const startOfWeek = (t: Time, tz: Timezone): Time => {
  // Weeks start on Monday.
  const q = parts(t, tz);
  const dow = (q.wd + 6) % 7;
  return startOfDay(t, tz) - dow * DAY;
};
// Calendar-aware steppers (handle month/year rollover + DST by re-deriving).
const addDaysCal = (t: Time, n: number, tz: Timezone): Time => {
  const q = parts(t, tz);
  return make(tz, q.Y, q.Mo, q.D + n);
};
const addMonths = (t: Time, n: number, tz: Timezone): Time => {
  const q = parts(t, tz);
  return make(tz, q.Y, q.Mo + n, 1);
};
const addYears = (t: Time, n: number, tz: Timezone): Time => {
  const q = parts(t, tz);
  return make(tz, q.Y + n, 0, 1);
};

interface Step {
  unit: TimeUnit;
  n: number;
  approx: number; // approximate duration in seconds, used only for choosing density
}

const STEPS: Step[] = [
  { unit: 'second', n: 1, approx: SEC },
  { unit: 'second', n: 5, approx: 5 * SEC },
  { unit: 'second', n: 15, approx: 15 * SEC },
  { unit: 'second', n: 30, approx: 30 * SEC },
  { unit: 'minute', n: 1, approx: MIN },
  { unit: 'minute', n: 5, approx: 5 * MIN },
  { unit: 'minute', n: 15, approx: 15 * MIN },
  { unit: 'minute', n: 30, approx: 30 * MIN },
  { unit: 'hour', n: 1, approx: HOUR },
  { unit: 'hour', n: 3, approx: 3 * HOUR },
  { unit: 'hour', n: 6, approx: 6 * HOUR },
  { unit: 'hour', n: 12, approx: 12 * HOUR },
  { unit: 'day', n: 1, approx: DAY },
  { unit: 'week', n: 1, approx: 7 * DAY },
  { unit: 'month', n: 1, approx: 30 * DAY },
  { unit: 'month', n: 3, approx: 91 * DAY },
  { unit: 'month', n: 6, approx: 182 * DAY },
  { unit: 'year', n: 1, approx: 365 * DAY },
  { unit: 'year', n: 2, approx: 730 * DAY },
  { unit: 'year', n: 5, approx: 1826 * DAY },
  { unit: 'year', n: 10, approx: 3652 * DAY },
  { unit: 'year', n: 25, approx: 9131 * DAY },
  { unit: 'year', n: 50, approx: 18262 * DAY },
  { unit: 'year', n: 100, approx: 36525 * DAY },
];

export function chooseStep(span: number, targetCount: number): Step {
  const ideal = span / Math.max(1, targetCount);
  for (const s of STEPS) {
    if (s.approx >= ideal) return s;
  }
  return STEPS[STEPS.length - 1];
}

export interface TimeTick {
  time: Time;
  label: string;
  unit: TimeUnit;
  /** True at a "major" boundary (year, or month-on-day-scale) for emphasis. */
  major: boolean;
}

function labelFor(t: Time, prev: Time | null, unit: TimeUnit, tz: Timezone): string {
  const q = parts(t, tz);
  const pr = prev == null ? null : parts(prev, tz);
  switch (unit) {
    case 'year':
      return String(q.Y);
    case 'month':
    case 'week':
    case 'day': {
      if (unit === 'month') {
        return pr == null || pr.Y !== q.Y ? String(q.Y) : MONTHS[q.Mo];
      }
      if (pr == null || pr.Y !== q.Y) return String(q.Y);
      if (pr.Mo !== q.Mo) return MONTHS[q.Mo];
      return String(q.D);
    }
    case 'millisecond':
    case 'second':
    case 'minute':
    case 'hour': {
      // sub-day: show the date when the day rolls over, else the clock.
      if (pr == null || pr.D !== q.D || pr.Mo !== q.Mo || pr.Y !== q.Y) {
        return `${q.D} ${MONTHS[q.Mo]}`;
      }
      if (unit === 'second') return `${pad2(q.h)}:${pad2(q.mi)}:${pad2(q.s)}`;
      if (unit === 'millisecond') return `${pad2(q.s)}.${q.ms}`;
      return `${pad2(q.h)}:${pad2(q.mi)}`;
    }
  }
}

function isMajor(t: Time, unit: TimeUnit, tz: Timezone): boolean {
  const q = parts(t, tz);
  if (unit === 'year') return true;
  if (unit === 'month') return q.Mo === 0;
  return q.D === 1 && q.h === 0 && q.mi === 0;
}

export function generateTimeTicks(
  tMin: Time,
  tMax: Time,
  targetCount: number,
  tz: Timezone,
): TimeTick[] {
  if (!(tMax > tMin)) return [];
  const step = chooseStep(tMax - tMin, targetCount);
  const u = step.unit;
  const times: Time[] = [];

  if (u === 'millisecond' || u === 'second' || u === 'minute' || u === 'hour') {
    // Fixed-size steps that evenly divide a day -> align from local midnight.
    const interval = step.approx;
    const day0 = startOfDay(tMin, tz);
    const k = Math.ceil((tMin - day0) / interval);
    for (let t = day0 + k * interval; t <= tMax; t += interval) {
      if (t >= tMin) times.push(t);
    }
  } else if (u === 'day') {
    let t = startOfDay(tMin, tz);
    if (t < tMin) t = addDaysCal(t, 1, tz);
    for (; t <= tMax; t = addDaysCal(t, step.n, tz)) times.push(t);
  } else if (u === 'week') {
    let t = startOfWeek(tMin, tz);
    if (t < tMin) t = addDaysCal(t, 7, tz);
    for (; t <= tMax; t = addDaysCal(t, 7 * step.n, tz)) times.push(t);
  } else if (u === 'month') {
    let t = startOfMonth(tMin, tz);
    if (t < tMin) t = addMonths(t, 1, tz);
    for (; t <= tMax; t = addMonths(t, 1, tz)) {
      if (parts(t, tz).Mo % step.n === 0) times.push(t);
    }
  } else {
    let t = startOfYear(tMin, tz);
    if (t < tMin) t = addYears(t, 1, tz);
    for (; t <= tMax; t = addYears(t, 1, tz)) {
      if (parts(t, tz).Y % step.n === 0) times.push(t);
    }
  }

  const out: TimeTick[] = [];
  let prev: Time | null = null;
  for (const t of times) {
    out.push({ time: t, unit: u, label: labelFor(t, prev, u, tz), major: isMajor(t, u, tz) });
    prev = t;
  }
  return out;
}

/**
 * Full date readout for the crosshair, with detail scaled to the data's
 * native resolution (`medianDt`). Daily/intraday data shows the time too,
 * matching the screenshots (e.g. `02 Jul '20  00:00:00`).
 */
export function formatCrosshairTime(t: Time, tz: Timezone, medianDt: number): string {
  const q = parts(t, tz);
  const yy = String(q.Y).slice(-2);
  if (medianDt < 28 * DAY) {
    return `${pad2(q.D)} ${MONTHS[q.Mo]} '${yy}  ${pad2(q.h)}:${pad2(q.mi)}:${pad2(q.s)}`;
  }
  if (medianDt < 360 * DAY) return `${MONTHS[q.Mo]} ${q.Y}`;
  return String(q.Y);
}
