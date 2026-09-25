/** A geometry's vertices moved by a matrix: what `Geometry.applyMatrix4` writes in place. */
import type { VertexAttribute } from '../buffer/attribute.ts';
import type { Matrix4 } from '../math/matrix4.ts';
import { Vector3 } from '../math/vector3.ts';
import { transformPointsBatch } from '../../math/batch/points.ts';
import { normalMatrix3 } from '../../math/matrix/matrix3.ts';
import { applyMatrix3Vector3, normalizeVector3 } from '../../math/primitives/vector.ts';
import { readComponent } from './bounds.ts';

/** Moves every position by `m` and turns every normal by its normal matrix, in place. A position
 *  or a normal that owns its list is read and written as its stored numbers, as the world's
 *  geometry always was; an interleaved one at the value it stands for, vertex by vertex. */
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
    const read = (i: number, c: number) => readComponent(normal, i, c);
    for (let i = 0; i < normal.count; i++) {
      applyMatrix3Vector3(v, n, read(i, 0), read(i, 1), read(i, 2));
      normalizeVector3(v);
      if (normal.kind === 'attribute')
        for (let c = 0; c < 3; c++) normal.array[i * normal.itemSize + c] = v[c];
      else normal.setXYZ(i, v[0], v[1], v[2]);
    }
  }
}
