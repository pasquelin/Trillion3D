import test from 'node:test';
import assert from 'node:assert/strict';
import { claimGpuDevice } from './deviceOwners.ts';
import { fakeDevice, owner } from './fakeDevice.fixture.ts';

// As Dawn writes it: the object at fault by its type and its label, in quotes.
const destroyed = (label: string) =>
  `[Buffer "${label}"] is destroyed.\n - While calling [Buffer "${label}"].MapAsync(MapMode::Read, 0, 64).`;

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
  assert.equal(device.raise(destroyed(late)), true, 'the browser prints no red line of its own');
  device.raise(destroyed(late));
  device.raise(destroyed(late));
  assert.deepEqual([first.errors, second.errors], [[], []], 'never the live session’s loss');
  // Said once, as a warning: on the live session's diagnostics, and on the console; the later
  // ones are counted in that warning, not swallowed.
  assert.equal(second.closed.length, 1);
  assert.match(second.closed[0], /DAG readback/);
  assert.deepEqual(second.counts, [{ session: closing.tag, count: 3 }]);
  assert.equal(warned.mock.callCount(), 1);
  // One of its own objects, or one no tag names: the live session's, as before.
  const mine = next.device.createTexture({ size: [1, 1], format: 'r8unorm', usage: 0 }).label;
  device.raise(`[TextureView of Texture "${mine}"] is invalid`);
  device.raise('[Buffer] is destroyed');
  assert.equal(second.errors.length, 2);
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

test("an error naming no object is the live sessions', even just after a session closed", (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const device = fakeDevice();
  const first = owner(),
    second = owner();
  const closing = claimGpuDevice(device, first);
  claimGpuDevice(device, second);
  closing.release();
  // Nothing names the closed session: it cannot be told apart, and keeps the browser's line.
  assert.equal(device.raise('[Queue] Submit failed'), false);
  assert.deepEqual(
    [second.reasons, second.closed, warned.mock.callCount()],
    [['uncaptured-error'], [], 0],
  );
  assert.deepEqual(first.errors, []);
});

test("running out of memory is the live sessions' loss, whoever made the object", () => {
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
  // Named on the closed session's object: still the device's condition.
  device.raise(`[Buffer "${old}"] out of memory`, new GPUOutOfMemoryError('out of memory'));
  device.raise('Out of memory', new GPUOutOfMemoryError('Out of memory'));
  assert.deepEqual(second.reasons, ['out-of-memory', 'out-of-memory']);
  assert.deepEqual(second.closed, []);
});

test("with no session live, a closed one's error is said once on the console, then counted", (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const device = fakeDevice();
  const closing = claimGpuDevice(device, owner());
  const old = closing.device.createBuffer({ size: 4, usage: 0, label: 'readback' }).label;
  closing.release();
  assert.equal(device.raise(destroyed(old)), true);
  const next = owner();
  claimGpuDevice(device, next);
  assert.equal(device.raise(destroyed(old)), true);
  assert.equal(warned.mock.callCount(), 1);
  assert.deepEqual([next.closed, next.errors], [[], []]);
});
