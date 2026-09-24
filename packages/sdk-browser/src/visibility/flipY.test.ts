// #362: the CPU twin reads a `flipY` picture as both GPU paths upload it — its last row at v = 0 —
// through the UV placement three's Texture composes (`setUvTransform`: scaled by `repeat`, turned
// counter-clockwise by `rotation` about `center`, then slid by `offset`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleLinear } from './math.ts';
import { texture } from '../world/texture/index.ts';
import { hostTexture } from '../world/core/worldTextures.ts';
import { importHostTexture } from '../host/textureImport.ts';
import { GraphTexture } from '../host/graph/graph.fixture.ts';

// Two rows of two texels, first row first: A B over C D.
const A = [255, 0, 0, 255],
  B = [0, 255, 0, 255],
  C = [0, 0, 255, 255],
  D = [255, 255, 0, 255];
const pixels = () => new Uint8Array([...A, ...B, ...C, ...D]);

test('a flipY picture is read with its first row at the top: v = 1', () => {
  const page = texture.data(pixels(), 2, 2);
  page.flipY = true;
  const map = importHostTexture(hostTexture(page, false, new Map()));
  assert.deepEqual(sampleLinear(map, 0.25, 0.75), [1, 0, 0], 'A, top left');
  assert.deepEqual(sampleLinear(map, 0.75, 0.25), [1, 1, 0], 'D, bottom right');
  page.flipY = false;
  const kept = importHostTexture(hostTexture(page, false, new Map()));
  assert.deepEqual(sampleLinear(kept, 0.25, 0.75), [0, 0, 1], 'kept: C at v = 0.75');
});

test('a turned, tiled flipY picture: repeat, then a counter-clockwise turn, then the flip', () => {
  const page = texture.data(pixels(), 2, 2);
  page.flipY = true;
  page.wrap = 'repeat';
  page.repeat.set(2, 2);
  page.rotation = Math.PI / 2;
  const map = importHostTexture(hostTexture(page, false, new Map()));
  // A quarter turn about the origin, twice over: (u, v) reads (2v, -2u).
  const m = Array.from(map.transform).map((x) => Math.round(x * 1e6) / 1e6 + 0);
  assert.deepEqual(m, [0, -2, 0, 2, 0, 0, 0, 0, 1]);
  // (0.3, 0.1) reads (0.2, -0.6), wrapped to (0.2, 0.4): the lower row, left — C.
  assert.deepEqual(sampleLinear(map, 0.3, 0.1), [0, 0, 1]);
});

test('a premultiplyAlpha picture is read colour times alpha, as both GPU paths upload it', () => {
  const host = new GraphTexture({ data: new Uint8Array([255, 102, 0, 128]), width: 1, height: 1 });
  host.flipY = false;
  host.premultiplyAlpha = true;
  const map = importHostTexture(host);
  // 255 × 128 / 255 = 128, 102 × 128 / 255 = 51.2 → 51: the bytes the upload stores.
  assert.deepEqual(sampleLinear(map, 0.5, 0.5), [128 / 255, 51 / 255, 0]);
  host.premultiplyAlpha = false;
  host.version++;
  assert.deepEqual(sampleLinear(importHostTexture(host), 0.5, 0.5), [1, 102 / 255, 0]);
});
