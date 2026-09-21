import type { EvaluationResult } from './evaluate.ts';
import type { GeometryTools } from './sceneGeometryPrimitives.ts';

export function advancedGeometry(
  result: EvaluationResult,
  { arrow, beam, box, COLORS }: GeometryTools,
) {
  if (result.kind === 'inverse') {
    box(result.local, [0.35, 0.35, 0.35], COLORS.blue);
    box(result.world, [0.45, 0.45, 0.45], COLORS.orange);
    beam(result.local, result.world, 0.05, COLORS.cyan);
    beam(result.world, result.recovered, 0.025, COLORS.green);
    return;
  }
  if (result.kind === 'reflection') {
    box(
      [0, 0, 0],
      [Math.max(0.08, Math.abs(result.scale) * 2), 1.5, 0.6],
      result.determinant < 0 ? COLORS.red : result.determinant > 0 ? COLORS.green : COLORS.grey,
    );
    arrow([Math.sign(result.scale) || 0, 0, 0], COLORS.orange, 1.4);
    arrow([0, 1, 0], COLORS.blue, 1.4);
    return;
  }
  if (result.kind === 'quaternion') {
    arrow([1, 0, 0], COLORS.grey, 1.7);
    arrow(result.direction, COLORS.violet, 2.2);
    box([0, 0, 0], [0.35, 0.35, 0.35], COLORS.blue);
    return;
  }
  if (result.kind !== 'normal') return;
  box([0, 0, 0], [2.2, 1.1, 0.18], COLORS.grey);
  arrow(result.naive, COLORS.red, 1.7);
  arrow(result.normal, COLORS.green, 2.2);
}
