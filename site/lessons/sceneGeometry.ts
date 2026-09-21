import { advancedGeometry } from './sceneGeometryAdvanced.ts';
import { arrow, beam, box, frameBox, sphere, vertices, COLORS } from './sceneGeometryPrimitives.ts';
import type { EvaluationResult } from './evaluate.ts';

export function geometryFor(id: string, result: EvaluationResult): Float32Array<ArrayBuffer> {
  vertices.length = 0;
  if (
    result.kind === 'inverse' ||
    result.kind === 'reflection' ||
    result.kind === 'quaternion' ||
    result.kind === 'normal'
  ) {
    advancedGeometry(result, { arrow, beam, box, COLORS });
    return new Float32Array(vertices);
  }
  if (result.kind === 'transform') {
    box([0, 0, 0], [2, 1.4, 0.18], COLORS.grey);
    const p = result.points;
    p.forEach((point, index) =>
      beam(
        [point[0], point[1], 0.35],
        [p[(index + 1) % p.length][0], p[(index + 1) % p.length][1], 0.35],
        0.07,
        COLORS.violet,
      ),
    );
  } else if (result.kind === 'chain' || result.kind === 'hierarchy') {
    beam([0, 0, 0], result.point, 0.07, COLORS.violet);
    box([0, 0, 0], [0.35, 0.35, 0.35], COLORS.blue);
    box(result.point, [0.45, 0.45, 0.45], COLORS.orange);
  } else if (result.kind === 'perspective') {
    const half = Math.tan((result.fov * Math.PI) / 360) * 2,
      offset = result.depth / 2;
    const projected = [result.ndc[0] * half * 1.6, result.ndc[1] * half, offset - 2];
    frameBox([-half * 1.6, -half, offset - 2.02], [half * 1.6, half, offset - 1.98], COLORS.grey);
    beam([0, 0, offset], [1, 1, -offset], 0.025, COLORS.cyan);
    box(projected, [0.22, 0.22, 0.12], COLORS.orange);
  } else if (result.kind === 'frustum') {
    const depth = result.depth,
      h = Math.tan((result.fov * Math.PI) / 360) * depth,
      w = h * 1.6;
    [
      [-w, -h],
      [w, -h],
      [-w, h],
      [w, h],
    ].forEach(([x, y]) => beam([0, 0, depth / 2], [x, y, -depth / 2], 0.025, COLORS.cyan));
    box(
      [result.x, 0, -depth / 2],
      [1.2, 1.2, 1.2],
      [COLORS.red, COLORS.orange, COLORS.green][result.status],
    );
  } else if (result.kind === 'vectors') {
    arrow(result.a, COLORS.blue);
    arrow(result.b, COLORS.orange);
    if ('cross' in result) arrow([0, 0, result.cross], COLORS.green);
  } else if (result.kind === 'normalize') {
    arrow(result.before, COLORS.grey, 0.65);
    arrow(result.after, COLORS.violet, 0.65);
  } else if (result.kind === 'bounds') {
    result.points.forEach(([x, y]) => box([x, y, 0], [0.18, 0.18, 0.18], COLORS.orange));
    frameBox(result.box.slice(0, 3), result.box.slice(3), COLORS.violet);
  } else if (result.kind === 'sphere') {
    frameBox(result.box.slice(0, 3), result.box.slice(3), COLORS.violet);
    sphere(result.sphere.slice(0, 3), result.sphere[3], COLORS.cyan);
  } else if (result.kind === 'colour') {
    [result.a, result.screen, result.light, result.b].forEach((v, i) =>
      box([(i - 1.5) * 1.1, 0, 0], [0.85, 0.85, 0.85], [v, v, v]),
    );
  } else {
    for (let i = 0; i < 10; i++) box([(i - 4.5) * 0.48, 0, 0], [0.3, 0.3, 0.3], COLORS.grey);
    const marker = Math.max(-2.16, Math.min(2.16, (result.error / 8) * 4.32 - 2.16));
    beam([marker, -0.7, 0], [marker, 0.7, 0], 0.05, COLORS.orange);
  }
  return new Float32Array(vertices);
}
