// #831: a shadow page reads the same wherever the pool puts it. A CPU oracle of the WGSL reads
// (the PCF away from a seam, `shadowThrough`) in single precision as the GPU runs them, over the
// comparison filter as Direct3D and Metal build it: the normalised coordinate back to texels in
// single precision, its bilinear weights rounded to `SHADOW_SUBTEXELS` steps. The oracle holds the
// filter's rounding as an assumption; the browser proof at two pool sides is what proves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { directShadowWgsl } from './shadowWgsl.ts';
import { SHADOW_SUBTEXELS as STEPS } from './shadowSampleWgsl.ts';
import { pcf, type Sampler, type Stored } from './shadowBias.fixture.ts';
import { throughAxis } from './shadowPages.fixture.ts';
import {
  SHADOW_PAGE as S,
  pageOrigin,
  shadowPoolShape,
  shadowPoolSize,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

type Pair = [number, number];
const f = Math.fround;
const hash = (x: number) => {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};
/** The page's content: a depth per page-local texel. Anything outside it is another page's. */
const content = (x: number, y: number) => hash(x * 131 + y * 7919 + 17);
const elsewhere = (x: number, y: number) => hash(x * 977 + y * 131071 + 3);

/** Physical page `k` of a pool of `side²`-page layers holding map page `p`: its `shadowOffset`,
 *  the layer's side in texels, and the layer's depths as `compare` reads them — nearer is more,
 *  hence negated, as the reference is. */
function placed(k: number, side: number, p: Pair) {
  const { x, y } = pageOrigin(k, side);
  const depth = (u: number, v: number) =>
    u >= x && u < x + S && v >= y && v < y + S ? content(u - x, v - y) : elsewhere(u, v);
  return {
    offset: [x - p[0] * S, y - p[1] * S] as Pair,
    texels: side * S,
    stored: ((u: number, v: number) => -depth(u - 0.5, v - 0.5)) as Stored,
  };
}
type Placed = ReturnType<typeof placed>;

/** The interior PCF of `shadowPcf`: each tap `floor(t·256 + tap·256 + 0.5) / 256` plus the offset,
 *  divided by the layer's side, and back to texels by the filter. */
const shadowRead = (at: Placed): Sampler => ({
  at: (v, tap, a) => {
    const step = Math.floor(f(f(f(v * STEPS) + f(tap * STEPS)) + 0.5));
    return f(f(f(at.offset[a] + step / STEPS) / at.texels) * at.texels);
  },
  steps: STEPS,
});
const read = (at: Placed, t: Pair, reference: number) =>
  pcf(t, at.stored, -reference, 0, shadowRead(at));

/** Develop's pool at the boss's screen, one layer on a device holding it; #850's layout of the
 *  same pages that shifted 94–184 px; and the sides the pool may take. */
const DEVELOP = shadowPoolShape(shadowPoolSize(3456, 2234), 128).side;
const SIDES = [DEVELOP, shadowPoolShape(shadowPoolSize(3456, 2234)).side, 64, 74, 50];
/** Places of one page at each side: first page, a later one, the second layer, the layer's last. */
const places = (p: Pair) =>
  SIDES.flatMap((side) =>
    [0, side * 17 + 5, side ** 2 + side + 9, side ** 2 - 1].map((k) => placed(k, side, p)),
  );

/** Deterministic receivers inside a page: map page, page texel within the PCF's reach, depth. */
const RECEIVERS = Array.from({ length: 400 }, (_, n) => {
  const p: Pair = [Math.floor(hash(n * 4 + 1) * 16), Math.floor(hash(n * 4 + 2) * 16)];
  const local = [0, 1].map((a) => 1.5 + hash(n * 4 + 3 + a * 7) * (S - 3));
  const t: Pair = [f(p[0] * S + local[0]), f(p[1] * S + local[1])];
  return { p, t, reference: hash(n * 4 + 4) };
});

test('the shadow read snaps its texel to the filter step, then adds the page’s integer offset', () => {
  const wgsl = directShadowWgsl(8, null, 18);
  for (const line of [
    ' return shadowSample(offset.xy+floor(t*SHADOW_SUBTEXELS+0.5)*SHADOW_SUBTEXEL,i32(offset.z),shadowAtlasTexels(),reference);',
    '   lit+=shadowSample(offset.xy+floor(steps+POISSON_STEPS[tap]+0.5)*SHADOW_SUBTEXEL,layer,texels,reference);',
    ' return textureSampleCompareLevel(shadowAtlas,shadowSampler,at/texels,layer,reference);',
  ])
    assert.ok(wgsl.includes(line), line);
  assert.equal(wgsl.match(/textureSampleCompareLevel\(/g)?.length, 1, 'one comparison');
});

test('one page gives bit-identical PCF results at any place and pool side, either layer', () => {
  for (const { p, t, reference } of RECEIVERS) {
    const [home, ...others] = places(p);
    const expected = read(home, t, reference);
    for (const at of others)
      assert.equal(read(at, t, reference), expected, `side ${at.texels / S} at ${at.offset}`);
  }
});

test('at develop’s pool size the read is develop’s arithmetic, done exactly', () => {
  // Develop's hardware read at `offset + t + tap` had its sum been exact: the filter's steps of
  // the map texel itself, the same whatever page holds it.
  for (const { p, t, reference } of RECEIVERS) {
    const at = placed(DEVELOP * 23 + 11, DEVELOP, p);
    const exact: Sampler = { at: (v, tap, a) => at.offset[a] + f(v + f(tap)), steps: STEPS };
    assert.equal(read(at, t, reference), pcf(t, at.stored, -reference, 0, exact));
  }
});

test('the transmittance read is develop’s, done exactly, at every place', () => {
  // Develop's `shadowThrough` at atlas texel `offset + t`, in exact arithmetic.
  const develop = (offset: number, t: number) => {
    const a = offset + t,
      o = Math.floor(a / S) * (S / 2);
    const h = Math.min(Math.max(a / 2, o + 0.5), o + S / 2 - 0.5) - 0.5;
    return [Math.floor(h) - o, h - Math.floor(h)];
  };
  for (const { p, t } of RECEIVERS)
    for (const at of places(p))
      for (const a of [0, 1])
        assert.deepEqual(throughAxis(f(t[a] - p[a] * S)), develop(at.offset[a], t[a]));
});
