import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { encodePng } from '../../packages/sdk-node/src/cutout/png.mts';
import { readPng } from './pngRead.ts';

/** A PNG of `type` from raw filtered rows, chunk CRCs left out: the reader does not check them. */
function png(width: number, height: number, type: number, rows: number[], extra: Buffer[] = []) {
  const chunk = (kind: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(kind, 4, 'ascii');
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, type, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('an RGBA PNG reads back the pixels written', () => {
  const rgba = Uint8Array.from([1, 2, 3, 4, 250, 251, 252, 253, 9, 8, 7, 6, 0, 0, 0, 255]);
  assert.deepEqual(readPng(encodePng(2, 2, rgba)).rgba, rgba);
});

test('an RGB PNG with the Sub and Up filters reads as opaque RGBA', () => {
  // Row 0, Sub: (10,20,30) then +5 each → (15,25,35). Row 1, Up: +1 on each byte of row 0.
  const file = png(2, 2, 2, [1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(
    [...readPng(file).rgba],
    [10, 20, 30, 255, 15, 25, 35, 255, 11, 21, 31, 255, 16, 26, 36, 255],
  );
});

test('a palette PNG reads its colours and their transparency', () => {
  const palette = Buffer.from([255, 0, 0, 0, 0, 255]);
  const chunk = (kind: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(kind, 4, 'ascii');
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const file = png(2, 1, 3, [0, 1, 0], [chunk('PLTE', palette), chunk('tRNS', Buffer.from([128]))]);
  assert.deepEqual([...readPng(file).rgba], [0, 0, 255, 255, 255, 0, 0, 128]);
});
