import { add, legend, point, text } from './drawPrimitives.ts';
import type { BoundsResult, ColourResult, BudgetResult, SphereResult } from './evaluateDetail.ts';

export function drawBounds(
  svg: SVGSVGElement,
  result: BoundsResult | SphereResult,
  french: boolean,
) {
  const box = result.box,
    a = point([box[0], box[1]]),
    b = point([box[3], box[4]]);
  add(svg, 'rect', {
    x: a[0],
    y: b[1],
    width: b[0] - a[0],
    height: a[1] - b[1],
    fill: '#7c3aed22',
    stroke: '#7c3aed',
    'stroke-width': 4,
  });
  if ('points' in result)
    result.points.forEach((p, index) => {
      const [x, y] = point(p);
      add(svg, 'circle', { cx: x, cy: y, r: 7, fill: '#f97316' });
      text(svg, x + 10, y - 8, String(index + 1));
    });
  if ('sphere' in result)
    add(svg, 'circle', {
      cx: 320,
      cy: 160,
      r: result.sphere[3] * 62,
      fill: 'none',
      stroke: '#06b6d4',
      'stroke-width': 4,
      'stroke-dasharray': '9 6',
    });
  const items = [{ color: '#7c3aed', label: french ? 'volume' : 'bounds' }];
  if ('points' in result) items.push({ color: '#f97316', label: 'points' });
  if ('sphere' in result) items.push({ color: '#06b6d4', label: french ? 'sphère' : 'sphere' });
  legend(svg, items);
}

export function drawColour(svg: SVGSVGElement, result: ColourResult, french: boolean) {
  const swatches: [string, number][] = [
    [french ? 'gauche' : 'left', result.a],
    [french ? 'moyenne écran' : 'screen average', result.screen],
    [french ? 'moyenne lumière' : 'light average', result.light],
    [french ? 'droite' : 'right', result.b],
  ];
  swatches.forEach(([label, value], index) => {
    const x = 42 + index * 148,
      channel = Math.round(value * 255);
    add(svg, 'rect', {
      x,
      y: 80,
      width: 116,
      height: 116,
      rx: 14,
      fill: `rgb(${channel} ${channel} ${channel})`,
      stroke: '#64748b',
    });
    text(svg, x + 58, 225, label, 'middle');
    text(svg, x + 58, 248, channel, 'middle');
  });
}

export function drawBudget(svg: SVGSVGElement, result: BudgetResult, french: boolean) {
  const scale = 410 / Math.max(result.error, result.base, 1);
  const rows: [string, number, string, number][] = [
    [french ? 'demandée' : 'requested', result.base, '#2563eb', 95],
    [french ? 'gouvernée' : 'governed', result.error, '#f97316', 190],
  ];
  rows.forEach(([label, value, color, y]) => {
    text(svg, 55, y + 7, label);
    add(svg, 'rect', { x: 150, y: y - 18, width: value * scale, height: 36, rx: 8, fill: color });
    text(svg, 160 + value * scale, y + 7, `${value.toFixed(2)} px`);
  });
  text(
    svg,
    320,
    275,
    french ? 'plus d’erreur → moins de clusters' : 'more error → fewer clusters',
    'middle',
  );
}
