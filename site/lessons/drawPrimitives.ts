const NS = 'http://www.w3.org/2000/svg';

/** What the drawings need from their target: a real `<svg>` element, or a recorder in the tests. */
export interface SvgHost {
  setAttribute(name: string, value: string): void;
  append(...nodes: Element[]): void;
  replaceChildren(...nodes: Element[]): void;
}

/** A 2D point, as built by evaluate (a plain pair) or read straight off an engine typed array. */
type Point2 = readonly number[] | Float64Array;
interface LegendItem {
  color: string;
  label: string;
}

export function add(svg: SvgHost, name: string, attributes: Record<string, string | number>) {
  const element = document.createElementNS(NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  svg.append(element);
  return element;
}

export function text(svg: SvgHost, x: number, y: number, value: string | number, anchor = 'start') {
  const node = add(svg, 'text', {
    x,
    y,
    'text-anchor': anchor,
    fill: 'currentColor',
    'font-size': 13,
    'font-family': 'ui-monospace, monospace',
  });
  node.textContent = String(value);
}

export const line = (
  svg: SvgHost,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width = 3,
  dash = '',
) =>
  add(svg, 'line', {
    x1,
    y1,
    x2,
    y2,
    stroke: color,
    'stroke-width': width,
    'stroke-dasharray': dash,
    'marker-end': width > 2 ? 'url(#arrow)' : '',
  });

export const point = ([x, y]: Point2): [number, number] => [320 + x * 62, 160 - y * 62];
export const legendAnchors = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ x: 40 + index * (560 / count), y: 24 }));

export function legend(svg: SvgHost, items: LegendItem[]) {
  legendAnchors(items.length).forEach(({ x, y }, index) => {
    add(svg, 'rect', { x, y: y - 10, width: 18, height: 8, rx: 4, fill: items[index].color });
    text(svg, x + 25, y, items[index].label);
  });
}
