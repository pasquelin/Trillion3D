import { drawBounds, drawBudget, drawColour } from './drawDetails.js';
import { drawAdvanced } from './drawAdvanced.js';
import { add, legend, point, text } from './drawPrimitives.js';
export { legendAnchors } from './drawPrimitives.js';

const NS = 'http://www.w3.org/2000/svg';
const make = (name, attributes = {}) => {
  const element = document.createElementNS(NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
};
const line = (svg, x1, y1, x2, y2, color, width = 3, dash = '') =>
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

function base(svg) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', '0 0 640 320');
  const defs = make('defs');
  const marker = make('marker', {
    id: 'arrow',
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: 'auto-start-reverse',
  });
  marker.append(make('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' }));
  defs.append(marker);
  svg.append(defs);
  line(svg, 40, 160, 600, 160, '#94a3b8', 1);
  line(svg, 320, 25, 320, 295, '#94a3b8', 1);
}

function polygon(svg, points, color) {
  add(svg, 'polygon', {
    points: points.map((p) => point(p).join(',')).join(' '),
    fill: `${color}22`,
    stroke: color,
    'stroke-width': 4,
  });
}

function drawTransform(svg, result, french) {
  if (result.kind === 'transform') {
    polygon(
      svg,
      [
        [-1, -0.7],
        [1, -0.7],
        [1, 0.7],
        [-1, 0.7],
      ],
      '#94a3b8',
    );
    polygon(svg, result.points, '#7c3aed');
    legend(svg, [
      { color: '#94a3b8', label: 'local' },
      { color: '#7c3aed', label: french ? 'monde' : 'world' },
    ]);
  } else {
    const [x, y] = point(result.point);
    line(svg, 320, 160, x, y, '#7c3aed', 5);
    add(svg, 'circle', { cx: x, cy: y, r: 13, fill: '#f59e0b' });
    legend(svg, [
      { color: '#7c3aed', label: french ? 'lien parent' : 'parent link' },
      { color: '#f59e0b', label: french ? 'enfant' : 'child' },
    ]);
  }
}

function drawCamera(svg, result, french) {
  if (result.kind === 'perspective') {
    const size = 120 / result.depth;
    add(svg, 'rect', {
      x: 320 - size,
      y: 160 - size,
      width: size * 2,
      height: size * 2,
      fill: '#06b6d433',
      stroke: '#0891b2',
      'stroke-width': 4,
    });
    text(svg, 320, 300, french ? 'plus loin → plus petit' : 'farther → smaller', 'middle');
    line(svg, 120, 70, 320 - size, 160 - size, '#94a3b8', 2, '7 7');
    line(svg, 120, 250, 320 - size, 160 + size, '#94a3b8', 2, '7 7');
  } else {
    const half = Math.tan((result.fov * Math.PI) / 360) * 48;
    add(svg, 'polygon', {
      points: `320,285 ${320 - half * 4},65 ${320 + half * 4},65`,
      fill: '#06b6d41c',
      stroke: '#0891b2',
      'stroke-width': 3,
    });
    const x = 320 + result.x * 38,
      y = 285 - result.depth * 25;
    const colors = ['#ef4444', '#f59e0b', '#22c55e'];
    add(svg, 'rect', {
      x: x - 18,
      y: y - 18,
      width: 36,
      height: 36,
      fill: `${colors[result.status]}44`,
      stroke: colors[result.status],
      'stroke-width': 4,
    });
    const states = french ? ['dehors', 'intersecté', 'dedans'] : ['outside', 'crossing', 'inside'];
    legend(svg, [{ color: colors[result.status], label: states[result.status] }]);
  }
}

function drawVectors(svg, result, french) {
  if (result.kind === 'normalize') {
    const vectors = [
      [result.before, '#94a3b8', french ? 'avant' : 'before'],
      [result.after, '#7c3aed', french ? 'direction unité' : 'unit direction'],
    ];
    vectors.forEach(([v, color]) => {
      line(svg, 320, 160, 320 + v[0] * 42, 160 - v[1] * 42, color, 5);
    });
    legend(
      svg,
      vectors.map(([, color, label]) => ({ color, label })),
    );
    return;
  }
  [
    [result.a, '#2563eb', 'a'],
    [result.b, '#f97316', 'b'],
  ].forEach(([v, color]) => {
    line(svg, 320, 160, 320 + v[0] * 105, 160 - v[1] * 105, color, 5);
  });
  legend(svg, [
    { color: '#2563eb', label: 'a' },
    { color: '#f97316', label: 'b' },
  ]);
  if ('cross' in result) {
    add(svg, 'circle', {
      cx: 320,
      cy: 160,
      r: 34,
      fill: 'none',
      stroke: result.cross >= 0 ? '#22c55e' : '#ef4444',
      'stroke-width': 5,
      'stroke-dasharray': '8 5',
    });
    const turn =
      result.cross >= 0
        ? french
          ? 'antihoraire ↺'
          : 'counter-clockwise ↺'
        : french
          ? 'horaire ↻'
          : 'clockwise ↻';
    text(svg, 320, 215, turn, 'middle');
  } else {
    const width = Math.max(2, Math.abs(result.dot) * 18);
    line(svg, 90, 275, 550, 275, '#cbd5e1', 10);
    line(
      svg,
      320,
      275,
      320 + result.dot * 210,
      275,
      result.dot >= 0 ? '#22c55e' : '#ef4444',
      width,
    );
    text(svg, 90, 300, french ? '−1 opposés' : '−1 opposed');
    text(svg, 550, 300, french ? '+1 alignés' : '+1 aligned', 'end');
  }
}

export function draw(svg, result, locale = 'en') {
  base(svg);
  const french = String(locale).toLowerCase().startsWith('fr');
  if (drawAdvanced(svg, result, french)) return;
  if (result.kind === 'transform' || result.kind === 'chain' || result.kind === 'hierarchy')
    drawTransform(svg, result, french);
  else if (result.kind === 'perspective' || result.kind === 'frustum')
    drawCamera(svg, result, french);
  else if (result.kind === 'vectors' || result.kind === 'normalize')
    drawVectors(svg, result, french);
  else if (result.kind === 'bounds' || result.kind === 'sphere') drawBounds(svg, result, french);
  else if (result.kind === 'colour') drawColour(svg, result, french);
  else drawBudget(svg, result, french);
}
