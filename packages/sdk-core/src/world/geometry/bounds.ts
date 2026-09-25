/**
 * The local bounds of a geometry, as the reference spans them: every vertex, read as the number it
 * stands for (a normalised position at its scale, an interleaved one through its stride), and
 * every shape a morph target gives it.
 */
import { boxEmpty, boxExpandByPoint, boxIsEmpty } from '../../math/primitives/box.ts';
import type { VertexAttribute } from '../buffer/attribute.ts';
import type { Box3 } from '../math/box3.ts';
import type { Sphere } from '../math/volumes.ts';

/** What the bounds read of a geometry: its positions and the morph targets that move them. */
type Morphed = {
  readonly attributes: Readonly<Record<string, VertexAttribute | undefined>>;
  readonly morphAttributes: Readonly<Record<string, readonly VertexAttribute[] | undefined>>;
  readonly morphTargetsRelative: boolean;
};

/** Scratch of the bounds below: the whole box, one target's, one corner. */
const whole = new Float64Array(6),
  morph = new Float64Array(6),
  sum = new Float64Array(3);

/** The box of an attribute's vertices, written into `into` (six numbers). */
function spanInto(into: Float64Array, attribute: VertexAttribute) {
  boxEmpty(into, 0);
  for (let i = 0; i < attribute.count; i++)
    boxExpandByPoint(
      into,
      0,
      attribute.getComponent(i, 0),
      attribute.getComponent(i, 1),
      attribute.getComponent(i, 2),
    );
}

/** Grows the box `into` by `point` (three numbers at `at`). */
const grow = (into: Float64Array, point: ArrayLike<number>, at: number) =>
  boxExpandByPoint(into, 0, point[at], point[at + 1], point[at + 2]);

/** The box of the positions and of every shape a morph target gives them, into `whole`; false
 *  with no position. */
function span({ attributes, morphAttributes, morphTargetsRelative: relative }: Morphed) {
  const position = attributes.position;
  if (!position) return false;
  spanInto(whole, position);
  for (const target of morphAttributes.position ?? []) {
    spanInto(morph, target);
    if (relative) {
      for (let c = 0; c < 3; c++) sum[c] = whole[c] + morph[c];
      grow(whole, sum, 0);
      for (let c = 0; c < 3; c++) sum[c] = whole[3 + c] + morph[3 + c];
      grow(whole, sum, 0);
    } else {
      grow(whole, morph, 0);
      grow(whole, morph, 3);
    }
  }
  return true;
}

/** Writes the box over every vertex and morphed shape into `box`; empty with no position. */
export function spanBox(box: Box3, morphed: Morphed) {
  if (!span(morphed)) return box.makeEmpty();
  return box.set(
    { x: whole[0], y: whole[1], z: whole[2] },
    { x: whole[3], y: whole[4], z: whole[5] },
  );
}

/** Writes the sphere centred on the box and reaching the farthest vertex or morphed vertex into
 *  `sphere`; left as it is with no position. */
export function spanSphere(sphere: Sphere, morphed: Morphed) {
  const position = morphed.attributes.position,
    relative = morphed.morphTargetsRelative;
  if (!position || !span(morphed)) return sphere;
  const empty = boxIsEmpty(whole, 0);
  const cx = empty ? 0 : (whole[0] + whole[3]) * 0.5,
    cy = empty ? 0 : (whole[1] + whole[4]) * 0.5,
    cz = empty ? 0 : (whole[2] + whole[5]) * 0.5;
  let far = 0;
  const reach = (x: number, y: number, z: number) => {
    const dx = cx - x,
      dy = cy - y,
      dz = cz - z;
    far = Math.max(far, dx * dx + dy * dy + dz * dz);
  };
  for (let i = 0; i < position.count; i++)
    reach(position.getX(i), position.getY(i), position.getZ(i));
  for (const target of morphed.morphAttributes.position ?? [])
    for (let j = 0; j < target.count; j++) {
      let [x, y, z] = [target.getX(j), target.getY(j), target.getZ(j)];
      if (relative) {
        x += position.getX(j);
        y += position.getY(j);
        z += position.getZ(j);
      }
      reach(x, y, z);
    }
  sphere.center.set(cx, cy, cz);
  sphere.radius = Math.sqrt(far);
  return sphere;
}

/** The positions as the numbers they stand for, three per vertex: the stored array itself when it
 *  already is that, a copy read vertex by vertex when it is normalised, interleaved or not 3 wide. */
export function readPoints(attribute: VertexAttribute): ArrayLike<number> {
  if (attribute.kind === 'attribute' && !attribute.normalized && attribute.itemSize === 3)
    return attribute.array;
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++)
    for (let c = 0; c < Math.min(3, attribute.itemSize); c++)
      out[i * 3 + c] = attribute.getComponent(i, c);
  return out;
}
