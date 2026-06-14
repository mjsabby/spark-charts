// Interactive legend rendered as DOM chips that float over the top-left of the
// chart (like the reference "Relative Performance" chart). Clicking a chip
// toggles the series; the optional "Clear" button toggles everything.
//
// The header container is pointer-events:none so the crosshair still tracks
// when the cursor passes over the title; only the chips capture clicks.

import type { LayoutOptions, LegendOptions } from './types';

interface LegendCallbacks {
  onToggle(id: string): void;
  onClear(): void;
}

interface LegendItem {
  chip: HTMLButtonElement;
  dot: HTMLSpanElement;
  valueEl: HTMLSpanElement;
}

export class Legend {
  readonly element: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly chipRow: HTMLDivElement;
  private readonly items = new Map<string, LegendItem>();
  private readonly layout: LayoutOptions;
  private readonly callbacks: LegendCallbacks;

  constructor(
    layout: LayoutOptions,
    legend: LegendOptions,
    titleText: string,
    callbacks: LegendCallbacks,
  ) {
    this.layout = layout;
    this.callbacks = callbacks;
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      top: '8px',
      left: '12px',
      right: '12px',
      pointerEvents: 'none',
      zIndex: '3',
      fontFamily: layout.fontFamily,
      userSelect: 'none',
    } as CSSStyleDeclaration);

    const title = document.createElement('div');
    title.textContent = titleText;
    Object.assign(title.style, {
      color: layout.titleColor,
      fontSize: '15px',
      fontWeight: '600',
      marginBottom: '6px',
      display: titleText ? 'block' : 'none',
    } as CSSStyleDeclaration);

    const chipRow = document.createElement('div');
    Object.assign(chipRow.style, {
      display: legend.visible ? 'flex' : 'none',
      flexWrap: 'wrap',
      gap: '6px',
      alignItems: 'center',
    } as CSSStyleDeclaration);

    if (legend.visible && legend.showClearButton) {
      const clear = this.makeButton();
      clear.textContent = 'Clear';
      clear.style.color = layout.textColor;
      clear.addEventListener('click', () => { this.callbacks.onClear(); });
      chipRow.appendChild(clear);
    }

    el.appendChild(title);
    el.appendChild(chipRow);
    this.element = el;
    this.title = title;
    this.chipRow = chipRow;
  }

  private makeButton(): HTMLButtonElement {
    const b = document.createElement('button');
    Object.assign(b.style, {
      pointerEvents: 'auto',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 9px',
      borderRadius: '6px',
      border: '1px solid #2a3a55',
      background: '#16223a',
      color: this.layout.titleColor,
      fontSize: '12px',
      fontFamily: this.layout.fontFamily,
      lineHeight: '1.3',
      transition: 'opacity .12s ease',
    } as CSSStyleDeclaration);
    return b;
  }

  setTitle(text: string): void {
    this.title.textContent = text;
    this.title.style.display = text ? 'block' : 'none';
  }

  addSeries(id: string, title: string, color: string, visible: boolean): void {
    if (this.items.has(id)) return;
    const chip = this.makeButton();

    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: '9px',
      height: '9px',
      borderRadius: '50%',
      background: color,
      flex: '0 0 auto',
    } as CSSStyleDeclaration);

    const label = document.createElement('span');
    label.textContent = title;

    const valueEl = document.createElement('span');
    valueEl.style.color = this.layout.textColor;
    valueEl.style.fontVariantNumeric = 'tabular-nums';

    chip.appendChild(dot);
    chip.appendChild(label);
    chip.appendChild(valueEl);
    chip.addEventListener('click', () => { this.callbacks.onToggle(id); });
    this.chipRow.appendChild(chip);

    const item: LegendItem = { chip, dot, valueEl };
    this.items.set(id, item);
    this.setActive(id, visible);
  }

  removeSeries(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    item.chip.remove();
    this.items.delete(id);
  }

  setActive(id: string, visible: boolean): void {
    const item = this.items.get(id);
    if (!item) return;
    item.chip.style.opacity = visible ? '1' : '0.42';
  }

  setValue(id: string, text: string): void {
    const item = this.items.get(id);
    if (item) item.valueEl.textContent = text;
  }

  destroy(): void {
    this.element.remove();
    this.items.clear();
  }
}
