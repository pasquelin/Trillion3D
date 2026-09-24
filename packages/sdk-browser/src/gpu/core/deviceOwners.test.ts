import test from 'node:test';
import assert from 'node:assert/strict';
import { claimGpuDevice, sharedGpuDevice, untaggedLabel } from './deviceOwners.ts';
import { installGpuDeviceLedger } from './deviceLedger.ts';
import { generateMaterialMips } from '../../texture/mips.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

type Described = { label?: string } | undefined;
const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };

/**
 * A device as WebGPU writes one: its members on the prototype, each refusing a `this` that is not
 * a device ("Illegal invocation"), and its events through `EventTarget`, which checks the same.
 */
class FakeDevice extends EventTarget {
  readonly #queue = { writeBuffer() {}, submit() {} };
  readonly #lost: Promise<GPUDeviceLostInfo>;
  lose!: (info: GPUDeviceLostInfo) => void;
  constructor() {
    super();
    this.#lost = new Promise((resolve) => (this.lose = resolve));
  }
  /** The platform's brand check: only a device holds the private field. */
  static #check(self: object) {
    if (!(#queue in self)) throw new TypeError('Illegal invocation');
  }
  #made(descriptor: Described) {
    FakeDevice.#check(this);
    return { label: descriptor?.label, destroy() {} };
  }
  get queue() {
    FakeDevice.#check(this);
    return this.#queue;
  }
  get lost() {
    FakeDevice.#check(this);
    return this.#lost;
  }
  get limits() {
    FakeDevice.#check(this);
    return { minUniformBufferOffsetAlignment: 256 };
  }
  createBuffer(descriptor: GPUBufferDescriptor) {
    return this.#made(descriptor) as unknown as GPUBuffer;
  }
  createTexture(descriptor: GPUTextureDescriptor) {
    const createView = (view: Described) => ({ label: view?.label });
    return { ...this.#made(descriptor), createView } as unknown as GPUTexture;
  }
  createQuerySet(descriptor: GPUQuerySetDescriptor) {
    return this.#made(descriptor) as unknown as GPUQuerySet;
  }
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor) {
    return { ...this.#made(descriptor), beginRenderPass: () => pass, finish: () => ({}) };
  }
  createBindGroup(descriptor: GPUBindGroupDescriptor) {
    return this.#made(descriptor);
  }
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor) {
    return this.#made(descriptor);
  }
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor) {
    return this.#made(descriptor);
  }
  createShaderModule(descriptor: GPUShaderModuleDescriptor) {
    return this.#made(descriptor);
  }
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor) {
    return this.#made(descriptor);
  }
  raise(message: string) {
    this.dispatchEvent(Object.assign(new Event('uncapturederror'), { error: { message } }));
  }
}
const fakeDevice = () => new FakeDevice() as FakeDevice & GPUDevice;

/** An owner that records what reaches it. */
function owner() {
  const errors: string[] = [],
    closed: string[] = [],
    losses: string[] = [];
  return {
    errors,
    closed,
    losses,
    error: (message: string) => errors.push(message),
    closedError: (message: string) => closed.push(message),
    lost: (info: { reason: string }) => losses.push(info.reason),
  };
}

// As Dawn writes it: the object at fault by its type and its label, in quotes.
const destroyed = (label: string) =>
  `[Buffer "${label}"] is destroyed.\n - While calling [Buffer "${label}"].MapAsync(MapMode::Read, 0, 64).`;

test('a session handle forwards every member to the device, under the device as `this`', () => {
  const device = fakeDevice();
  const { device: handle } = claimGpuDevice(device, owner());
  // The fake refuses what WebGPU refuses: a member read on anything but the device.
  assert.throws(() => Reflect.get(FakeDevice.prototype, 'queue', handle), /Illegal invocation/);
  assert.equal(handle.queue, device.queue);
  assert.equal(handle.lost, device.lost);
  assert.equal(handle.limits.minUniformBufferOffsetAlignment, 256);
  assert.equal(sharedGpuDevice(handle), device);
  assert.equal(sharedGpuDevice(device), device);
  // Methods, even detached, run on the device.
  const { createBuffer, addEventListener } = handle;
  assert.doesNotThrow(() => createBuffer({ size: 4, usage: 0 }));
  let heard = 0;
  addEventListener('uncapturederror', () => heard++);
  device.raise('[Buffer] is destroyed');
  assert.equal(heard, 1);
});

