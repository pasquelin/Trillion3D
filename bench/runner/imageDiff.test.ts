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
    maxCanal: 0,
    total: 4,
  });
});

test('two black captures are refused, never 0 px, whatever their alpha', () => {
  const diff = imageDiff(capture([0, 0, 0, 255]), capture([0, 0, 0, 0]));
  assert.deepEqual(diff, { erreur: 'black capture, RGB 0 everywhere' });
});

test('a black capture against a drawn one is refused too', () => {
  assert.deepEqual(imageDiff(capture([0, 0, 1, 255]), capture([0, 0, 0, 255])), {
    erreur: 'black capture, RGB 0 everywhere',
  });
});

test('every black capture is an error of the report, by its file name', () => {
  const errors: Report['errors'] = [];
  refuseBlackCaptures(
    errors,
    new Map([
      ['apres-sol-e1.png', capture([0, 0, 0, 255])],
      ['apres-generale-e1.png', capture([0, 1, 0, 255])],
      ['apres-rue-e1.png', null],
    ]),
  );
  assert.deepEqual(errors, [
    { kind: 'black-capture', message: 'apres-sol-e1.png: RGB 0 everywhere' },
  ]);
});
