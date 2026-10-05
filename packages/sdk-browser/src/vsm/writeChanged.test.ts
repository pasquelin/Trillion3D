// What `vsmWriteChanged` sends: only the words that changed, the buffer then holding the whole
// image; past the coalescer's cap the narrowest steps are joined, never the unused ids between a
// table's single-page and full maps' records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, replayWrites } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { vsmWriteChanged, vsmWriteChangedCopy } from './writeChanged.ts';

test('only the changed words go up, the buffer holding the image; the hole is never sent', () => {
  const { device, writes } = fakeDevice();
  const words = 8192 * 4 + 64;
  const buffer = device.createBuffer({ label: 'next', size: words * 4, usage: 0 });
  const held = new Uint32Array(words);
  const image = new Uint32Array(words);
  // 40 records far apart below 8192 words, then one past the 8192-id hole.
  for (let k = 0; k < 40; k++) image[k * 128] = k + 1;
  image[8192 * 4 + 1] = 7;
  vsmWriteChanged(device, buffer, image, 0, words);
  assert.ok(writes.length <= 32, `${writes.length} writes`);
  const sent = writes.reduce((sum, w) => sum + (w.size ?? 0), 0);
  assert.ok(sent < 40 * 128 + 64, `${sent} words sent, not the hole`);
  replayWrites(held.buffer, writes);
  assert.deepEqual(held, image);
  // A still image sends nothing; one word changed sends one word.
  vsmWriteChanged(device, buffer, image, 0, words);
  assert.equal(writes.length, 0);
  image[5] = 9;
  vsmWriteChanged(device, buffer, image, 0, words);
  assert.deepEqual(
    writes.map((w) => [w.offset, w.size]),
    [[20, 1]],
  );
});

test('a buffer copied from another holds its words: the next write sends what differs from them', () => {
  const { device, writes } = fakeDevice();
  const source = device.createBuffer({ label: 'old', size: 64 * 4, usage: 0 });
  const target = device.createBuffer({ label: 'grown', size: 128 * 4, usage: 0 });
  const image = new Uint32Array(128);
  image.fill(3, 0, 64);
  vsmWriteChanged(device, source, image, 0, 64);
  // The GPU copy: the target holds the source's words, then zeros.
  const gpu = new Uint32Array(128);
  gpu.fill(3, 0, 64);
  vsmWriteChangedCopy(source, target);
  writes.length = 0;
  // A frame whose image puts zeros where the copy left threes: each goes up.
  const next = new Uint32Array(128);
  next.fill(3, 0, 32);
  next[100] = 5;
  vsmWriteChanged(device, target, next, 0, 128);
  replayWrites(gpu.buffer, writes);
  assert.deepEqual(gpu, next);
});
