const NS = 'http://www.w3.org/2000/svg';

export function add(svg, name, attributes) {
  const element = document.createElementNS(NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  svg.append(element);
  return element;
}

export function text(svg, x, y, value, anchor = 'start') {
  const node = add(svg, 'text', {
    x,
    y,
    'text-anchor': anchor,
    fill: 'currentColor',
    'font-size': 13,
    'font-family': 'ui-monospace, monospace',
  });
  node.textContent = value;
}

export const point = ([x, y]) => [320 + x * 62, 160 - y * 62];
export const legendAnchors = (count) =>
  Array.from({ length: count }, (_, index) => ({ x: 40 + index * (560 / count), y: 24 }));

export function legend(svg, items) {
  legendAnchors(items.length).forEach(({ x, y }, index) => {
    add(svg, 'rect', { x, y: y - 10, width: 18, height: 8, rx: 4, fill: items[index].color });
    text(svg, x + 25, y, items[index].label);
  });
}
