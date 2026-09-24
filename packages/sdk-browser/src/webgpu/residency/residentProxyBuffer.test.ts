import test from 'node:test';
import assert from 'node:assert/strict';
import { PROXY_NODE_FLOATS, type SceneProxy } from '../../../../sdk-core/src/index.ts';
import {
  PROXY_COUNT_OFFSET,
  PROXY_HEADER_WORDS,
  PROXY_LAYOUT_WORD,
  PROXY_PARAM_FLOATS,
} from '../../bounce/nodeWgsl.ts';
import { createGpuBounceProxy } from '../../bounce/proxy.ts';
import { createGpuSunFarShadow } from '../../gpu/shadow/sunFarShadow.ts';
import { fakeDevice, type FakeBuffer } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** The mapped range of the resident proxy's buffer, as its creation filled it. */
const proxyBytes = (buffers: FakeBuffer[]) =>
  buffers.find((buffer) => buffer.label?.startsWith('Trillion3D resident proxy'))!.getMappedRange();

test('an adopted proxy carries ray settings and counters itself', () => {
  const { device, writes } = fakeDevice();
  const sunFar = createGpuSunFarShadow(device);
  const resident = {
    buffer: { label: 'proxy' } as unknown as GPUBuffer,
    bounds: [0, 0, 0, 3, 4, 0],
    cellMetres: 2,
    nodeCount: 1,
  } as unknown as Parameters<typeof sunFar.adopt>[0];
  sunFar.adopt(resident, false);
  assert.equal(sunFar.buffer(), resident.buffer, 'both passes bind proxy itself');
  assert.deepEqual(
    [writes[0].offset, writes[0].data.length],
    [0, PROXY_PARAM_FLOATS],
    'settings are written at head of proxy',
  );
  assert.equal(sunFar.maxDistanceMetres, 5, 'reach is bounding diagonal');
  const cleared: Array<[number, number]> = [];
  sunFar.prepare(
    {
      clearBuffer: (_b: unknown, offset: number, size: number) => cleared.push([offset, size]),
      copyBufferToBuffer: () => {},
    } as unknown as GPUCommandEncoder,
    0,
  );
  assert.deepEqual(cleared, [[PROXY_COUNT_OFFSET, 8]], 'counters live in same header');
});

test('resident proxy fits in single buffer, at offsets published by its header', () => {
  const triangles = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const nodeBounds = new Float32Array([-1, -2, -3, 4, 5, 6]);
  const nodeChildren = new Uint32Array([11, 12, 13, 14]);
  const proxy = {
    data: { triangles, albedo: new Uint32Array([7]), nodeBounds, nodeChildren },
    triangles: 1,
    nodes: 1,
    bounds: [0, 0, 0, 1, 1, 1],
    errorMetres: 0.5,
    cellMetres: 2,
  } as unknown as SceneProxy;
  const { device, buffers } = fakeDevice();
  const resident = createGpuBounceProxy(device, proxy);
  const words = new Uint32Array(proxyBytes(buffers));
  assert.equal(words[PROXY_LAYOUT_WORD], nodeBounds.length / PROXY_NODE_FLOATS, 'tree nodes');
  const starts = [
    words[PROXY_LAYOUT_WORD + 1],
    words[PROXY_LAYOUT_WORD + 2],
    words[PROXY_LAYOUT_WORD + 3],
  ];
  assert.deepEqual(starts, [0, triangles.length, triangles.length + nodeBounds.length]);
  const floats = new Float32Array(proxyBytes(buffers));
  assert.deepEqual(
    Array.from(floats.slice(PROXY_HEADER_WORDS, PROXY_HEADER_WORDS + triangles.length)),
    Array.from(triangles),
    'triangles re-read as is at published offset',
  );
  const boundsAt = PROXY_HEADER_WORDS + starts[1];
  assert.deepEqual(
    Array.from(floats.slice(boundsAt, boundsAt + nodeBounds.length)),
    Array.from(nodeBounds),
  );
  const childrenAt = PROXY_HEADER_WORDS + starts[2];
  assert.deepEqual(
    Array.from(words.slice(childrenAt, childrenAt + nodeChildren.length)),
    Array.from(nodeChildren),
  );
  assert.equal(
    resident.bytes,
    (triangles.length + nodeBounds.length + nodeChildren.length) * 4 + 4,
  );
});
