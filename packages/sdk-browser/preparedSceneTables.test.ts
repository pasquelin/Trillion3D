import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EngineError, assertSceneTables, type PreparedSceneTables } from '../sdk-core/index.ts';
import { checkPreparedScene } from './preparedSceneTables.ts';
import type { BackendContext } from './backendTypes.ts';

/** A triangle under a node the scene moves: enough to carry a pose, a primitive and a surface. */
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const document = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: 'root', translation: [1, 2, 3], children: [1] },
    { name: 'leaf', mesh: 0 },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  materials: [{ name: 'surface' }],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [1, 1, 0],
    },
  ],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
  buffers: [{ byteLength: positions.byteLength }],
};

/** The document above as one GLB: the loader then reads its buffer from the container, with no
 *  resource to fetch — a unit test resolves no URL. */
function container() {
  const json = Buffer.from(JSON.stringify(document), 'utf8');
  const chunks = [json, Buffer.from(positions.buffer)].map((body) => {
    const padded = Buffer.alloc(
      body.length + ((4 - (body.length % 4)) % 4),
      body === json ? 32 : 0,
    );
    body.copy(padded);
    return padded;
  });
  const glb = Buffer.alloc(12 + chunks[0].length + 8 + chunks[1].length + 8);
  glb.write('glTF', 0, 'ascii');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  let at = 12;
  for (const [rank, chunk] of chunks.entries()) {
    glb.writeUInt32LE(chunk.length, at);
    glb.writeUInt32LE(rank === 0 ? 0x4e4f534a : 0x004e4942, at + 4);
    chunk.copy(glb, at + 8);
    at += chunk.length + 8;
  }
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length) as ArrayBuffer;
}

/** The material entry the compiler writes for a glTF material that declares nothing. */
const defaultMaterial = {
  name: '',
  lit: true,
  doubleSided: false,
  backSide: false,
  baseColor: [1, 1, 1],
  emissive: [0, 0, 0],
  attenuationColor: [1, 1, 1],
  metalness: 1,
  roughness: 1,
  alphaTest: 0,
  normalScale: 1,
  // The triangle declares no tangent, so the host flips the second normal factor and so does
  // the table (`compiler_tables/materials.rs`), which says which variant it was written for.
  normalScaleY: -1,
  derivativeTangents: true,
  aoIntensity: 1,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationDistance: 0,
  map: null,
  metalnessMap: null,
  roughnessMap: null,
  normalMap: null,
  aoMap: null,
  emissiveMap: null,
};
const tables = () =>
  JSON.parse(
    JSON.stringify({
      version: 1,
      nodeTableVersion: 1,
      materialTableVersion: 1,
      nodes: [
        {
          name: 'leaf',
          node: 1,
          parent: 0,
          mesh: 0,
          primitive: 0,
          material: 0,
          instance: 0,
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1],
          bounds: { min: [1, 2, 3], max: [2, 3, 3] },
        },
      ],
      materials: [{ ...defaultMaterial, name: 'surface' }],
      textures: [],
    }),
  ) as PreparedSceneTables;

async function scene() {
  const gltf = await new GLTFLoader().parseAsync(container(), '');
  return {
    source: gltf.scene as THREE.Object3D,
    associations: gltf.parser.associations as BackendContext['associations'],
    textureIndices: new Map<THREE.Texture, number>(),
  };
}

test('the tables describe the scene the loader builds', async () => {
  const checked = checkPreparedScene({ tables: tables(), ...(await scene()) });
  assert.deepEqual(checked, { nodes: 1, materials: 1, textures: 0 });
});

test('a pose the tables place elsewhere is a named refusal', async () => {
  const wrong = tables();
  wrong.nodes[0].matrix = [...wrong.nodes[0].matrix.slice(0, 13), 9, 3, 1];
  await assert.rejects(
    async () => checkPreparedScene({ tables: wrong, ...(await scene()) }),
    (error: unknown) =>
      error instanceof EngineError &&
      error.code === 'PREPARED_SCENE_MISMATCH' &&
      error.message.includes('at the pose the scene places it'),
  );
});

test('a surface field the tables state otherwise is a named refusal', async () => {
  const wrong = tables();
  wrong.materials[0].roughness = 0.25;
  await assert.rejects(
    async () => checkPreparedScene({ tables: wrong, ...(await scene()) }),
    (error: unknown) =>
      error instanceof EngineError &&
      error.code === 'PREPARED_SCENE_MISMATCH' &&
      error.message.includes('roughness is 1 where the table says 0.25'),
  );
});

test('a primitive the loaded scene does not draw is a named refusal', async () => {
  const wrong = tables();
  wrong.nodes.push({ ...wrong.nodes[0], mesh: 1, instance: 0 });
  await assert.rejects(
    async () => checkPreparedScene({ tables: wrong, ...(await scene()) }),
    (error: unknown) =>
      error instanceof EngineError && error.message.includes('the loaded scene does not draw'),
  );
});

test('tables of an unknown version are refused rather than half-read', () => {
  assert.throws(
    () => assertSceneTables({ ...tables(), nodeTableVersion: 99 }),
    (error: unknown) =>
      error instanceof EngineError &&
      error.code === 'UNSUPPORTED_SCENE_TABLES' &&
      error.message.includes('nodeTableVersion 99'),
  );
  assert.throws(
    () => assertSceneTables(null),
    (error: unknown) => error instanceof EngineError && error.code === 'INVALID_SCENE_TABLES',
  );
});
