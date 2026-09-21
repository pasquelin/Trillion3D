import { add, legend, point, text } from './drawPrimitives.ts';

const line = (svg, from, to, color, width = 4) =>
  add(svg, 'line', {
    x1: from[0],
    y1: from[1],
    x2: to[0],
    y2: to[1],
    stroke: color,
    'stroke-width': width,
    'marker-end': 'url(#arrow)',
  });

const arrow = (svg, vector, color) => line(svg, [320, 160], point(vector), color, 5);

function drawInverse(svg, result, french) {
  const local = point(result.local),
    world = point(result.world),
    recovered = point(result.recovered);
  line(svg, local, world, '#7c3aed');
  line(svg, world, recovered, '#22c55e');
  [local, world, recovered].forEach(([cx, cy], index) =>
    add(svg, 'circle', {
      cx,
      cy,
      r: 8 + index * 2,
      fill: ['#2563eb', '#f97316', '#22c55e'][index],
    }),
  );
  legend(svg, [
    { color: '#2563eb', label: french ? 'départ local' : 'local start' },
    { color: '#f97316', label: french ? 'monde' : 'world' },
    { color: '#22c55e', label: french ? 'retrouvé' : 'recovered' },
  ]);
}

function drawReflection(svg, result, french) {
  const width = Math.max(4, Math.abs(result.scale) * 90),
    x = result.scale < 0 ? 320 - width : 320;
  add(svg, 'rect', {
    x,
    y: 105,
    width,
    height: 110,
    fill: result.scale < 0 ? '#ef444433' : '#22c55e33',
    stroke: result.scale < 0 ? '#ef4444' : '#22c55e',
    'stroke-width': 4,
  });
  text(
    svg,
    320,
    260,
    french ? 'le signe inverse l’orientation' : 'the sign flips orientation',
    'middle',
  );
}

function drawDirections(svg, result, french) {
  if (result.kind === 'quaternion') {
    arrow(svg, [1, 0], '#94a3b8');
    arrow(svg, result.direction, '#7c3aed');
    legend(svg, [
      { color: '#94a3b8', label: french ? 'avant' : 'before' },
      { color: '#7c3aed', label: french ? 'après rotation' : 'after rotation' },
    ]);
    return;
  }
  arrow(svg, result.naive, '#f97316');
  arrow(svg, result.normal, '#06b6d4');
  legend(svg, [
    { color: '#f97316', label: french ? 'transformation naïve' : 'naive transform' },
    { color: '#06b6d4', label: french ? 'normale corrigée' : 'corrected normal' },
  ]);
}

export function drawAdvanced(svg, result, french) {
  if (result.kind === 'inverse') drawInverse(svg, result, french);
  else if (result.kind === 'reflection') drawReflection(svg, result, french);
  else if (result.kind === 'quaternion' || result.kind === 'normal')
    drawDirections(svg, result, french);
  else return false;
  return true;
}
