/** The two sides of the prepared-scene proof (`build.test.ts`): every compiled cache served from
 *  disk, and a graph walked into the fields a reader compares — whole, as the reference renderer
 *  reads it, or by shape, as the engine reads it, whichever library built it. */ import { type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import * as K from './sceneKinds.fixture.ts';
import { COOKED_SCENES } from '../../../../../scripts/site-caches.ts';

const repository = new URL('../../../../../', import.meta.url);

/** Every compiled scene cache (`scripts/site-caches.ts`): the key folder its pointer names. */
export async function caches() {
  const found: URL[] = [];
  for (const { directory } of Object.values(COOKED_SCENES)) {
    const pointer = new URL(`${directory}/cache/native/full/manifest.json`, repository);
    const { url } = JSON.parse(await readFile(pointer, 'utf8')) as { url: string };
    found.push(new URL('./', new URL(url, pointer)));
  }
  return found;
}

/** Files served from disk, and images decoded to the size of their bytes, on both sides. */
export function serveFiles(t: TestContext) {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    return new Response(await readFile(fileURLToPath(url)));
  });
  const decode = async (blob: Blob) => ({ width: 1, height: 1, bytes: blob.size });
  // The loader reports progress with the browser's event and reads `self`: Node lacks both.
  class ProgressEvent extends Event {}
  const scope = globalThis as Record<string, unknown>;
  const stubs = { createImageBitmap: decode, ProgressEvent, self: globalThis };
  Object.assign(scope, stubs);
  t.after(() => {
    for (const name of Object.keys(stubs)) delete scope[name];
  });
}

const hash = (array: ArrayLike<number> & ArrayBufferView) =>
  createHash('sha256')
    .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex');

/** An attribute by its layout and its bytes, owning its storage or viewing an interleaved one. */
function attribute(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const data = 'data' in a ? a.data : undefined;
  const array = data ? data.array : a.array;
  return {
    kind: array.constructor.name,
    itemSize: a.itemSize,
    count: a.count,
    normalized: a.normalized,
    stride: data?.stride,
    offset: 'offset' in a ? a.offset : undefined,
    bytes: hash(array as Float32Array),
  };
}

function geometry(g: THREE.BufferGeometry) {
  const attributes = Object.fromEntries(
    Object.entries(g.attributes).map(([name, a]) => [name, attribute(a)]),
  );
  const morphs = Object.entries(g.morphAttributes).map(([name, list]) => [
    name,
    list.map(attribute),
  ]);
  return {
    attributes,
    morphs: Object.fromEntries(morphs),
    relative: g.morphTargetsRelative,
    index: g.index && attribute(g.index),
    box: g.boundingBox && [...g.boundingBox.min.toArray(), ...g.boundingBox.max.toArray()],
    sphere: g.boundingSphere && [...g.boundingSphere.center.toArray(), g.boundingSphere.radius],
  };
}

export type Ranks = (
  object: object,
) => { meshes?: number; primitives?: number; textures?: number } | undefined;

/** Every field of a surface, the emissive colour read as the host shades it (colour × strength). */
function material(m: THREE.Material, ranks: Ranks) {
  const out: Record<string, unknown> = { type: m.type };
  const skip = new Set(['uuid', 'id', 'version', 'userData', 'emissive', 'emissiveIntensity']);
  for (const [key, value] of Object.entries(m)) {
    if (skip.has(key) || key.startsWith('_listeners')) continue;
    if (value?.isTexture || value?.isColor || value?.isVector2) out[key] = read(value, ranks);
    else if (typeof value !== 'function' && typeof value !== 'object') out[key] = value;
  }
  const emissive = (m as THREE.MeshStandardMaterial).emissive;
  if (emissive)
    out.emissive = emissive
      .toArray()
      .map((c) => c * (m as THREE.MeshStandardMaterial).emissiveIntensity);
  return out;
}

export function describe(root: THREE.Object3D, ranks: Ranks) {
  const out: unknown[] = [];
  root.traverse((o) => {
    const light = o as THREE.SpotLight;
    const mesh = o as THREE.Mesh;
    const { meshes, primitives } = ranks(o) ?? {};
    out.push({
      type: o.type,
      name: o.name,
      userName: o.userData.name as unknown,
      pose: [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()],
      ranks: mesh.isMesh ? { meshes, primitives } : undefined,
      geometry: mesh.isMesh ? geometry(mesh.geometry) : undefined,
      morph: mesh.isMesh ? mesh.morphTargetInfluences : undefined,
      material: mesh.isMesh ? material(mesh.material as THREE.Material, ranks) : undefined,
      light: light.isLight ? [light.color.toArray(), ...LIGHT.map((k) => light[k])] : undefined,
    });
  });
  return out;
}

