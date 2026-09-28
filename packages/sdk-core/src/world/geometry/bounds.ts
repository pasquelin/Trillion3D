/**
 * The local bounds of a geometry, as the reference spans them: every vertex and every shape a
 * morph target gives it. A position is read at the value it stands for, as `drawnTriangles` draws
 * it (`positionAt`): straight from its list when it owns three plain numbers a vertex and no morph
 * target moves it, else vertex by vertex.
 */
import { boxEmpty, boxExpandByPoint } from '../../math/primitives/box.ts';
import type { VertexAttribute } from '../buffer/attribute.ts';
import type { Geometry } from './geometry.ts';
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

/** Number `component` of position `index` at the value it stands for, a normalised integer
 *  scaled back; a position two numbers wide lies in the plane z = 0. */
export const positionAt = (attribute: VertexAttribute, index: number, component: number) =>
  component < attribute.itemSize ? attribute.getComponent(index, component) : 0;

/** The position list itself when its stored numbers are its values: owned, three a vertex, not
 *  normalised; `null` for any other. */
export const plainPoints = (attribute: VertexAttribute | undefined) =>
  attribute?.kind === 'attribute' && attribute.itemSize === 3 && !attribute.normalized
    ? attribute
    : null;

/** The box of an attribute's vertices, written into `into` (six numbers). */
function spanInto(into: Float64Array, attribute: VertexAttribute) {
  boxEmpty(into, 0);
  for (let i = 0; i < attribute.count; i++)
    boxExpandByPoint(
      into,
      0,
      positionAt(attribute, i, 0),
      positionAt(attribute, i, 1),
      positionAt(attribute, i, 2),
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

/** The position read straight from its list (`plainPoints`) when no morph target moves it. */
const stored = ({ attributes, morphAttributes }: Morphed) =>
  morphAttributes.position?.length ? null : plainPoints(attributes.position);

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
    const at = (a: VertexAttribute, i: number) =>
      [0, 1, 2].map((c) => positionAt(a, i, c)) as [number, number, number];
    for (let i = 0; i < position.count; i++) reach(...at(position, i));
    const relative = morphed.morphTargetsRelative;
    for (const target of morphed.morphAttributes.position ?? [])
      for (let j = 0; j < target.count; j++) {
        const moved = at(target, j);
        if (relative) for (let c = 0; c < 3; c++) moved[c] += positionAt(position, j, c);
        reach(...moved);
      }
  }
  sphere.center.set(cx, cy, cz);
  sphere.radius = Math.sqrt(far);
  return sphere;
}

/** Whether `geometry` reads `attribute` as its stored numbers, a normalised integer unscaled: a
 *  list a world geometry owns, as the world has always drawn, edged and turned it. A host
 *  geometry's lists are read at the value they stand for, as the host always read them, and so
 *  is a view of an interleaved buffer. Not asked for a position, which every owner reads at its
 *  value (`positionAt`). */
export const readsStored = (geometry: Pick<Geometry, '_owner'>, attribute: VertexAttribute) =>
  geometry._owner === 'world' && attribute.kind === 'attribute';

/** Number `component` of vertex `index` of `attribute` as `geometry` reads it (`readsStored`). */
export const readComponent = (
  geometry: Pick<Geometry, '_owner'>,
  attribute: VertexAttribute,
  index: number,
  component: number,
) =>
  readsStored(geometry, attribute)
    ? attribute.stored(index, component)
    : attribute.getComponent(index, component);

/** The positions as a list of numbers, three a vertex, at their values: the list itself when its
 *  numbers are (`plainPoints`), else a copy read vertex by vertex (`positionAt`); none without an
 *  attribute. */
export function readPoints(attribute: VertexAttribute | undefined): ArrayLike<number> {
  if (!attribute) return [];
  const plain = plainPoints(attribute);
  if (plain) return plain.array;
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++)
    for (let c = 0; c < 3; c++) out[i * 3 + c] = positionAt(attribute, i, c);
  return out;
}
