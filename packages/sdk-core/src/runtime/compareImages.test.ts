import assert from 'node:assert/strict';
import test from 'node:test';
import { compareImages } from './compareImages.ts';

test('identical images have no pixel or channel error', () => {
  const image = new Uint8Array([0, 128, 255, 30, 70, 50, 20, 255]);
  assert.deepEqual(compareImages(image, image.slice()), {
    differentPixels: 0,
    maxChannelError: 0,
    rmse: 0,
  });
});

test('each RGBA channel contributes, including alpha and the last pixel', () => {
  const image = new Uint8Array(16).fill(10);
  const changed = new Uint8Array([10, 10, 10, 14, 10, 10, 14, 10, 10, 14, 10, 10, 14, 10, 10, 10]);
  const expected = { differentPixels: 4, maxChannelError: 4, rmse: 2 };
  for (const [a, b] of [
    [image, changed],
    [changed, image],
  ]) {
    assert.deepEqual(compareImages(a, b), expected);
    assert.deepEqual(a, a === image ? new Uint8Array(16).fill(10) : changed);
  }
});

test('a view compares only its own pixels for every alignment combination', () => {
  const original = [8, 9, 10, 11, 0, 0, 0, 0];
  const altered = [8, 9, 10, 11, 0, 0, 4, 4];
  for (const [aOffset, bOffset] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 3],
  ]) {
    const aBuffer = new Uint8Array(24).fill(255);
    const bBuffer = new Uint8Array(24).fill(1);
    aBuffer.set(original, aOffset);
    bBuffer.set(altered, bOffset);
    const aBefore = aBuffer.slice(),
      bBefore = bBuffer.slice();
    const a = aBuffer.subarray(aOffset, aOffset + 8);
    const b = bBuffer.subarray(bOffset, bOffset + 8);
    assert.deepEqual(compareImages(a, b), { differentPixels: 1, maxChannelError: 4, rmse: 2 });
    assert.deepEqual(aBuffer, aBefore);
    assert.deepEqual(bBuffer, bBefore);
  }
});

test('the largest channel difference wins even when it is not in the first changed pixel', () => {
  const a = new Uint8Array(8);
  const b = new Uint8Array([0, 0, 0, 4, 0, 0, 0, 12]);
  const result = compareImages(a, b);
  assert.equal(result.differentPixels, 2);
  assert.equal(result.maxChannelError, 12);
  assert.ok(Math.abs(result.rmse - 4.47213595499958) < 1e-12);
});

test('empty, unequal and incomplete RGBA buffers are refused', () => {
  for (const [a, b] of [
    [new Uint8Array(), new Uint8Array()],
    [new Uint8Array(4), new Uint8Array(8)],
    [new Uint8Array(3), new Uint8Array(3)],
    [new Uint8Array(5), new Uint8Array(5)],
  ])
    assert.throws(() => compareImages(a, b), /Invalid RGBA images/);
});

test('a single-channel error is measured on its own, at aligned and unaligned addresses', () => {
  for (const offset of [0, 1])
    for (let channel = 0; channel < 4; channel++) {
      const a = new Uint8Array(8).subarray(offset, offset + 4);
      const b = new Uint8Array(8).subarray(offset, offset + 4);
      b[channel] = 8;
      assert.deepEqual(compareImages(a, b), { differentPixels: 1, maxChannelError: 8, rmse: 4 });
    }
  const a = new Uint8Array(8);
  const b = new Uint8Array([12, 0, 0, 0, 0, 0, 0, 4]);
  assert.equal(compareImages(a, b).maxChannelError, 12);
});
