import { drawBounds, drawBudget, drawColour } from './drawDetails.ts';
import { drawAdvanced } from './drawAdvanced.ts';
import { drawVectors } from './drawVectors.ts';
import { add, legend, line, point, text } from './drawPrimitives.ts';
export { legendAnchors } from './drawPrimitives.ts';
import type { Locale } from '../content/locale.ts';
import type {
  EvaluationResult,
  TransformResult,
  ChainResult,
  PerspectiveResult,
  FrustumResult,
} from './evaluate.ts';
import type { HierarchyResult } from './evaluateDetail.ts';

const NS = 'http://www.w3.org/2000/svg';
const make = (name: string, attributes: Record<string, string | number> = {}) => {
  const element = document.createElementNS(NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
};

function base(svg: SVGSVGElement) {
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

function polygon(svg: SVGSVGElement, points: number[][], color: string) {
  add(svg, 'polygon', {
    points: points.map((p) => point(p).join(',')).join(' '),
    fill: `${color}22`,
    stroke: color,
    'stroke-width': 4,
  });
}

function drawTransform(
  svg: SVGSVGElement,
  result: TransformResult | ChainResult | HierarchyResult,
  french: boolean,
) {
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

function drawCamera(
  svg: SVGSVGElement,
  result: PerspectiveResult | FrustumResult,
  french: boolean,
) {
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

export function draw(svg: SVGSVGElement, result: EvaluationResult, locale: Locale = 'en') {
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
