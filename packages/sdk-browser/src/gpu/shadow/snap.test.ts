// #1016 (#26 step C): the viewport adds the physical page's origin — up to thousands of texels —
// to each sun corner in f32, then the rasterizer snaps to 1/256 of a texel. Unsnapped, the sum
// rounds its fraction differently at each origin, so a page drew other edges wherever the pool
// placed it, and the moving A/A kept 1-13 px on sponza. Snapped first, the sum is exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_DEPTH_SHADER, SHADOW_SNAP } from './shader.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

const f = Math.fround;
/** Where the rasterizer puts clip `x` of a page at `origin`, relative to that origin. */
const placed = (x: number, origin: number) => {
  const half = SHADOW_PAGE / 2;
  const window = f(f(origin + half) + f(x * half));
  return Math.round((window - origin) * 256) / 256;
};
const snap = (x: number) => f(Math.round(f(x * SHADOW_SNAP)) / SHADOW_SNAP);

test('a snapped sun corner rasterizes at the same place whatever the page origin', () => {
  let moved = 0;
  for (let i = 0; i < 20000; i++) {
    const x = f(Math.sin(i * 12.9898) * 1.3);
    const origins = [0, 128, 2944, 6272].map((o) => placed(x, o));
    if (new Set(origins).size > 1) moved++;
    const snapped = [0, 128, 2944, 6272].map((o) => placed(snap(x), o));
    assert.equal(new Set(snapped).size, 1, `corner ${x}`);
  }
  assert.ok(moved > 0, 'unsnapped, some corners land elsewhere at another origin');
  assert.match(
    SHADOW_DEPTH_SHADER,
    /if\(out\.position\.w==1\.0\)\{out\.position=vec4f\(round\(out\.position\.xy\*SHADOW_SNAP\)\/SHADOW_SNAP/,
  );
});
