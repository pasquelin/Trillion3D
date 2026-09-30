// #1208: a resized pool's pages are moved texel for texel. The moves name each page's old and new
// place, and the move draw covers exactly the new page, each texel reading its twin in the old one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { PAGE_MOVE_SHADER } from './pageWgsl.ts';
import { shadowPageMoves } from './pageMoveWords.ts';

test('a move names the old page, its layer and side, then the new one and its target', () => {
  const moved = new Int32Array([-1, -1, -1, 0, 9]);
  // Page 3 of a pool of 2 × 2 pages a layer: layer 0, column 1, row 1. Page 4: layer 1, column 0.
  assert.deepEqual(
    [...shadowPageMoves(moved, 2, 3)],
    [
      ...[SHADOW_PAGE, SHADOW_PAGE, 0, SHADOW_PAGE, 0, 0, 0, 3 * SHADOW_PAGE],
      ...[0, 0, 1, SHADOW_PAGE, 0, 0, 1, 3 * SHADOW_PAGE],
    ],
  );
  const half = shadowPageMoves(moved, 2, 3, 0.5);
  assert.deepEqual([...half.subarray(0, 8)], [64, 64, 0, 64, 0, 0, 0, 192], 'the layer at ½');
});

/** What the move draw does for one move, in the shader's own arithmetic: the pixels its two
 *  triangles cover in the target, and the source texel each pixel's fragment loads. */
function drawn(words: Uint32Array) {
  const [wx, wy, wl, page, nx, ny, , size] = words;
  const corners = [0, 1, 2, 3, 4, 5].map((i) => [(0x32 >> i) & 1, (0x2c >> i) & 1]);
  const clip = corners.map(([cx, cy]) => {
    const t = [(nx + cx * page) / size, (ny + cy * page) / size];
    return [t[0] * 2 - 1, 1 - t[1] * 2];
  });
  // Clip to pixels: the viewport is the whole target.
  const xs = clip.map(([x]) => ((x + 1) / 2) * size),
    ys = clip.map(([, y]) => ((1 - y) / 2) * size);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const load = (px: number, py: number) => [px + wx - nx, py + wy - ny, wl];
  return { box, load };
}

test('the move draw covers the new page exactly and reads the same texel of the old one', () => {
  assert.match(PAGE_MOVE_SHADER, /corner=vec2f\(f32\(\(0x32u>>i\)&1u\),f32\(\(0x2cu>>i\)&1u\)\)/);
  assert.match(PAGE_MOVE_SHADER, /vec2i\(m\.was\.xy\)-vec2i\(m\.now\.xy\)/);
  const words = shadowPageMoves(new Int32Array([-1, 4]), 3, 2);
  const { box, load } = drawn(words);
  assert.deepEqual(
    box,
    [0, 0, SHADOW_PAGE, SHADOW_PAGE],
    'page 4 of a 2-page side: the first of layer 1',
  );
  // Page 1 of a 3-page side: column 1, row 0. Its texel (5, 7) lands on (5, 7) of the new page.
  assert.deepEqual(load(5, 7), [SHADOW_PAGE + 5, 7, 0]);
});
