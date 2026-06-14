// Small dependency-free helpers: math, binary search, colour, canvas paths.

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)` and `rgba(...)`. */
export function parseColor(c: string): RGBA {
  c = c.trim();
  if (c[0] === '#') {
    let hex = c.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map((x) => x + x)
        .join('');
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
  }
  const m = c.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p[3] == null ? 1 : p[3] };
  }
  return { r: 128, g: 128, b: 128, a: 1 };
}

export function withAlpha(color: string, a: number): string {
  const { r, g, b } = parseColor(color);
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})`;
}

/** Pick black or white text for legibility on top of `bg`. */
export function contrastText(bg: string): string {
  const { r, g, b } = parseColor(bg);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0b1220' : '#ffffff';
}

/** First index whose `.time` is >= `t` (classic lower-bound). */
export function lowerBound(data: ReadonlyArray<{ time: number }>, t: number): number {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the point whose `.time` is closest to `t`. */
export function nearestIndex(data: ReadonlyArray<{ time: number }>, t: number): number {
  if (data.length === 0) return -1;
  const lo = lowerBound(data, t);
  if (lo <= 0) return 0;
  if (lo >= data.length) return data.length - 1;
  const a = data[lo - 1];
  const b = data[lo];
  return t - a.time <= b.time - t ? lo - 1 : lo;
}

/** Quantile of an already-sorted ascending array (linear interpolation). */
export function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * clamp(q, 0, 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  return base + 1 < n ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

type CanvasWithRoundRect = CanvasRenderingContext2D & {
  roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
};

/** Trace a rounded rectangle path (uses native roundRect when present). */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const c = ctx as CanvasWithRoundRect;
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof c.roundRect === 'function') {
    c.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

let _idSeq = 0;
export function uniqueId(prefix: string): string {
  _idSeq += 1;
  return `${prefix}-${_idSeq}`;
}