test('every object a session creates names it, views included; the device names none', () => {
  const device = fakeDevice();
  const { device: handle, tag } = claimGpuDevice(device, owner());
  const texture = handle.createTexture({ size: [1, 1], format: 'r8unorm', usage: 0, label: 'hdr' });
  assert.equal(texture.label, `hdr ${tag}`);
  assert.equal(untaggedLabel(texture.label), 'hdr');
  assert.equal(texture.createView().label, tag);
  assert.equal(texture.createView({ label: 'level 1' }).label, `level 1 ${tag}`);
  assert.equal(handle.createQuerySet({ type: 'timestamp', count: 2 }).label, tag);
  assert.equal(handle.createCommandEncoder().label, tag);
  assert.equal(handle.createBindGroupLayout({ entries: [] }).label, tag);
  assert.equal(device.createBuffer({ size: 4, usage: 0, label: 'raw' }).label, 'raw');
});

test("an object the closing session creates after the next claim keeps the closing one's tag", (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const device = fakeDevice();
  const first = owner(),
    second = owner();
  const closing = claimGpuDevice(device, first);
  const next = claimGpuDevice(device, second);
  // The closing session's last read, queued while the next one opens.
  const late = closing.device.createBuffer({ size: 4, usage: 0, label: 'DAG readback' }).label;
  assert.equal(late, `DAG readback ${closing.tag}`);
  closing.release();
  device.raise(destroyed(late));
  device.raise(destroyed(late));
  assert.deepEqual([first.errors, second.errors], [[], []], 'never the live session’s loss');
  // Said once, as a warning: on the live session's diagnostics, and on the console.
  assert.equal(second.closed.length, 1);
  assert.match(second.closed[0], /DAG readback/);
  assert.equal(warned.mock.callCount(), 1);
  // One of its own objects, or one no tag names: the live session's, as before.
  const mine = next.device.createTexture({ size: [1, 1], format: 'r8unorm', usage: 0 }).label;
  device.raise(`[TextureView of Texture "${mine}"] is invalid`);
  device.raise('[Buffer] is destroyed');
  assert.equal(second.errors.length, 2);
});

test('what the device keeps for every session is created on it, untagged', () => {
  installGpuGlobals();
  const device = fakeDevice();
  const created: string[] = [];
  const createBuffer = device.createBuffer.bind(device);
  device.createBuffer = (descriptor) => {
    created.push(descriptor.label ?? '');
    return createBuffer(descriptor);
  };
  const { device: handle } = claimGpuDevice(device, owner());
  const texture = handle.createTexture({
    size: [4, 4],
    format: 'rgba8unorm',
    usage: 0,
    mipLevelCount: 3,
  });
  generateMaterialMips(handle, texture, 'rgba8unorm', 4, 4);
  assert.deepEqual(created, ['Trillion3D texture mips uniforms']);
});

test('a claim on a device already lost is lost at once; a released one hears no loss', async () => {
  const device = fakeDevice();
  const closed = owner(),
    live = owner();
  claimGpuDevice(device, closed).release();
  claimGpuDevice(device, live);
  device.lose({ reason: 'destroyed', message: 'gone' } as GPUDeviceLostInfo);
  await Promise.resolve();
  assert.deepEqual([closed.losses, live.losses], [[], ['destroyed']]);
  const late = owner();
  claimGpuDevice(device, late);
  assert.deepEqual(late.losses, ['destroyed'], 'before the claim returns');
});

test('the ledger counts by the label as the engine wrote it', () => {
  const device = fakeDevice();
  const ledger = installGpuDeviceLedger(device);
  const { device: handle } = claimGpuDevice(device, owner());
  handle.createBuffer({ size: 8, usage: 0, label: 'page table' });
  handle.createQuerySet({ type: 'timestamp', count: 2 });
  assert.deepEqual(Object.keys(ledger.snapshot().byLabel), ['page table']);
});
