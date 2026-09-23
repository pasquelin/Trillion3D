/**
 * The proof that the prepared scene built from the cache tables is the scene the host loader built
 * from the published document: on every cache the repository publishes, and for each document it
 * lays out (`source.gltf`, and the autonomous `scene.gltf` where one is written), the two host
 * graphs are walked side by side and must agree on every object, pose, name, geometry byte, bound,
 * surface field, sampler and light the engine or a host renderer reads.
 *
 * The loader is the witness here and only here, to prove it has nothing left to read. Images are
 * decoded by a stand-in answering the size of the bytes given, so both sides compare the same files.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { assertSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import { buildPreparedScene } from './build.ts';

const site = new URL('../../../../../site/assets/', import.meta.url);

/** Every published cache: the key folder its pointer names. */
async function caches() {
  const found: URL[] = [];
  for (const entry of await readdir(site, { recursive: true }))
    if (entry.endsWith('cache/native/full/manifest.json')) {
      const pointer = new URL(entry, site);
      const { url } = JSON.parse(await readFile(pointer, 'utf8')) as { url: string };
      found.push(new URL('./', new URL(url, pointer)));
    }
  return found;
}

/** Files served from disk, and images decoded to the size of their bytes, on both sides. */
function serveFiles(t: TestContext) {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    return new Response(await readFile(fileURLToPath(url)));
  });
  const decode = async (blob: Blob) => ({ width: 1, height: 1, bytes: blob.size });
  // The loader reports its download progress with the browser's event and reaches the page's
  // global as `self`, which Node lacks.
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

function attribute(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const data = a instanceof THREE.InterleavedBufferAttribute ? a.data : undefined;
  const array = data ? data.array : a.array;
  return {
    kind: array.constructor.name,
    itemSize: a.itemSize,
    count: a.count,
    normalized: a.normalized,
    stride: data?.stride,
    offset: a instanceof THREE.InterleavedBufferAttribute ? a.offset : undefined,
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

type Ranks = (
  object: object,
) => { meshes?: number; primitives?: number; textures?: number } | undefined;

function texture(t: THREE.Texture, ranks: Ranks) {
  const { name, channel, flipY, wrapS, wrapT, magFilter, minFilter, generateMipmaps } = t;
  t.updateMatrix();
  return {
    ...{ name, channel, flipY, wrapS, wrapT, magFilter, minFilter, generateMipmaps },
    colorSpace: t.colorSpace,
    matrix: [...t.matrix.elements],
    image: t.image as unknown,
    rank: ranks(t)?.textures,
  };
}

/** Every field of a surface, the emissive colour read as the host shades it (colour × strength). */
function material(m: THREE.Material, ranks: Ranks) {
  const out: Record<string, unknown> = { type: m.type };
  const skip = new Set(['uuid', 'id', 'version', 'userData', 'emissive', 'emissiveIntensity']);
  for (const [key, value] of Object.entries(m)) {
    if (skip.has(key) || key.startsWith('_listeners')) continue;
    if (value instanceof THREE.Texture) out[key] = texture(value, ranks);
    else if (value instanceof THREE.Color || value instanceof THREE.Vector2)
      out[key] = value.toArray();
    else if (typeof value !== 'function' && typeof value !== 'object') out[key] = value;
  }
  const emissive = (m as THREE.MeshStandardMaterial).emissive;
  if (emissive)
    out.emissive = emissive
      .toArray()
      .map((c) => c * (m as THREE.MeshStandardMaterial).emissiveIntensity);
  return out;
}

function describe(root: THREE.Object3D, ranks: Ranks) {
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
      light: light.isLight
        ? [
            light.color.toArray(),
            light.intensity,
            light.distance,
            light.decay,
            light.angle,
            light.penumbra,
          ]
        : undefined,
    });
  });
  return out;
}

async function witness(folder: URL, document: string) {
  const text = await readFile(new URL(document, folder), 'utf8');
  const gltf = await new GLTFLoader().parseAsync(text, folder.href);
  const associations = gltf.parser.associations as Map<object, ReturnType<Ranks>>;
  return describe(gltf.scene, (object) => associations.get(object));
}

async function prepared(folder: URL, document: string) {
  const tables = assertSceneTables(
    JSON.parse(await readFile(new URL('scene-tables.json', folder), 'utf8')),
  );
  const built = await buildPreparedScene({
    tables,
    metadata: {} as ClusterManifest,
    sceneFile: document,
    base: folder.href,
    skipBaked: false,
    signal: undefined,
    track: (_resource, read) => read,
  });
  const meshes = built.associations as Map<object, ReturnType<Ranks>>;
  const textures = built.textureIndices as Map<object, number>;
  return describe(built.source as unknown as THREE.Object3D, (object) =>
    textures.has(object) ? { textures: textures.get(object) } : meshes.get(object),
  );
}

test('the scene built from the tables is the scene the loader built, on every published cache', async (t) => {
  serveFiles(t);
  const folders = await caches();
  assert.ok(folders.length >= 10, 'the published caches are found');
  for (const folder of folders)
    for (const document of ['source.gltf', 'scene.gltf']) {
      const exists = await readFile(new URL(document, folder)).then(
        () => true,
        () => false,
      );
      if (!exists) continue;
      assert.deepEqual(
        await prepared(folder, document),
        await witness(folder, document),
        `${pathToFileURL(fileURLToPath(folder)).pathname.split('site/assets/')[1]}${document}`,
      );
    }
});
