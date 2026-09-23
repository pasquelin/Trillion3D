import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingScene, exportLightingGltf, type Vec3 } from './lightingExperimentScene.ts';
import { sub, dot, cross, close } from '../../tests/fixtures/lightingSceneTestHelpers.ts';
import { readLightingGltf } from '../../tests/fixtures/lightingSceneGltfTestHelpers.ts';

test('glTF preserves each surface, HDR emission, sphere winding and adapter binding in its binary geometry', () => {
  const scene = createLightingScene({ doorAngle: 0.7, lightIntensity: 2, roughness: 0.37 });
  const { gltf, binary } = exportLightingGltf(scene);
  const { views, meshes, nodes, materials, read } = readLightingGltf(gltf, binary);
  assert.deepEqual(gltf.buffers, [{ uri: 'scene.bin', byteLength: binary.byteLength }]);
  assert.equal(meshes.length, scene.surfaces.length + 1);
  for (const view of views) {
    assert.equal(view.byteOffset % 4, 0);
    assert.ok(view.byteOffset + view.byteLength <= binary.byteLength);
  }
  scene.surfaces.forEach((surface, i) => {
    assert.equal(meshes[i].name, surface.id);
    assert.equal(nodes[i].name, surface.id);
    assert.equal(nodes[i].extras.surfaceId, surface.id);
    assert.equal(nodes[i].extras.surfaceIndex, i);
    const primitive = meshes[i].primitives[0];
    assert.deepEqual(read(primitive.indices), [0, 1, 2, 0, 2, 3]);
    const positions = read(primitive.attributes.POSITION);
    const expected = [
      ...surface.origin,
      ...surface.origin.map((value, j) => value + surface.u[j]),
      ...surface.origin.map((value, j) => value + surface.u[j] + surface.v[j]),
      ...surface.origin.map((value, j) => value + surface.v[j]),
    ];
    assert.deepEqual(positions, expected.map(Math.fround));
  });
  const emitter =
    materials[scene.surfaces.findIndex((surface) => surface.id === 'ceiling_emitter')];
  emitter.emissiveFactor!.forEach((value, channel) =>
    close(
      value * emitter.extensions!.KHR_materials_emissive_strength.emissiveStrength,
      [24, 16.8, 10.8][channel],
    ),
  );
  const sphere = meshes.at(-1)!;
  assert.equal(sphere.name, 'glossy_sphere');
  const primitive = sphere.primitives[0],
    positions = read(primitive.attributes.POSITION),
    indices = read(primitive.indices);
  assert.equal(materials[primitive.material].pbrMetallicRoughness.metallicFactor, 1);
  assert.equal(materials[primitive.material].pbrMetallicRoughness.roughnessFactor, 0.37);
  const vertex = (i: number): Vec3 => positions.slice(i * 3, i * 3 + 3) as Vec3;
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertex(indices[i]),
      b = vertex(indices[i + 1]),
      c = vertex(indices[i + 2]);
    assert.ok(dot(cross(sub(b, a), sub(c, a)), sub(a, scene.sphere!.center)) > 0);
  }
});
