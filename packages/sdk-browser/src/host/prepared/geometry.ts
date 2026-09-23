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
import { EngineError } from '../../../../sdk-core/src/index.ts';
import type {
  TableAccessor,
  TableDocument,
} from '../../../../sdk-core/src/scene/core/tableDocuments.ts';

/** Storage of each glTF component type. */
const COMPONENTS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
} as const;
/** Components per element of each glTF element type. */
const WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 } as const;
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
/** What one unit of a normalised integer is worth: the scale a declared box is read at. */
const NORMALISED: Partial<Record<keyof typeof COMPONENTS, number>> = {
  5120: 1 / 127,
  5121: 1 / 255,
  5122: 1 / 32767,
  5123: 1 / 65535,
};

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/**
 * The geometry of each primitive of `document`, built on first request and shared after it.
 * `binary` is the document's buffer; `null` only for a document that lays out no view.
 */
export function preparedGeometries(document: TableDocument, binary: ArrayBuffer | null) {
  const views = new Map<number, ArrayBuffer>();
  const attributes = new Map<number, Attribute>();
  const interleaved = new Map<string, THREE.InterleavedBuffer>();
  const geometries = new Map<string, THREE.BufferGeometry>();

  /** A copy of one view, as the host loader held it: attributes view into it, never beyond. */
  const viewOf = (rank: number) => {
    let held = views.get(rank);
    if (!held) {
      const view = document.views[rank];
      if (!binary || view.offset + view.length > binary.byteLength)
        throw new EngineError('PREPARED_SCENE_MISMATCH', `view ${rank} lies outside the binary`, {
          view: rank,
          bytes: binary?.byteLength ?? 0,
        });
      held = binary.slice(view.offset, view.offset + view.length);
      views.set(rank, held);
    }
    return held;
  };

  const build = (accessor: TableAccessor): Attribute => {
    const Storage = COMPONENTS[accessor.componentType];
    const width = WIDTHS[accessor.type];
    const stride = accessor.view === null ? null : document.views[accessor.view].stride;
    const itemBytes = Storage.BYTES_PER_ELEMENT * width;
    if (accessor.view === null)
      return new THREE.BufferAttribute(
        new Storage(accessor.count * width),
        width,
        accessor.normalized,
      );
    const view = viewOf(accessor.view);
    if (!stride || stride === itemBytes)
      return new THREE.BufferAttribute(
        new Storage(view, accessor.offset, accessor.count * width),
        width,
        accessor.normalized,
      );
    // Interleaved: one host buffer per slice of `count` vertices, shared by the runs it holds.
    const slice = Math.floor(accessor.offset / stride);
    const key = `${accessor.view}:${accessor.componentType}:${slice}:${accessor.count}`;
    let buffer = interleaved.get(key);
    if (!buffer) {
      const elements = (accessor.count * stride) / Storage.BYTES_PER_ELEMENT;
      buffer = new THREE.InterleavedBuffer(
        new Storage(view, slice * stride, elements),
        stride / Storage.BYTES_PER_ELEMENT,
      );
      interleaved.set(key, buffer);
    }
    const offset = (accessor.offset % stride) / Storage.BYTES_PER_ELEMENT;
    return new THREE.InterleavedBufferAttribute(buffer, width, offset, accessor.normalized);
  };

  const attributeOf = (rank: number) => {
    let held = attributes.get(rank);
    if (!held) {
      held = build(document.accessors[rank]);
      attributes.set(rank, held);
    }
    return held;
  };

  /** The box the positions declare, at the scale a normalised run is read at. */
  const bound = (geometry: THREE.BufferGeometry, position: number | undefined) => {
    const accessor = position === undefined ? undefined : document.accessors[position];
    if (!accessor?.min || !accessor.max) return;
    const scale = accessor.normalized ? (NORMALISED[accessor.componentType] ?? 1) : 1;
    const box = new THREE.Box3(
      new THREE.Vector3().fromArray(accessor.min).multiplyScalar(scale),
      new THREE.Vector3().fromArray(accessor.max).multiplyScalar(scale),
    );
    geometry.boundingBox = box;
    const sphere = new THREE.Sphere();
    box.getCenter(sphere.center);
    sphere.radius = box.min.distanceTo(box.max) / 2;
    geometry.boundingSphere = sphere;
  };

  return (mesh: number, primitive: number): THREE.BufferGeometry => {
    const declared = document.meshes[mesh].primitives[primitive];
    const semantics = Object.keys(declared.attributes);
    const key = `${declared.indices}:${[...semantics]
      .sort()
      .map((semantic) => `${semantic}:${declared.attributes[semantic]};`)
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
    bound(geometry, declared.attributes.POSITION);
    geometries.set(key, geometry);
    return geometry;
  };
}
