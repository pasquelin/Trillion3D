/** A geometry's vertices moved by a matrix: what `Geometry.applyMatrix4` writes in place. */
import type { VertexAttribute } from '../buffer/attribute.ts';
import type { Matrix4 } from '../math/matrix4.ts';
import { Vector3 } from '../math/vector3.ts';
import { transformPointsBatch } from '../../math/batch/points.ts';
import { normalMatrix3 } from '../../math/matrix/matrix3.ts';
import { applyMatrix3Vector3, normalizeVector3 } from '../../math/primitives/vector.ts';

/** Moves every position by `m` and turns every normal by its normal matrix, in place. A position
 *  that owns its list is moved as its stored numbers, three at a time, as the world's geometry
 *  always was; an interleaved one is read and written vertex by vertex. */
export function transformVertices(attributes: Record<string, VertexAttribute>, m: Matrix4) {
  const position = attributes.position,
    normal = attributes.normal;
  if (position?.kind === 'attribute') {
    const points = position.array as Float32Array;
    transformPointsBatch(points, m.elements, points, position.count);
  } else if (position) {
    const v = new Vector3();
    for (let i = 0; i < position.count; i++) {
      v.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(m);
      position.setXYZ(i, v.x, v.y, v.z);
    }
  }
  if (normal) {
    const n = normalMatrix3(new Float64Array(9), m.elements),
      v = new Float64Array(3);
    for (let i = 0; i < normal.count; i++) {
      applyMatrix3Vector3(v, n, normal.getX(i), normal.getY(i), normal.getZ(i));
      normalizeVector3(v);
      normal.setXYZ(i, v[0], v[1], v[2]);
    }
  }
}
