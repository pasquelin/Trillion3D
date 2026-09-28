/** A geometry's vertices moved by a matrix: what `Geometry.applyMatrix4` writes in place. */
import type { Matrix4 } from '../math/matrix4.ts';
import type { Geometry } from './geometry.ts';
import { plainPoints, positionAt, readComponent, readsStored } from './bounds.ts';
import { Vector3 } from '../math/vector3.ts';
import { transformPointsBatch } from '../../math/batch/points.ts';
import { normalMatrix3 } from '../../math/matrix/matrix3.ts';
import { applyMatrix3Vector3, normalizeVector3 } from '../../math/primitives/vector.ts';

/** Moves every position of `geometry` by `m` and turns every normal by its normal matrix, in
 *  place. A position is moved at its value (`positionAt`): a list of plain numbers three at a
 *  time, any other vertex by vertex, written back as wide and as normalised as it is. A normal is read
 *  and written as its stored numbers where the geometry reads it so (`readsStored`), else at the
 *  value it stands for, written normalised. */
export function transformVertices(geometry: Pick<Geometry, 'attributes' | '_owner'>, m: Matrix4) {
  const { position, normal } = geometry.attributes;
  const plain = plainPoints(position);
  if (plain) {
    const points = plain.array as Float32Array;
    transformPointsBatch(points, m.elements, points, plain.count);
  } else if (position) {
    const v = new Vector3();
    for (let i = 0; i < position.count; i++) {
      v.set(positionAt(position, i, 0), positionAt(position, i, 1), positionAt(position, i, 2));
      const moved = v.applyMatrix4(m).toArray();
      for (let c = 0; c < Math.min(3, position.itemSize); c++)
        position.setComponent(i, c, moved[c]);
    }
  }
  if (normal) {
    const n = normalMatrix3(new Float64Array(9), m.elements),
      v = new Float64Array(3),
      stored = readsStored(geometry, normal),
      read = (i: number, c: number) => readComponent(geometry, normal, i, c);
    for (let i = 0; i < normal.count; i++) {
      applyMatrix3Vector3(v, n, read(i, 0), read(i, 1), read(i, 2));
      normalizeVector3(v);
      if (stored) for (let c = 0; c < 3; c++) normal.array[i * normal.itemSize + c] = v[c];
      else normal.setXYZ(i, v[0], v[1], v[2]);
    }
  }
}
