// #573: a dynamic geometry's rewrite is written in place in the float vertex pool, and stales the
// shadow pages its moved vertices cover — its own — and no other caster's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { createVertexPool, type VertexPool } from '../core/geometryPrepare.ts';
import { createShadowMobility } from '../shadow/mobility.ts';
import type { HostAttributes } from '../../host/resources.ts';
import { webgpuVertexApi } from './dynamicVertices.ts';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
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

/** A runtime of `pool` on `device`, drawing `roots` with `lights`. */
const runtimeOf = (
  vertexPool: VertexPool,
  device: GPUDevice,
  positionBuffers: Map<HostAttributes, unknown>,
  selectionRoots: unknown[] = [],
  lights = {},
) =>
  ({
    ...{ vis: { vertexPool }, gpu: { device, positionBuffers }, lights },
    ...{ run: { lost: false, gate: { sceneMoved() {} } }, layout: { selectionRoots } },
  }) as unknown as WebgpuPagesRuntime;

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
  const worldChanged = (min: number[], max: number[], moving: boolean) =>
    void staled.push([[...min, ...max], moving]);
  const api = webgpuVertexApi(
    runtimeOf(pool, device, new Map(), roots, { mobility, plan: { worldChanged } }),
  );
  wave.attributes.position.setZ(1, 0.25);
  const box = Float64Array.of(0.5, -0.5, 0, 0.5, -0.5, 0.25);
  writes.length = 0;
  for (let frame = 0; frame < 2; frame++)
    assert.ok(api.updateVertices(attributes[0], [{ name: 'position', from: 1, count: 1 }], box));
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

test('a rewrite weighs what it sends the GPU: a normal with its tangent, positions twice', () => {
  const { device, writes } = recordingDevice();
  const plane = geometry.plane(1, 1, 1, 1).attributes; // its doubles: the world hands floats
  const xyz = new BufferAttribute(Float32Array.from(plane.position.array), 3);
  const attributes = { ...plane, position: xyz } as unknown as HostAttributes;
  const pool = createVertexPool(device, 8, false, new Map());
  pool.place(attributes, true);
  const api = webgpuVertexApi(runtimeOf(pool, device, new Map([[attributes, {}]])));
  const position = { name: 'position', from: 1, count: 2 } as const;
  const ranges: VertexRange[] = [position, { name: 'normal', from: 0, count: 1 }];
  const weighed = api.vertexBytes(attributes, ranges);
  writes.length = 0;
  assert.ok(api.updateVertices(attributes, ranges, new Float64Array(6)));
  const sent = writes.reduce((bytes, [, , floats]) => bytes + floats.length * 4, 0);
  assert.equal(weighed, sent, 'what is weighed is what is sent');
  assert.equal(weighed, 2 * 12 * 2 + 7 * 4, 'two positions twice, one normal and its tangent');
});
