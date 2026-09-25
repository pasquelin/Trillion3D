/**
 * The local bounds of a geometry, as the reference spans them: every vertex and every shape a
 * morph target gives it. A position that owns its list and has no morph target is read as its
 * stored numbers, `itemSize` apart, as `drawnTriangles` draws it; any other (interleaved, or
 * morphed) through `getComponent`, at the value it stands for.
 */
import { boxEmpty, boxExpandByPoint } from '../../math/primitives/box.ts';
import type { VertexAttribute } from '../buffer/attribute.ts';
import { Box3 } from '../math/box3.ts';
import { Vector3 } from '../math/vector3.ts';
import type { Sphere } from '../math/volumes.ts';

/** What the bounds read of a geometry: its positions and the morph targets that move them. */
type Morphed = {
  readonly attributes: Readonly<Record<string, VertexAttribute | undefined>>;
  readonly morphAttributes: Readonly<Record<string, readonly VertexAttribute[] | undefined>>;
  readonly morphTargetsRelative: boolean;
};

/** Scratch of the bounds below: the whole box, one target's, one corner, the sphere's box and
 *  centre. */
const whole = new Float64Array(6),
  morph = new Float64Array(6),
  sum = new Float64Array(3),
  scratchBox = new Box3(),
  centre = new Vector3();

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

/** The position when it owns its list and no morph target moves it: read as stored. */
function stored({ attributes, morphAttributes }: Morphed) {
  const position = attributes.position;
  return position?.kind === 'attribute' && !morphAttributes.position?.length ? position : null;
}

/** Writes the box over every vertex and morphed shape into `box`; empty with no position. */
export function spanBox(box: Box3, morphed: Morphed) {
  const plain = stored(morphed);
  if (plain) return box.setFromArray(plain.array, plain.itemSize);
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
    plain = stored(morphed);
  if (!position) return sphere;
  const { x: cx, y: cy, z: cz } = spanBox(scratchBox, morphed).getCenter(centre);
  let far = 0;
  const reach = (x: number, y: number, z: number) => {
    const dx = cx - x,
      dy = cy - y,
      dz = cz - z;
    far = Math.max(far, dx * dx + dy * dy + dz * dz);
  };
  if (plain)
    for (let i = 0, a = plain.array; i + 2 < a.length; i += plain.itemSize)
      reach(a[i], a[i + 1], a[i + 2]);
  else {
    for (let i = 0; i < position.count; i++)
      reach(position.getX(i), position.getY(i), position.getZ(i));
    const relative = morphed.morphTargetsRelative;
    for (const target of morphed.morphAttributes.position ?? [])
      for (let j = 0; j < target.count; j++) {
        let x = target.getX(j),
          y = target.getY(j),
          z = target.getZ(j);
        if (relative) {
          x += position.getX(j);
          y += position.getY(j);
          z += position.getZ(j);
        }
        reach(x, y, z);
      }
  }
  sphere.center.set(cx, cy, cz);
  sphere.radius = Math.sqrt(far);
  return sphere;
}

/** The positions as a list of numbers: the stored array itself when the attribute owns it, as the
 *  world's geometry has always been drawn; an interleaved one copied vertex by vertex, three per
 *  vertex; none without an attribute. */
export function readPoints(attribute: VertexAttribute | undefined): ArrayLike<number> {
  if (!attribute) return [];
  if (attribute.kind === 'attribute') return attribute.array;
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++)
    for (let c = 0; c < Math.min(3, attribute.itemSize); c++)
      out[i * 3 + c] = attribute.getComponent(i, c);
  return out;
}
