import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingScene, type Vec3 } from './experimentScene.ts';
import { exportLightingGltf } from './gltf.ts';
import { sub, dot, cross, close } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';
import { readLightingGltf } from '../../../../../tests/fixtures/lightingSceneGltfTestHelpers.ts';
import {
  sceneFromSurfaces,
  sceneWithBlocker,
} from '../../../../../tests/fixtures/lightingTransportScene.ts';

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

/** The blocker scene with a mirror emitter brighter than 1 and a receiver dimmer than 1. */
function materialScene() {
  const surfaces = sceneWithBlocker(true, 1).surfaces;
  surfaces[0].albedo = [0.1, 0.2, 0.3];
  surfaces[0].emission = [0.25, 0.5, 1];
  surfaces[1].kind = 'mirror';
  surfaces[1].emission = [2, 8, 4];
  return sceneFromSurfaces(surfaces);
}

test('a diffuse surface exports matte, a mirror exports metallic and smooth', () => {
  const scene = materialScene();
  const materials = exportLightingGltf(scene).gltf.materials as any[];
  const [diffuse, mirror] = materials;
  assert.deepEqual(diffuse.pbrMetallicRoughness, {
    baseColorFactor: [...scene.surfaces[0].albedo, 1],
    metallicFactor: 0,
    roughnessFactor: 1,
  });
  assert.deepEqual(mirror.pbrMetallicRoughness, {
    baseColorFactor: [...scene.surfaces[1].albedo, 1],
    metallicFactor: 1,
    roughnessFactor: 0,
  });
  scene.surfaces.forEach((surface, i) => assert.equal(materials[i].name, `${surface.id}_material`));
});

test('emission up to 1 exports as a plain factor, brighter emission as a factor and a strength', () => {
  const scene = materialScene();
  const { gltf } = exportLightingGltf(scene);
  const [dim, bright, dark] = gltf.materials as any[];
  assert.deepEqual(dim.emissiveFactor, scene.surfaces[0].emission);
  assert.equal(dim.extensions, undefined);
  const strength = bright.extensions.KHR_materials_emissive_strength.emissiveStrength;
  assert.equal(Math.max(...bright.emissiveFactor), 1);
  assert.deepEqual(
    bright.emissiveFactor.map((value: number) => value * strength),
    scene.surfaces[1].emission,
  );
  assert.deepEqual(dark.emissiveFactor, [0, 0, 0]);
  assert.deepEqual(gltf.extensionsUsed, ['KHR_materials_emissive_strength']);
  scene.surfaces[1].emission = [1, 0.5, 0];
  assert.equal(exportLightingGltf(scene).gltf.extensionsUsed, undefined);
});

test('each surface node carries the transport metadata of its surface and its quad', () => {
  const scene = materialScene();
  const { gltf, binary } = exportLightingGltf(scene);
  const { meshes, nodes, read } = readLightingGltf(gltf, binary);
  scene.surfaces.forEach((surface, i) => {
    const { id, moving, kind, columns, rows, emission } = surface;
    assert.deepEqual(nodes[i].extras, {
      surfaceId: id,
      surfaceIndex: i,
      moving,
      kind,
      columns,
      rows,
      emission,
    });
    const primitive = meshes[i].primitives[0];
    const normal = read(primitive.attributes.NORMAL);
    const facing = cross(surface.u, surface.v);
    for (let vertex = 0; vertex < 4; vertex++) {
      const n = normal.slice(vertex * 3, vertex * 3 + 3) as Vec3;
      close(Math.hypot(...n), 1);
      close(dot(n, facing), Math.hypot(...facing));
    }
    assert.deepEqual(read(primitive.attributes.TEXCOORD_0), [0, 0, 1, 0, 1, 1, 0, 1]);
  });
  const extras = nodes[0].extras as { emission: number[] };
  scene.surfaces[0].emission[0] = 99;
  assert.notEqual(extras.emission[0], 99);
});

test('a sphere exports last, with its own metallic material and an owned copy of its metadata', () => {
  const scene = sceneWithBlocker(true, 1);
  scene.sphere = { center: [3, 4, 5], radius: 2, roughness: 0.7 };
  const { gltf, binary } = exportLightingGltf(scene);
  const { meshes, nodes, materials } = readLightingGltf(gltf, binary);
  assert.equal(meshes.length, scene.surfaces.length + 1);
  meshes.forEach((mesh, i) => assert.equal(mesh.primitives[0].material, i));
  assert.deepEqual(nodes.at(-1)!.extras, { center: [3, 4, 5], radius: 2, roughness: 0.7 });
  const sphere = materials.at(-1)! as any;
  assert.equal(sphere.name, `${meshes.at(-1)!.name}_material`);
  assert.deepEqual(
    [sphere.pbrMetallicRoughness.metallicFactor, sphere.pbrMetallicRoughness.roughnessFactor],
    [1, 0.7],
  );
  const [r, g, b, alpha] = sphere.pbrMetallicRoughness.baseColorFactor;
  assert.ok(r === g && g === b && r > 0 && r <= 1 && alpha === 1);
  const extras = nodes.at(-1)!.extras as { center: number[] };
  scene.sphere.center[0] = 99;
  assert.deepEqual(extras.center, [3, 4, 5]);
});
