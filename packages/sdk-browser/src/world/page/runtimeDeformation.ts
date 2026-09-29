import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';

/** The compiler's conservative rest balls and target radii, measured once for page-authored data. */
export function runtimeDeformation(drawn: DrawnTriangles) {
  const source = drawn.deformation;
  if (!source) return undefined;
  const boxes: number[][] = [];
  if (source.joints && source.weights)
    for (let v = 0; v < drawn.positions.length / 3; v++)
      for (let influence = 0; influence < 4; influence++) {
        const at = v * 4 + influence;
        if (source.weights[at] <= 0) continue;
        const joint = source.joints[at];
        if (!Number.isInteger(joint) || joint < 0 || joint > 65535)
          throw new RangeError('Invalid skin joint');
        const box = (boxes[joint] ??= [
          Infinity,
          Infinity,
          Infinity,
          -Infinity,
          -Infinity,
          -Infinity,
        ]);
        for (let c = 0; c < 3; c++) {
          box[c] = Math.min(box[c], drawn.positions[v * 3 + c]);
          box[c + 3] = Math.max(box[c + 3], drawn.positions[v * 3 + c]);
        }
      }
  const joints: number[] = [];
  for (let joint = 0; joint < boxes.length; joint++) {
    const box = boxes[joint];
    if (!box) {
      joints.push(0, 0, 0, 0);
      continue;
    }
    const center = [0, 1, 2].map((c) => (box[c] + box[c + 3]) / 2);
    joints.push(...center, Math.hypot(...center.map((x, c) => box[c + 3] - x)));
  }
  const targets = source.targets.map(({ positions }) => {
    let radius = 0;
    for (let v = 0; v < positions.length; v += 3)
      radius = Math.max(radius, Math.hypot(positions[v], positions[v + 1], positions[v + 2]));
    return radius;
  });
  return { joints, targets };
}