const numbers = (v: { x: number; y: number; z: number; w?: number }) => [v.x, v.y, v.z, v.w];
const LIGHT = ['intensity', 'distance', 'decay', 'angle', 'penumbra'] as const;
/** The fields of a surface the engine reads (`../shadedMaterial.ts`, the physical gate). */
const SURFACE_FIELDS = (
  'name visible side forceSinglePass vertexColors toneMapped depthTest depthWrite ' +
  'depthFunc colorWrite polygonOffset polygonOffsetFactor polygonOffsetUnits transparent ' +
  'opacity alphaTest shininess matcap color map metalness roughness metalnessMap ' +
  'roughnessMap normalMap normalMapType normalScale aoMap aoMapIntensity emissive ' +
  'emissiveIntensity emissiveMap transmission ior thickness attenuationDistance ' +
  'attenuationColor alphaHash blending premultipliedAlpha alphaToCoverage stencilWrite ' +
  'flatShading wireframe envMap lightMap bumpMap displacementMap alphaMap transmissionMap ' +
  'thicknessMap clearcoat clearcoatMap clearcoatRoughnessMap clearcoatNormalMap ' +
  'clearcoatNormalScale sheen sheenColor sheenColorMap sheenRoughnessMap iridescence ' +
  'iridescenceMap iridescenceThicknessMap anisotropy anisotropyMap dispersion ' +
  'specularIntensity specularIntensityMap specularColor specularColorMap'
).split(' ');
const NODE_FIELDS =
  'name visible frustumCulled renderOrder castShadow receiveShadow matrixAutoUpdate';
/** The fields of a texture the engine reads (`../resources.ts`, the admission gate). */
const TEXTURE_FIELDS = (
  'name channel wrapS wrapT magFilter minFilter anisotropy flipY premultiplyAlpha ' +
  'generateMipmaps colorSpace matrixAutoUpdate mapping image'
).split(' ');
/** A value as the engine reads it: a colour, a vector, a node by their numbers. */
function read(value: unknown, ranks: Ranks): unknown {
  const v = value as Record<string, unknown> | null | undefined;
  const kind = K.textureKind(v);
  if (v && kind) {
    const t = v as unknown as { updateMatrix(): void; matrix: { elements: ArrayLike<number> } };
    t.updateMatrix();
    const fields = Object.fromEntries(TEXTURE_FIELDS.map((key) => [key, v[key]]));
    return { kind, ...fields, matrix: Array.from(t.matrix.elements), rank: ranks(v)?.textures };
  }
  if (v?.isColor) return [v.r, v.g, v.b];
  if (v?.isVector2) return [v.x, v.y];
  if (typeof v !== 'object' || v === null) return value;
  if (typeof v.z === 'number' && !('w' in v)) return [v.x, v.y, v.z];
  if ('matrixWorld' in v) return read(v.position, ranks);
  if (K.isAttribute(v)) return attribute(v as never);
  return Array.isArray(value) ? [...(value as unknown[])] : value;
}

/** The graph as the engine reads it, by name and by shape, whichever library built it. */
export function describeShape(root: Object3D | THREE.Object3D, ranks: Ranks) {
  const out: unknown[] = [];
  (root as Object3D).traverse((node) => {
    const o = node as unknown as Record<string, unknown> & THREE.Mesh & THREE.SpotLight;
    const { meshes, primitives } = ranks(o) ?? {};
    const kind = K.nodeKind(o),
      drawn = K.isDrawnKind(kind);
    const materials = drawn ? [o.material].flat() : [];
    out.push({
      kind,
      ...Object.fromEntries(NODE_FIELDS.split(' ').map((key) => [key, o[key]])),
      userName: o.userData.name as unknown,
      pose: [o.position, o.quaternion, o.scale].flatMap(numbers),
      ranks: drawn ? { meshes, primitives } : undefined,
      geometry: drawn ? geometry(o.geometry) : undefined,
      morph: drawn ? o.morphTargetInfluences : undefined,
      materials: materials.map((m) => ({
        family: K.surfaceFamily(m as unknown as Record<string, unknown>),
        ...Object.fromEntries(
          SURFACE_FIELDS.map((key) => [
            key,
            read((m as unknown as Record<string, unknown>)[key], ranks),
          ]),
        ),
      })),
      light: K.isLightKind(kind)
        ? ['color', ...LIGHT, 'target'].map((key) => read(o[key], ranks))
        : undefined,
      camera:
        kind === 'camera'
          ? ['fov', 'aspect', 'near', 'far', 'zoom'].map((key) => o[key])
          : undefined,
    });
  });
  return out;
}
