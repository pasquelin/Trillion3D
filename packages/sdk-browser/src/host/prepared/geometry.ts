/**
 * The host geometries of the prepared scene, viewed on the binary the cache published beside its
 * document through the layout the scene tables carry (`TableDocument`): no glTF is parsed, and no
 * value is decoded that the compiler has not already laid out.
 *
 * Every rule below is the one the host loader applied when it built the same scene, because the
 * scene the engine draws is proven by being the same scene: an attribute is viewed, not copied,
 * inside a copy of its view; a run shared by two primitives is one host attribute; two primitives
 * naming the same runs are one host geometry; an interleaved view is one host buffer per slice;
 * and the local box is the one the positions declare, not one recomputed from them.
 */
import type {
  TableDocument,
  TablePrimitive,
} from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
import { Sphere } from '../../../../sdk-core/src/world/math/volumes.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { GraphGeometry } from '../graph/geometry.ts';
import { type GraphAttribute } from '../graph/attributes.ts';
import { normalisedScale, preparedAccessors } from './accessors.ts';

/** The host's attribute names for the glTF semantics it knows; any other is lower-cased. */
const NAMES: Record<string, string> = {
  POSITION: 'position',
  NORMAL: 'normal',
  TANGENT: 'tangent',
  TEXCOORD_0: 'uv',
  TEXCOORD_1: 'uv1',
  TEXCOORD_2: 'uv2',
  TEXCOORD_3: 'uv3',
  COLOR_0: 'color',
  WEIGHTS_0: 'skinWeight',
  JOINTS_0: 'skinIndex',
};
/** A set of runs as the loader keys it: semantics in order, each with its accessor rank. */
const runs = (set: Readonly<Record<string, number>>) =>
  Object.keys(set)
    .sort()
    .map((semantic) => `${semantic}:${set[semantic]};`)
    .join('');

/** The morph targets of a primitive, laid on its geometry as the loader lays them: one list per
 *  morphed attribute, the base attribute standing in for a target that leaves it alone. */
function morph(
  geometry: GraphGeometry,
  declared: TablePrimitive,
  attributeOf: ReturnType<typeof preparedAccessors>,
) {
  const targets = declared.targets ?? [];
  for (const [semantic, name] of MORPHED) {
    if (!targets.some((target) => target[semantic] !== undefined)) continue;
    geometry.morphAttributes[name] = targets.map((target) =>
      target[semantic] !== undefined ? attributeOf(target[semantic]) : geometry.attributes[name],
    );
  }
  if (Object.keys(geometry.morphAttributes).length) geometry.morphTargetsRelative = true;
}

/** The attributes a morph target may move, by glTF semantic and host name. */
const MORPHED = [
  ['POSITION', 'position'],
  ['NORMAL', 'normal'],
  ['COLOR_0', 'color'],
] as const;

/**
 * The geometry of each primitive of `document`, built on first request and shared after it.
 * `binary` is the document's buffer; `null` only for a document that lays out no view.
 */
export function preparedGeometries(document: TableDocument, binary: ArrayBuffer | null) {
  const attributeOf = preparedAccessors(document, binary);
  const geometries = new Map<string, GraphGeometry>();

  /** A run's declared corner, at the scale a normalised run is read at. */
  const corner = (rank: number, which: 'min' | 'max') => {
    const accessor = document.accessors[rank];
    const scale = accessor.normalized ? normalisedScale(accessor.componentType) : 1;
    const at = accessor[which];
    return at && [at[0] * scale, at[1] * scale, at[2] * scale];
  };

  /** The box the positions declare, grown by the largest displacement a morph target declares
   *  (the loader's rule: not conservative, but the size of the shapes it blends). */
  const bound = (geometry: GraphGeometry, declared: TablePrimitive) => {
    const position = declared.attributes.POSITION;
    const low = position === undefined ? null : corner(position, 'min');
    const high = position === undefined ? null : corner(position, 'max');
    if (!low || !high) return;
    const displacement = [0, 0, 0];
    for (const target of declared.targets ?? []) {
      if (target.POSITION === undefined) continue;
      const [min, max] = [corner(target.POSITION, 'min'), corner(target.POSITION, 'max')];
      if (!min || !max) continue;
      for (let c = 0; c < 3; c++)
        displacement[c] = Math.max(displacement[c], Math.max(Math.abs(min[c]), Math.abs(max[c])));
    }
    if (declared.targets)
      for (let c = 0; c < 3; c++) {
        low[c] -= displacement[c];
        high[c] += displacement[c];
      }
    geometry.boundingBox = new Box3(
      new Vector3(low[0], low[1], low[2]),
      new Vector3(high[0], high[1], high[2]),
    );
    const [dx, dy, dz] = [low[0] - high[0], low[1] - high[1], low[2] - high[2]];
    const centre = geometry.boundingBox.isEmpty()
      ? new Vector3(0, 0, 0)
      : new Vector3((low[0] + high[0]) * 0.5, (low[1] + high[1]) * 0.5, (low[2] + high[2]) * 0.5);
    geometry.boundingSphere = new Sphere(centre, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
  };

  return (mesh: number, primitive: number): GraphGeometry => {
    const declared = document.meshes[mesh].primitives[primitive];
    const semantics = Object.keys(declared.attributes);
    const key = `${declared.indices}:${runs(declared.attributes)}${(declared.targets ?? [])
      .map((target) => `:${runs(target)}`)
      .join('')}`;
    let geometry = geometries.get(key);
    if (geometry) return geometry;
    geometry = new GraphGeometry();
    for (const semantic of semantics) {
      const name = NAMES[semantic] ?? semantic.toLowerCase();
      if (!(name in geometry.attributes))
        geometry.setAttribute(name, attributeOf(declared.attributes[semantic]));
    }
    if (declared.indices !== null)
      geometry.setIndex(attributeOf(declared.indices) as GraphAttribute);
    bound(geometry, declared);
    morph(geometry, declared, attributeOf);
    geometries.set(key, geometry);
    return geometry;
  };
}
