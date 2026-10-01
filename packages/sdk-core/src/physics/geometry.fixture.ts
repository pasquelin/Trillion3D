// The geometries the physics tests build by hand: positions alone, indexed or not.
import { BufferAttribute } from '../world/buffer/attribute.ts';
import { Geometry } from '../world/geometry/geometry.ts';

/** A geometry of `values`, three per vertex, indexed by `index` when given. */
export function positions(values: number[], index?: number[]) {
  const value = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array(values), 3),
  );
  if (index) value.setIndex(index);
  return value;
}
