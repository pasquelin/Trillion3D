import test from 'node:test';
import assert from 'node:assert/strict';
import { exportLightingGltf } from './gltf.ts';
import { sceneWithBlocker } from '../../../fixtures/lightingTransportScene.ts';
import { readLightingGltf } from '../../../fixtures/lightingSceneGltfTestHelpers.ts';

test('glTF meshes bind their own material and a glossy sphere carries complete physical metadata', () => {
  const scene = sceneWithBlocker(true, 1);
  scene.sphere = { center: [3, 4, 5], radius: 2, roughness: 0.7 };
  const { gltf, binary } = exportLightingGltf(scene);
  const { meshes, nodes } = readLightingGltf(gltf, binary);
  const materials = gltf.materials as Array<{
    name: string;
    pbrMetallicRoughness: { baseColorFactor: number[] };
  }>;
  const sphereExtras = (gltf.nodes as Array<{ extras: Record<string, unknown> }>).at(-1)!.extras;
  for (const mesh of meshes) {
    const material = materials[mesh.primitives[0].material];
    assert.equal(material.name, `${mesh.name}_material`);
  }
  const sphere = meshes.at(-1)!;
  assert.equal(sphere.name, 'glossy_sphere');
  assert.deepEqual(nodes.at(-1)!.extras, { center: [3, 4, 5], radius: 2, roughness: 0.7 });
  const material = materials[sphere.primitives[0].material];
  assert.deepEqual(material.pbrMetallicRoughness.baseColorFactor, [0.92, 0.92, 0.92, 1]);
  scene.sphere.center[0] = 99;
  assert.deepEqual(sphereExtras.center, [3, 4, 5]);
});
