import type { Row, SectionId } from './statsRows.ts';
import { BUDGET_MS } from './statsSpark.ts';
import { ms } from './statUnit.ts';

/** An element of `tag` with `className`, its text `text`. */
export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

/** The sparkline's legend: its two lines and the budget's, `budget` being the word in the page's language. */
export function makeLegend(budget: string) {
  const legend = make('div', 't3s-legend');
  for (const [name, colour] of [
    ['GPU', 'var(--gpu)'],
    ['CPU', 'var(--cpu)'],
    [`${budget} ${ms(BUDGET_MS)}`, 'rgba(255,255,255,.45)'],
  ]) {
    const key = make('span', '', name);
    const swatch = make('i');
    swatch.style.background = colour;
    key.prepend(swatch);
    legend.append(key);
  }
  return legend;
}

/** Writes `text` only when it changed: the panel never relays out for an equal number. */
export function put(element: Element, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

/** Sets `element`'s class only when it changed. */
export function setClass(element: Element, className: string) {
  if (element.className !== className) element.className = className;
}

/** Fills `rows` of section `id` with `wanted`, reusing its row elements. */
export function fillRows(box: HTMLElement, id: SectionId, wanted: readonly Row[]) {
  while (box.children.length > wanted.length) box.lastElementChild!.remove();
  while (box.children.length < wanted.length) {
    const row = make('div', 't3s-row');
    row.dataset.sec = id;
    row.append(make('span'), make('span'), make('span'), make('i', 't3s-bar'));
    box.append(row);
  }
  wanted.forEach(([label, value, unit, share], index) => {
    const [name, number, measure, bar] = box.children[index].children as unknown as HTMLElement[];
    if (name.textContent !== label) name.title = label;
    put(name, label);
    put(number, value);
    put(measure, unit);
    const scale = `scaleX(${share == null ? 0 : share.toFixed(3)})`;
    if (bar.style.transform !== scale) bar.style.transform = scale;
  });
}
