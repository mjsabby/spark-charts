// Linear value-axis helpers: "nice" tick steps and number formatting.

/** Round `raw` up to the nearest 1/2/5 x 10^k. */
export function niceStep(raw: number): number {
  if (raw <= 0 || !isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * mag;
}

/** Evenly-spaced "nice" tick values covering [min, max]. */
export function valueTicks(min: number, max: number, target: number): number[] {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step = niceStep((max - min) / Math.max(1, target));
  const start = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    // Collapse -0 and tiny float noise to a clean value.
    ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  }
  return ticks;
}

/** Number of decimal places that makes `step` render cleanly. */
export function decimalsForStep(step: number): number {
  if (step >= 1 || step <= 0) return 0;
  return Math.min(8, Math.ceil(-Math.log10(step) - 1e-9));
}

/** A reasonable default value formatter when the caller doesn't supply one. */
export function autoNumberFormat(value: number): string {
  const a = Math.abs(value);
  let decimals: number;
  if (a === 0) decimals = 0;
  else if (a >= 1000) decimals = 0;
  else if (a >= 1) decimals = 2;
  else decimals = Math.min(6, Math.max(2, Math.ceil(-Math.log10(a)) + 1));
  return value.toFixed(decimals);
}
