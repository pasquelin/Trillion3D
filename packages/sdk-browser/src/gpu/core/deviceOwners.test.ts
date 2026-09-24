import test from 'node:test';
import assert from 'node:assert/strict';
import { claimGpuDevice } from './deviceOwners.ts';
import { fakeDevice, owner } from './fakeDevice.fixture.ts';

// As Dawn writes it: the object at fault by its type and its label, in quotes.
const destroyed = (label: string) =>
  `[Buffer "${label}"] is destroyed.\n - While calling [Buffer "${label}"].MapAsync(MapMode::Read, 0, 64).`;

test("an error of a closed session's object is a warning, never the next one's loss", (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const device = fakeDevice();
  const first = owner(),
    second = owner();
  const closing = claimGpuDevice(device, first);
  const old = closing.device.createBuffer({ size: 4, usage: 0, label: 'DAG readback' }).label;
  // The next session opens while the closing one's read is still queued.
  const next = claimGpuDevice(device, second);
  closing.release();
  assert.equal(device.raise(destroyed(old)), false, 'the browser keeps its own line');
  device.raise(destroyed(old));
  assert.deepEqual([first.errors, second.errors], [[], []]);
  assert.equal(second.closed.length, 2);
  assert.equal(warned.mock.callCount(), 2, 'one line per error');
  // One of its own objects, or one no tag names: the live session's.
  const mine = next.device.createTexture({ size: [1, 1], format: 'r8unorm', usage: 0 }).label;
  device.raise(`[TextureView of Texture "${mine}"] is invalid`);
  device.raise('[Queue] Submit failed');
  assert.deepEqual(second.reasons, ['uncaptured-error', 'uncaptured-error']);
  assert.deepEqual(first.errors, []);
});

test('with no session live, the last error of a closed one waits for the next claim', (t) => {
  t.mock.method(console, 'warn', () => {});
  const device = fakeDevice();
  const closing = claimGpuDevice(device, owner());
  const old = closing.device.createBuffer({ size: 4, usage: 0, label: 'readback' }).label;
  closing.release();
  device.raise(`${destroyed(old)} first`);
  device.raise(`${destroyed(old)} last`);
  const next = owner(),
    later = owner();
  claimGpuDevice(device, next);
  claimGpuDevice(device, later);
  assert.equal(next.closed.length, 1);
  assert.match(next.closed[0], /last$/);
  assert.deepEqual([next.errors, later.closed], [[], []]);
});

test("running out of memory is the live sessions' loss, unless it names a closed one's object", (t) => {
  t.mock.method(console, 'warn', () => {});
  const device = fakeDevice();
  // WebGPU's class, by its name: Node has none.
  class GPUOutOfMemoryError {
    message: string;
    constructor(message: string) {
      this.message = message;
    }
  }
  const first = owner(),
    second = owner();
  const closing = claimGpuDevice(device, first);
  claimGpuDevice(device, second);
  const old = closing.device.createBuffer({ size: 4, usage: 0, label: 'pages' }).label;
  closing.release();
  const named = `[Buffer "${old}"] out of memory`;
  device.raise(named, new GPUOutOfMemoryError(named));
  device.raise('Out of memory', new GPUOutOfMemoryError('Out of memory'));
  assert.deepEqual([second.reasons, second.closed.length], [['out-of-memory'], 1]);
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
