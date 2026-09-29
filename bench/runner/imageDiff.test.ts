// A black capture never passes as 0 px (#1016): the diff names it, the report refuses it by file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageDiff, refuseBlackCaptures } from './imageDiff.ts';
import type { Report } from './report/types.ts';

/** A 2 × 2 capture of one RGBA colour. */
const capture = (rgba: number[]) => ({
  body: Buffer.from(Array.from({ length: 4 }, () => rgba).flat()),
  w: 2,
  h: 2,
});

test('two identical drawn captures differ by 0 px', () => {
  assert.deepEqual(imageDiff(capture([12, 0, 0, 255]), capture([12, 0, 0, 255])), {
    pixels: 0,
    maxChannel: 0,
    meanChannel: 0,
    p999Channel: 0,
    total: 4,
  });
});

// #816: a resampled image is held to the native one by its mean and 99.9th-percentile channel
// error, alpha aside; a few far pixels move the maximum, not the percentile.
test('the channel errors give their mean and 99.9th percentile, in 1/255 steps', () => {
  const size = 1000,
    native = Buffer.alloc(size * 4, 200),
    scaled = Buffer.from(native);
  for (let i = 0; i < size; i++) scaled[i * 4] = 201; // red one step off everywhere
  scaled[1] = 240; // one green channel far off
  scaled[3] = 0; // alpha is not colour
  const diff = imageDiff({ body: native, w: size, h: 1 }, { body: scaled, w: size, h: 1 });
  assert.ok(diff && 'meanChannel' in diff);
  assert.equal(diff.meanChannel, (size + 40) / (size * 3));
  assert.equal(diff.p999Channel, 1);
  assert.equal(diff.maxChannel, 200);
});

test('two black captures are refused, never 0 px, whatever their alpha', () => {
  const diff = imageDiff(capture([0, 0, 0, 255]), capture([0, 0, 0, 0]));
  assert.deepEqual(diff, { error: 'black capture, RGB 0 everywhere' });
});

test('a black capture against a drawn one is refused too', () => {
  assert.deepEqual(imageDiff(capture([0, 0, 1, 255]), capture([0, 0, 0, 255])), {
    error: 'black capture, RGB 0 everywhere',
  });
});

test('every black capture is an error of the report, by its file name', () => {
  const errors: Report['errors'] = [{ kind: 'console', message: 'noise' }];
  refuseBlackCaptures(
    errors,
    new Map([
      ['after-sol-e1.png', capture([0, 0, 0, 255])],
      ['after-overview-e1.png', capture([0, 1, 0, 255])],
      ['after-rue-e1.png', null],
    ]),
  );
  assert.deepEqual(errors, [
    { kind: 'black-capture', message: 'after-sol-e1.png: RGB 0 everywhere' },
    { kind: 'console', message: 'noise' },
  ]);
});
