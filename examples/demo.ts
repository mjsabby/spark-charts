// Builds the five reference charts using the spark-charts library.
import { Chart, percentFormat, fixedFormat } from '../src/index';
import type { ChartOptionsInput } from '../src/index';
import {
  intradayMoves,
  drawdown,
  rollingReturns,
  relativePerformance,
  ratio,
  type ThresholdSpec,
} from './data';

function mount(id: string, options?: ChartOptionsInput): Chart {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing container #${id}`);
  return new Chart(el, options);
}

function addThresholds(chart: Chart, specs: ThresholdSpec[], format: (v: number) => string): void {
  for (const s of specs) {
    chart.addThresholdLine({
      value: s.value,
      label: s.label,
      labelValue: format(s.value),
      color: s.color,
      labelBackground: s.color,
      labelColor: '#ffffff',
      lineStyle: 'dashed',
    });
  }
}

// 1) Intraday moves -----------------------------------------------------------
{
  const { highs, lows, thresholds } = intradayMoves();
  const fmt = percentFormat(2);
  const chart = mount('chart1', {
    title: 'SPY — Intraday Moves (1Y, 251 sessions)',
    valueAxis: { format: fmt, scaleMargins: { top: 0.08, bottom: 0.08 } },
  });
  chart
    .addHistogramSeries({
      id: 'highs',
      base: 0,
      positiveColor: '#3fa860',
      barWidth: 0.24,
      lastValueVisible: false,
      valueFormat: fmt,
      title: 'high',
    })
    .setData(highs);
  chart
    .addHistogramSeries({
      id: 'lows',
      base: 0,
      negativeColor: '#e0524e',
      barWidth: 0.24,
      lastValueVisible: false,
      valueFormat: fmt,
      title: 'low',
    })
    .setData(lows);
  addThresholds(chart, thresholds, fmt);
}

// 2) Drawdown (20Y) -----------------------------------------------------------
{
  const { data, thresholds } = drawdown();
  const fmt = percentFormat(2);
  const chart = mount('chart2', {
    title: 'SPY — Drawdown Chart (20Y)',
    valueAxis: { format: fmt, scaleMargins: { top: 0.04, bottom: 0.06 } },
  });
  chart
    .addAreaSeries({
      id: 'drawdown',
      color: '#6ea8e6',
      lineWidth: 1,
      lastValueVisible: false,
      area: { topColor: 'rgba(110,168,230,0.30)', bottomColor: 'rgba(110,168,230,0.02)' },
      valueFormat: fmt,
    })
    .setData(data);
  addThresholds(chart, thresholds, fmt);
}

// 3) 15-day rolling returns ---------------------------------------------------
{
  const { data } = rollingReturns();
  const fmt = percentFormat(2);
  const chart = mount('chart3', {
    title: '15-Day Rolling Returns',
    legend: { visible: true, showClearButton: false },
    valueAxis: { format: fmt },
  });
  chart
    .addLineSeries({ id: 'SPY', color: '#5b7cfa', lineWidth: 1.5, valueFormat: fmt })
    .setData(data);
}

// 4) Relative performance (multi-series, interactive legend) ------------------
{
  const series = relativePerformance();
  const fmt = fixedFormat(2);
  const chart = mount('chart4', {
    title: 'Relative Performance',
    legend: { visible: true, showClearButton: true },
    valueAxis: { format: fmt, scaleMargins: { top: 0.08, bottom: 0.08 } },
  });
  for (const s of series) {
    chart
      .addLineSeries({ id: s.id, color: s.color, lineWidth: 1.25, valueFormat: fmt })
      .setData(s.data);
  }
}

// 5) SPY/TLT ratio (5Y) -------------------------------------------------------
{
  const { data, thresholds } = ratio();
  const fmt = fixedFormat(4);
  const chart = mount('chart5', {
    title: 'SPY/TLT (5Y)',
    legend: { visible: true, showClearButton: false },
    valueAxis: { format: fmt, scaleMargins: { top: 0.08, bottom: 0.06 } },
  });
  chart
    .addAreaSeries({
      id: 'SPY/TLT',
      color: '#6f86ff',
      lineWidth: 1.5,
      valueFormat: fmt,
      area: { topColor: 'rgba(111,134,255,0.20)', bottomColor: 'rgba(111,134,255,0.01)' },
    })
    .setData(data);
  addThresholds(chart, thresholds, fmt);
}
