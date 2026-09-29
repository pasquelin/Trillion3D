// #573: a dynamic geometry's rewrite is written in place in the float vertex pool, and stales the
// shadow pages its moved vertices cover — its own — and no other caster's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { createVertexPool } from '../core/geometryPrepare.ts';
import { createShadowMobility } from '../shadow/mobility.ts';
import type { HostAttributes } from '../../host/resources.ts';
import { updateWebgpuVertices } from './dynamicVertices.ts';
import type { WebgpuPagesRuntime } from './runtime.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

installGpuGlobals();

/** A device that keeps every write, as `[buffer, byte offset, floats]`. */
function recordingDevice() {
  const writes: [object, number, number[]][] = [];
  const device = {
    createBuffer: (descriptor: GPUBufferDescriptor) => ({ size: descriptor.size }),
    queue: {
      writeBuffer: (
        buffer: object,
        offset: number,
        data: Float32Array,
        at = 0,
        size = data.length,
      ) => void writes.push([buffer, offset, [...data.subarray(at, at + size)]]),
    },
  } as unknown as GPUDevice;
  return { device, writes };
}

test('a rewrite lands in its pool block alone and stales only its own shadow pages', () => {
  const { device, writes } = recordingDevice();
  const [wave, rock] = [geometry.plane(1, 1, 1, 1), geometry.plane(1, 1, 1, 1)];
  const attributes = [wave, rock].map((g) => g.attributes as unknown as HostAttributes);
  const pool = createVertexPool(device, 16, false, new Map());
  pool.place(attributes[1]);
  const block = pool.place(attributes[0], true)!;
  const roots = [0, 50].map((x, i) => ({
    pages: [{ attributes: attributes[i] }],
    world: new Matrix4().makeTranslation(x, 0, 0),
  }));
  const mobility = createShadowMobility();
  mobility.ensure(2, 4, (rank) => roots[rank].world.elements);
  const staled: [number[], boolean][] = [];
  const rt = {
    vis: { vertexPool: pool },
    gpu: { device, positionBuffers: new Map() },
    run: { lost: false, gate: { sceneMoved() {} } },
    layout: { selectionRoots: roots },
    lights: {
      mobility,
      plan: {
        worldChanged: (min: number[], max: number[], moving: boolean) =>
          void staled.push([[...min, ...max], moving]),
      },
    },
  } as unknown as WebgpuPagesRuntime;
  wave.attributes.position.setZ(1, 0.25);
  const box = Float64Array.of(0.5, -0.5, 0, 0.5, -0.5, 0.25);
  writes.length = 0;
  for (let frame = 0; frame < 2; frame++)
    assert.ok(
      updateWebgpuVertices(rt, attributes[0], [{ name: 'position', from: 1, count: 1 }], box),
    );
  assert.equal(block.vertexBase, 4, 'placed after the rock');
  assert.deepEqual(writes[0].slice(1), [(4 + 1) * 12, [0.5, -0.5, 0.25]], 'one vertex written');
  assert.deepEqual(
    staled,
    [
      [[0.5, -0.5, 0, 0.5, -0.5, 0.25], false],
      [[0.5, -0.5, 0, 0.5, -0.5, 0.25], true],
    ],
    'its moved box alone: whole on the first rewrite, its moving casters after',
  );
  assert.deepEqual([mobility.moves(0), mobility.moves(1)], [true, false], 'the rock stays static');
});

test('a block a record takes after the open is placed in the room the pool kept', () => {
  const { device } = recordingDevice();
  const pool = createVertexPool(device, 8, false, new Map());
  const sheet = () => geometry.plane(1, 1, 1, 1).attributes as unknown as HostAttributes;
  assert.equal(pool.place(sheet(), true)?.vertexBase, 0);
  assert.equal(pool.place(sheet(), true)?.vertexBase, 4, 'a mount after the open');
  assert.equal(pool.place(sheet(), true), undefined, 'no room left: the session opens again');
});
