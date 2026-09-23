import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Instance, LampLight } from '../plan/contract.ts';
import { box, cylinder, prop, SURFACES } from '../props/index.ts';
import { writeWorldGltf } from './write.ts';

const meshes = [
  prop('crate', [box(SURFACES.wood, [1, 1, 1]), box(SURFACES.steel, [0.2, 1.2, 0.2])]),
  prop('post', [cylinder(SURFACES.steel, 0.1, 3), box(SURFACES.emissiveLamp, [0.3, 0.1, 0.3])]),
];
// More nodes than one serialised slice, so the node list is written in several pieces.
const instances: Instance[] = Array.from({ length: 5000 }, (_, i) => ({
  prop: i % 3 ? 'crate' : 'post',
  position: [i * 3 - 7500, 0, 20_000],
  yaw: i * 0.01,
  ...(i % 7 ? {} : { scale: 1.5 }),
  name: `thing-${i}`,
}));
const lights: LampLight[] = [
  {
    name: 'a',
    type: 'point',
    position: [0, 3, 0],
    color: [1, 0.8, 0.6],
    intensity: 500,
    range: 20,
    night: true,
  },
  {
    name: 'b',
    type: 'spot',
    position: [4, 3, 0],
    color: [1, 1, 1],
    intensity: 3000,
    range: 30,
    direction: [0, -1, 0],
    cone: 1,
    night: false,
  },
  {
    name: 'c',
    type: 'point',
    position: [8, 3, 0],
    color: [1, 0.8, 0.6],
    intensity: 500,
    range: 20,
    night: true,
  },
];

test('the world writer shares each mesh across its nodes and puts lamps on nodes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openworld-gltf-'));
  try {
    const result = await writeWorldGltf(dir, 'piece', { meshes, instances, lights });
    const gltf = JSON.parse(await readFile(join(dir, 'piece.gltf'), 'utf8')),
      bin = await readFile(join(dir, 'piece.bin'));
    assert.equal(result.nodes, 5003);
    assert.equal(gltf.meshes.length, 2);
    assert.equal(gltf.nodes.filter((n: { mesh?: number }) => n.mesh === 1).length, 5000 - 3333);
    assert.equal(gltf.scenes[0].nodes.length, 5003);
    assert.equal(gltf.nodes[7].scale[0], 1.5);
    assert.deepEqual(
      gltf.materials.map((m: { name: string }) => m.name),
      ['wood', 'steel', 'emissive-lamp'],
    );
    assert.ok(gltf.extensionsUsed.includes('KHR_materials_emissive_strength'));
    // Closed props are culled; only `card/…` surfaces are drawn from both sides.
    assert.ok(gltf.materials.every((m: { doubleSided: boolean }) => !m.doubleSided));
    assert.equal(gltf.buffers[0].byteLength, bin.length);
    for (const view of gltf.bufferViews) assert.equal(view.byteOffset % 4, 0);
    for (const accessor of gltf.accessors.filter((a: { type: string }) => a.type === 'SCALAR')) {
      const view = gltf.bufferViews[accessor.bufferView],
        indices = new Uint32Array(bin.buffer, bin.byteOffset + view.byteOffset, accessor.count);
      const vertices = gltf.accessors.find(
        (a: { bufferView: number }) => a.bufferView === accessor.bufferView - 2,
      ).count;
      assert.ok(indices.every((i) => i < vertices));
    }
    const lamps = gltf.nodes.slice(5000);
    assert.equal(gltf.extensions.KHR_lights_punctual.lights.length, 2);
    assert.deepEqual(
      lamps.map((n: { name: string }) => n.name),
      ['a', 'b', 'c'],
    );
    assert.equal(
      lamps[0].extensions.KHR_lights_punctual.light,
      lamps[2].extensions.KHR_lights_punctual.light,
    );
    assert.deepEqual(
      lamps.map((n: { extras: { night: boolean } }) => n.extras.night),
      [true, false, true],
    );
    assert.equal(gltf.extensions.KHR_lights_punctual.lights[1].spot.outerConeAngle, 1);
    assert.ok(!JSON.stringify(gltf).includes('KHR_mesh_quantization'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the same piece written twice is the same bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openworld-gltf-'));
  try {
    await writeWorldGltf(join(dir, 'a'), 'piece', { meshes, instances, lights });
    await writeWorldGltf(join(dir, 'b'), 'piece', { meshes, instances, lights });
    for (const file of ['piece.gltf', 'piece.bin'])
      assert.ok(
        (await readFile(join(dir, 'a', file))).equals(await readFile(join(dir, 'b', file))),
      );
    await assert.rejects(
      writeWorldGltf(join(dir, 'c'), 'piece', {
        meshes,
        instances: [{ prop: 'nope', position: [0, 0, 0], yaw: 0 }],
        lights: [],
      }),
      /unknown prop/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a named image is written once, its surfaces share one texture, and UVs reach the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openworld-gltf-'));
  try {
    const rgba = new Uint8Array(4 * 4 * 4).fill(200),
      surface = (name: string) => ({ ...SURFACES.wood, name, texture: 'ground.png' }),
      part = (name: string) => ({
        surface: surface(name),
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1),
        uvs: Float32Array.of(0.1, 0.1, 0.9, 0.1, 0.1, 0.9),
        indices: Uint32Array.of(0, 2, 1),
      }),
      textured = [
        { id: 'a', parts: [part('ground/a')] },
        { id: 'b', parts: [part('ground/b')] },
      ],
      placed: Instance[] = ['a', 'b'].map((prop) => ({ prop, position: [0, 0, 0], yaw: 0 })),
      images = new Map([['ground.png', { size: 4, rgba }]]);
    await writeWorldGltf(dir, 'piece', { meshes: textured, instances: placed, lights: [], images });
    const gltf = JSON.parse(await readFile(join(dir, 'piece.gltf'), 'utf8')),
      png = await readFile(join(dir, 'ground.png'));
    assert.deepEqual(gltf.images, [{ uri: 'ground.png' }]);
    assert.equal(gltf.textures.length, 1);
    assert.equal(gltf.samplers[0].wrapS, 33071);
    for (const material of gltf.materials)
      assert.equal(material.pbrMetallicRoughness.baseColorTexture.index, 0);
    const uv = gltf.accessors[gltf.meshes[0].primitives[0].attributes.TEXCOORD_0];
    assert.equal(uv.type, 'VEC2');
    assert.equal(uv.count, 3);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    await assert.rejects(
      writeWorldGltf(join(dir, 'c'), 'piece', { meshes: textured, instances: placed, lights: [] }),
      /lacks/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
