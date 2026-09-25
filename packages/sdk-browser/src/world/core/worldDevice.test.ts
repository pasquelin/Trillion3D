import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeWorldRenderer } from '../capability/worldReady.ts';
import { holdWorldDevice } from './worldDevice.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const canvas = {} as HTMLCanvasElement;

test('an adapter that refuses its device leaves the world on WebGL2', async () => {
  const adapter = {
    features: new Set<string>(),
    limits: {},
    requestDevice: () => Promise.reject(new Error('device refused')),
  };
  const gl = { getSupportedExtensions: () => [], getExtension: () => null };
  const saved = { navigator: globalThis.navigator, document: Reflect.get(globalThis, 'document') };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { gpu: { requestAdapter: async () => adapter } },
  });
  Reflect.set(globalThis, 'document', { createElement: () => ({ getContext: () => gl }) });
  try {
    assert.deepEqual(await probeWorldRenderer(canvas, undefined), { renderer: 'webgl2' });
    // Forced, the refusal is said by name.
    await assert.rejects(probeWorldRenderer(canvas, 'webgpu'), /refused a device: .*refused/);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: saved.navigator });
    Reflect.set(globalThis, 'document', saved.document);
  }
});

test('a lost device is asked for again, and the session reopened on the new one', async () => {
  const devices = [fakeDevice(), fakeDevice()];
  let asked = 0,
    reopened = 0;
  const probe = async () => ({
    renderer: 'webgpu' as const,
    gpuDevice: devices[asked++].device,
  });
  const held = holdWorldDevice(canvas, undefined, () => reopened++, probe);
  await held.ready;
  assert.equal(held.gpuDevice, devices[0].device);
  const warn = console.warn;
  console.warn = () => {};
  devices[0].lose({ reason: 'unknown', message: 'driver reset' });
  for (let turn = 0; turn < 10 && !reopened; turn++) await new Promise(setImmediate);
  console.warn = warn;
  assert.equal(reopened, 1);
  assert.equal(held.gpuDevice, devices[1].device);
  // The world's own disposal destroys its device, and a loss by `destroy` asks for nothing.
  held.dispose();
  devices[1].lose({ reason: 'destroyed', message: '' });
  await new Promise(setImmediate);
  assert.ok(devices[1].destroyed.includes(devices[1].device));
  assert.equal(asked, 2);
});

test('a session opened while a device is asked again waits on it, and a WebGL2 grant fails', async () => {
  const first = fakeDevice();
  let answer!: (granted: { renderer: 'webgpu' | 'webgl2'; gpuDevice?: GPUDevice }) => void;
  let asked = 0,
    reopened = 0;
  const probe = () =>
    asked++ === 0
      ? Promise.resolve({ renderer: 'webgpu' as const, gpuDevice: first.device as never })
      : new Promise<{ renderer: 'webgpu' | 'webgl2'; gpuDevice?: GPUDevice }>((r) => (answer = r));
  const held = holdWorldDevice(canvas, undefined, () => reopened++, probe);
  await held.ready;
  const warn = console.warn;
  console.warn = () => {};
  first.lose({ reason: 'unknown', message: 'driver reset' });
  for (let turn = 0; turn < 10 && asked < 2; turn++) await new Promise(setImmediate);
  console.warn = warn;
  // In the window, no device is held: an opening waits on the grant instead of taking WebGL2.
  assert.equal(held.gpuDevice, undefined);
  assert.notEqual(held.pending, held.ready);
  let settled = false;
  const opening = held.pending.then(
    () => (settled = true),
    (error: Error) => error,
  );
  await new Promise(setImmediate);
  assert.equal(settled, false);
  // The machine now grants WebGL2 alone: the canvas holds a WebGPU context, the grant fails by name.
  answer({ renderer: 'webgl2' });
  assert.match(String(await opening), /WebGPU device was lost, none granted again/);
  for (let turn = 0; turn < 10 && !reopened; turn++) await new Promise(setImmediate);
  assert.equal(reopened, 1, 'the session reopens, and reports the refusal');
  held.dispose();
});
