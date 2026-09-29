import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts';
import { GraphSurface } from '../host/graph/surface.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { wholeDeformationInputs, wholeMorphDeltas } from './wholeInputs.ts';
import { createSessionDeformation } from './session.ts';
import { createBlendCopyRecord } from '../cluster/blendCopyRecord.ts';
import { meshSurface } from '../page/surface.ts';
import { wholeDeformationPool } from './wholePool.ts';
import type { BlendGpuItem } from '../webgpu/blend/state.ts';
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts';

function sample() {
  const g = new Geometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([1, 2, 3]), 3));
  g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([3, 2, 1, 0]), 4));
  g.setAttribute('skinWeight', new BufferAttribute(new Float32Array([0.5, 0.5, 0, 0]), 4));
  g.morphAttributes.position = [new BufferAttribute(new Float32Array([2, 4, 6]), 3)];
  g.setIndex([0, 0, 0]);
  return g;
}

test('whole-copy inputs preserve source skin IDs and convert absolute morph targets once', () => {
  const data = wholeDeformationInputs(sample());
  assert.deepEqual([...data], [16, 1, 1, 14, 3, 2, 1, 0, 0.5, 0.5, 0, 0, 1, 2, 3, 0, 0, 0]);
  assert.deepEqual([...wholeMorphDeltas(sample())], [1, 2, 3, 0, 0, 0]);
});

test('whole transmission keeps no pages and distinct placement outputs in the existing pool', () => {
  const g = sample(),
    surface = new GraphSurface('physical', { transmission: 1 });
  const a = new Mesh(g, surface),
    b = new Mesh(g, surface);
  const copies = [a, b].map((mesh) => {
    const copy = createBlendCopyRecord(mesh, 0, mesh.matrixWorld, meshSurface(mesh));
    copy.deformation = { joints: [], targets: [4] };
    return copy;
  });
  const session = createSessionDeformation([], { of: (node) => node.matrixWorld }, copies);
  assert.equal(session.frame.bases.length, 2);
  const items = copies.map((copy) => ({
    matrix: copy.matrix,
    sourceGeometry: g,
    count: 3,
    flags: 0,
    paged: false,
  })) as BlendGpuItem[];
  const layout = wholeDeformationPool(items, session);
  assert.equal(layout.floats, wholeDeformationInputs(g).length + 2 * 11);
  const gpu = fakeDevice();
  const buffer = gpu.device.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE });
  const rows = layout.upload(gpu.device, buffer, 64, () => 7);
  assert.equal(rows.count, 2);
  assert.equal(items[0].deformInput, items[1].deformInput);
  assert.notEqual(items[0].deformOutput, items[1].deformOutput);
  assert.equal(items[0].position, buffer);
  assert.equal(items[0].paged, false);
  const table = written(gpu.writes.find((write) => write.buffer === rows.table)!);
  assert.ok(table);
});

test('whole soft-body mapping validates simulation IDs and preserves their explicit semantic', () => {
  const g = sample();
  const packed = wholeDeformationInputs(g, [2], 3);
  assert.equal(packed[0], 80);
  assert.deepEqual([...packed.slice(4, 12)], [2, 2, 2, 2, 1, 0, 0, 0]);
  for (const ids of [[3], [-1], [0.5], []])
    assert.throws(() => wholeDeformationInputs(g, ids, 3), /PHYSICS_FORMAT/);
});
