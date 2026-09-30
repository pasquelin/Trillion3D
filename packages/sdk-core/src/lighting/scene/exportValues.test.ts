import test from 'node:test';
import assert from 'node:assert/strict';
import { exportLightingGltf } from './gltf.ts';
import {
  sceneFromSurfaces,
  sceneWithBlocker,
} from '../../../../../tests/fixtures/lightingTransportScene.ts';
import { readLightingGltf } from '../../../../../tests/fixtures/lightingSceneGltfTestHelpers.ts';

test('exported materials and metadata preserve diffuse, mirror and HDR scene semantics', () => {
  const surfaces = sceneWithBlocker(true, 1).surfaces;
  surfaces[0].albedo = [0.1, 0.2, 0.3];
  surfaces[0].emission = [0.25, 0.5, 1];
  surfaces[1].kind = 'mirror';
  surfaces[1].emission = [2, 8, 4];
  const scene = sceneFromSurfaces(surfaces);
  const { gltf, binary } = exportLightingGltf(scene);
  const { materials, meshes, nodes, read } = readLightingGltf(gltf, binary);
  assert.equal(meshes.length, 3);
  assert.deepEqual(gltf.extensionsUsed, ['KHR_materials_emissive_strength']);
  assert.deepEqual(materials[0], {
    name: 'receiver_material',
    pbrMetallicRoughness: {
      baseColorFactor: [0.1, 0.2, 0.3, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    emissiveFactor: [0.25, 0.5, 1],
  });
  assert.deepEqual(materials[1], {
    name: 'emitter_material',
    pbrMetallicRoughness: {
      baseColorFactor: [0.2, 0.2, 0.2, 1],
      metallicFactor: 1,
      roughnessFactor: 0,
    },
    emissiveFactor: [0.25, 1, 0.5],
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: 8 } },
  });
  assert.deepEqual(nodes[2].extras, {
    surfaceId: 'blocker',
    surfaceIndex: 2,
    moving: true,
    kind: 'diffuse',
    columns: 1,
    rows: 1,
    emission: [0, 0, 0],
  });
  const primitive = meshes[0].primitives[0];
  assert.deepEqual(read(primitive.attributes.NORMAL), [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  assert.deepEqual(read(primitive.attributes.TEXCOORD_0), [0, 0, 1, 0, 1, 1, 0, 1]);
  surfaces[1].emission = [0, 0, 0];
  assert.equal(exportLightingGltf(scene).gltf.extensionsUsed, undefined);
});
