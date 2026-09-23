import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPartition } from './gpuPartitionFactory.ts';
import { PARTITION_SHADER } from './gpuPartitionShader.ts';
import {
  PARTITION_BINDING,
  PARTITION_KERNEL_BINDINGS,
  UNI_SCALARS,
} from './gpuPartitionContract.ts';
import { hizDevice } from '../../tests/kit/gpu/hizDevice.ts';
import type { PartitionFrame } from './gpuPartitionUniform.ts';

const STORAGE_BUFFERS_PER_STAGE = 8;

/** A device that records the bind groups it makes — which buffers, under which binding — and
 *  the uniform words each image writes. */
function recordingDevice() {
  const groups: Array<Record<number, unknown>> = [],
    uniforms: Uint32Array[] = [];
  const device = hizDevice({
    createBuffer: ({ size }) => ({ size, destroy() {} }),
    queue: {
      writeBuffer: (_b: unknown, _o: number, words: Uint32Array) => uniforms.push(words.slice()),
    },
  });
  (device as unknown as { createBindGroup: unknown }).createBindGroup = ({
    entries,
  }: {
    entries: Array<{ binding: number; resource: { buffer: unknown } }>;
  }) => {
    const group = Object.fromEntries(entries.map((e) => [e.binding, e.resource.buffer]));
    groups.push(group);
    return group;
  };
  return { device, groups, uniforms };
}

const buffer = (label: string) => ({ label, size: 4, destroy() {} }) as unknown as GPUBuffer;

function frame(rows: number): PartitionFrame {
  return {
    view: new Float64Array(16),
    viewProj: new Float64Array(16),
    anchor: [0, 0, 0],
    near: 0.1,
    rows,
    width: 8,
    height: 8,
    levels: [{ offset: 0, width: 8 }],
    layerTop: 0,
    hasRest: true,
    viewMoved: false,
  };
}

const encoder = () =>
  ({
    clearBuffer() {},
    beginComputePass: () => ({
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups() {},
      end() {},
    }),
  }) as unknown as GPUCommandEncoder;

/** Body of every WGSL function of the module, by name. */
function functionBodies(shader: string) {
  const bodies = new Map<string, string>();
  for (const match of shader.matchAll(/fn (\w+)\(/g)) {
    const from = match.index + match[0].length,
      next = shader.slice(from).search(/\nfn |\n@compute/);
    bodies.set(match[1], next < 0 ? shader.slice(from) : shader.slice(from, from + next));
  }
  return bodies;
}

/** Buffers a kernel reads or writes, through the helpers it calls. */
function buffersUsed(bodies: Map<string, string>, kernel: string, names: readonly string[]) {
  const used = new Set<string>(),
    seen = new Set<string>(),
    walk = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      const body = bodies.get(name) ?? '';
      for (const buffer of names)
        if (new RegExp(`\\b${buffer === 'uniforms' ? 'uni' : buffer}[\\[.]`).test(body))
          used.add(buffer);
      for (const call of body.matchAll(/\b(\w+)\(/g)) if (bodies.has(call[1])) walk(call[1]);
    };
  walk(kernel);
  return used;
}

test("each partition kernel binds what it reads, nothing else, within a stage's storage cap", () => {
  const names = Object.keys(PARTITION_BINDING),
    bodies = functionBodies(PARTITION_SHADER);
  for (const [kernel, bound] of Object.entries(PARTITION_KERNEL_BINDINGS)) {
    const storage = bound.filter((name) => name !== 'uniforms');
    assert.ok(storage.length <= STORAGE_BUFFERS_PER_STAGE, `${kernel}: ${storage.length} storage`);
    assert.deepEqual([...bound].sort(), [...buffersUsed(bodies, kernel, names)].sort(), kernel);
  }
});

test('the projection rebinds the pyramid when its identity changes, and only then', async () => {
  const { device, groups } = recordingDevice();
  let pyramid = buffer('pyramid A');
  const partition = await createGpuPartition(device, 4, {
    items: buffer('items'),
    flags: buffer('flags'),
    restBits: buffer('rest'),
    slotUsed: buffer('slots'),
    pyramid: () => pyramid,
  });
  assert.ok(partition);
  const projectGroups = () => groups.filter((group) => PARTITION_BINDING.pyramid in group);
  assert.equal(projectGroups().length, 1, 'one projection group at creation');
  assert.equal(projectGroups()[0][PARTITION_BINDING.pyramid], pyramid);
  partition.encode(encoder(), frame(4));
  partition.encode(encoder(), frame(4));
  assert.equal(projectGroups().length, 1, 'the same pyramid is not rebound');
  pyramid = buffer('pyramid B');
  partition.encode(encoder(), frame(4));
  assert.equal(projectGroups().length, 2, 'a resized pyramid gets a new group');
  assert.equal(projectGroups()[1][PARTITION_BINDING.pyramid], pyramid);
  partition.dispose();
});

test('rows rewritten since the last image are read as never projected, once', async () => {
  const { device, uniforms } = recordingDevice();
  const partition = await createGpuPartition(device, 64, {
    items: buffer('items'),
    flags: buffer('flags'),
    restBits: buffer('rest'),
    slotUsed: buffer('slots'),
    pyramid: () => buffer('pyramid'),
  });
  assert.ok(partition);
  const forgotten = (image: number) => [
    ...uniforms[image].subarray(UNI_SCALARS + 7, UNI_SCALARS + 9),
  ];
  partition.encode(encoder(), frame(64));
  assert.deepEqual(forgotten(0), [0, 0], 'nothing rewritten: an empty range');
  partition.forgetRows(10, 12);
  partition.forgetRows(20, 20);
  partition.forgetRows(5, 3);
  partition.encode(encoder(), frame(64));
  assert.deepEqual(forgotten(1), [10, 21], 'the union of the rewritten ranks, end exclusive');
  partition.encode(encoder(), frame(64));
  assert.deepEqual(forgotten(2), [0, 0], 'forgotten once, then remembered as projected again');
  partition.dispose();
});

test('no pyramid, no partition: the frame then draws in one pass rather than reading nothing', async () => {
  const { device } = recordingDevice();
  const partition = await createGpuPartition(device, 4, {
    items: buffer('items'),
    flags: buffer('flags'),
    restBits: buffer('rest'),
    slotUsed: buffer('slots'),
    pyramid: () => undefined,
  });
  assert.equal(partition, undefined);
});
