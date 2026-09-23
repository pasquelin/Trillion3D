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
import * as THREE from 'three';
import type {
  TableDocument,
  TablePrimitive,
} from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { NORMALISED, preparedAccessors } from './accessors.ts';

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
  geometry: THREE.BufferGeometry,
  declared: TablePrimitive,
  attributeOf: ReturnType<typeof preparedAccessors>,
) {
  const targets = declared.targets ?? [];
  for (const [semantic, name] of MORPHED) {
    if (!targets.some((target) => target[semantic] !== undefined)) continue;
    geometry.morphAttributes[name] = targets.map((target) =>
      target[semantic] !== undefined ? attributeOf(target[semantic]) : geometry.attributes[name],
    ) as THREE.BufferAttribute[];
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
  const geometries = new Map<string, THREE.BufferGeometry>();

  /** A run's declared corner, at the scale a normalised run is read at. */
  const corner = (rank: number, which: 'min' | 'max') => {
    const accessor = document.accessors[rank];
    const scale = accessor.normalized ? (NORMALISED[accessor.componentType] ?? 1) : 1;
    return accessor[which] && new THREE.Vector3().fromArray(accessor[which]).multiplyScalar(scale);
  };

  /** The box the positions declare, grown by the largest displacement a morph target declares
   *  (the loader's rule: not conservative, but the size of the shapes it blends). */
  const bound = (geometry: THREE.BufferGeometry, declared: TablePrimitive) => {
    const position = declared.attributes.POSITION;
    const low = position === undefined ? null : corner(position, 'min');
    const high = position === undefined ? null : corner(position, 'max');
    if (!low || !high) return;
    const box = new THREE.Box3(low, high);
    const displacement = new THREE.Vector3();
    for (const target of declared.targets ?? []) {
      if (target.POSITION === undefined) continue;
      const [min, max] = [corner(target.POSITION, 'min'), corner(target.POSITION, 'max')];
      if (!min || !max) continue;
      displacement.max(
        new THREE.Vector3(
          Math.max(Math.abs(min.x), Math.abs(max.x)),
          Math.max(Math.abs(min.y), Math.abs(max.y)),
          Math.max(Math.abs(min.z), Math.abs(max.z)),
        ),
      );
    }
    if (declared.targets) box.expandByVector(displacement);
    geometry.boundingBox = box;
    const sphere = new THREE.Sphere();
    box.getCenter(sphere.center);
    sphere.radius = box.min.distanceTo(box.max) / 2;
    geometry.boundingSphere = sphere;
  };

  return (mesh: number, primitive: number): THREE.BufferGeometry => {
    const declared = document.meshes[mesh].primitives[primitive];
    const semantics = Object.keys(declared.attributes);
    const key = `${declared.indices}:${runs(declared.attributes)}${(declared.targets ?? [])
      .map((target) => `:${runs(target)}`)
      .join('')}`;
    let geometry = geometries.get(key);
    if (geometry) return geometry;
    geometry = new THREE.BufferGeometry();
    for (const semantic of semantics) {
      const name = NAMES[semantic] ?? semantic.toLowerCase();
      if (!(name in geometry.attributes))
        geometry.setAttribute(name, attributeOf(declared.attributes[semantic]));
    }
    if (declared.indices !== null)
      geometry.setIndex(attributeOf(declared.indices) as THREE.BufferAttribute);
    bound(geometry, declared);
    morph(geometry, declared, attributeOf);
    geometries.set(key, geometry);
    return geometry;
  };
}
