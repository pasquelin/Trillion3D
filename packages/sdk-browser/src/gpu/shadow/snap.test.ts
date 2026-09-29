// #1016 (#26 step C): the viewport adds the physical page's origin — up to thousands of texels —
// to each sun corner in f32, then the rasterizer snaps to 1/256 of a texel. Unsnapped, the sum
// rounds its fraction differently at each origin, so a page drew other edges wherever the pool
// placed it, and the moving A/A kept 1-13 px on sponza. Snapped first, the sum is exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

type Vec = { x: number; y: number; z: number; w: number };
const f = Math.fround;
const vec4f = (x: number, y: number, z: number, w: number): Vec => ({ x, y, z, w });
/** A pool layer's side, in texels: every origin below lies in it. */
const POOL = 8192;
/** The shipped `sunSnap`, over a face whose matrix is `viewProjection` and viewport `side` texels,
 *  in a pool `POOL` texels wide. */
const sunSnap = (viewProjection: Vec[], side: number) =>
  shaderFunctions<{ sunSnap: (p: Vec) => Vec }>(SHADOW_DEPTH_SHADER, ['snapGrid', 'sunSnap'], {
    vec4f,
    abs: Math.abs,
    shadow: { viewProjection, params: vec4f(0, 0, f(side / POOL), side) },
  }).sunSnap;
/** Where the rasterizer puts clip `x` of a page at `origin`, relative to that origin. */
const placed = (x: number, origin: number) => {
  const half = SHADOW_PAGE / 2;
  const window = f(f(origin + half) + f(x * half));
  return Math.round((window - origin) * 256) / 256;
};
const ORTHO = [vec4f(1, 0, 0, 0), vec4f(0, 1, 0, 0), vec4f(0, 0, 1, 0), vec4f(0, 0, 0, 1)];
const ORIGINS = [0, 128, 2944, 6272, POOL - SHADOW_PAGE];

test('an orthographic corner snapped by its viewport rasterizes alike at every page origin', () => {
  const snap = sunSnap(ORTHO, SHADOW_PAGE);
  let moved = 0;
  for (let i = 0; i < 20000; i++) {
    const x = f(Math.sin(i * 12.9898) * 1.3);
    if (new Set(ORIGINS.map((o) => placed(x, o))).size > 1) moved++;
    const snapped = f(snap(vec4f(x, 0, 0.5, 1)).x);
    assert.equal(new Set(ORIGINS.map((o) => placed(snapped, o))).size, 1, `corner ${x}`);
  }
  assert.ok(moved > 0, 'unsnapped, some corners land elsewhere at another origin');
  assert.match(SHADOW_DEPTH_SHADER, /out\.position=sunSnap\(shadow\.viewProjection\*/);
});

// #1016 review: the snap keyed on `w == 1` per corner; it follows the face's projection kind, and
// its step the viewport the face declares, not a constant beside it.
test('the snap follows the face: a perspective face is left as is, the step is its viewport', () => {
  const perspective = [...ORTHO.slice(0, 2), vec4f(0, 0, 1, -1), vec4f(0, 0, 0, 0)];
  const corner = vec4f(0.123456, -0.654321, 0.5, 1);
  assert.deepEqual(sunSnap(perspective, SHADOW_PAGE)(corner), corner, 'a lamp face, w 1 or not');
  const half = sunSnap(ORTHO, SHADOW_PAGE / 2)(corner);
  assert.equal((half.x * (SHADOW_PAGE / 2) * 128) % 1, 0, 'snapped to its own viewport');
  assert.notEqual(half.x, sunSnap(ORTHO, SHADOW_PAGE)(corner).x);
});

// #1016 measure ko: an ordinary corner lies within the pool's f32 subtexel, so the snap takes the
// constant step without `snapGrid`'s loop or a division per axis — the fast path a moving camera's
// every redrawn caster vertex walks.
test('a corner within the pool snaps on the constant subtexel step', () => {
  const snap = sunSnap(ORTHO, SHADOW_PAGE);
  const step = (SHADOW_PAGE / 2) * 256;
  for (let i = 0; i < 2000; i++) {
    const x = f(Math.sin(i * 4.1357) * 0.9);
    assert.equal(snap(vec4f(x, 0, 0.5, 1)).x, Math.round(x * step) / step, `corner ${x}`);
  }
  // Only a corner past the pool's f32 subtexel reaches `snapGrid`.
  assert.match(SHADOW_DEPTH_SHADER, /let rx=abs\(p\.x\)\*half\+pool;.*if\(rx>=edge\)/s);
});

// #1016: a caster whose sphere touches a page is drawn whole (`cullShader.ts`), and a flat floor's
// corner can lie tens of thousands of texels past the page. There the viewport's f32 sum steps by
// more than the 1/256 snap, and rounded that corner by the page's origin: the snap takes the f32
// step at the farthest origin of the pool, the same wherever the page lies.
test('a corner far past its page rasterizes alike at every page origin of the pool', () => {
  const snap = sunSnap(ORTHO, SHADOW_PAGE);
  for (let i = 0; i < 20000; i++) {
    const x = f(Math.sin(i * 78.233) * 1200);
    const snapped = f(snap(vec4f(x, 0, 0.5, 1)).x);
    assert.equal(new Set(ORIGINS.map((o) => placed(snapped, o))).size, 1, `corner ${x}`);
    assert.ok(Math.abs(snapped - x) * (SHADOW_PAGE / 2) <= 1 / 64, 'moved less than the f32 step');
  }
});
