// #831: a shadow page reads the same wherever the pool puts it. A CPU oracle of the WGSL reads
// (`shadowCompare`, the PCF away from a seam, `shadowThrough`), in single precision as the GPU
// runs them, over the comparison filter as Direct3D and Metal build it: the normalised coordinate
// back to texels in single precision, its bilinear weights on `SHADOW_SUBTEXELS` steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { POISSON_16, directShadowWgsl } from './shadowWgsl.ts';
import {
  SHADOW_PAGE as S,
  SHADOW_SUBTEXELS,
  shadowPoolShape,
  shadowPoolSize,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

type Pair = [number, number];
const f = Math.fround;
/** WGSL's `round`: half-way cases to even. */
const roundEven = (v: number) => {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
};
const hash = (x: number) => {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};
/** The page's content: a depth per page-local texel. Anything outside it is another page's. */
const content = (x: number, y: number) => hash(x * 131 + y * 7919 + 17);
const elsewhere = (x: number, y: number) => hash(x * 977 + y * 131071 + 3);

/** A page placed at physical page `k` of a pool of `side²`-page layers: its offset (`shadowOffset`)
 *  for map page `p`, its layer, the pool's texel side, and the atlas that holds it. */
function placed(k: number, side: number, p: Pair) {
  const local = k % side ** 2,
    origin: Pair = [(local % side) * S, Math.floor(local / side) * S];
  const inside = (x: number, y: number) =>
    x >= origin[0] && x < origin[0] + S && y >= origin[1] && y < origin[1] + S;
  return {
    offset: [origin[0] - p[0] * S, origin[1] - p[1] * S] as Pair,
    origin,
    layer: Math.floor(k / side ** 2),
    texels: side * S,
    depth: (x: number, y: number) =>
      inside(x, y) ? content(x - origin[0], y - origin[1]) : elsewhere(x, y),
  };
}
type Placed = ReturnType<typeof placed>;

/** `textureSampleCompareLevel` at `uv`: back to texels in single precision, weights on steps. */
function sampleCompare(at: Placed, uv: Pair, reference: number) {
  const x = uv.map((u) => f(f(u * at.texels) - 0.5));
  const i = x.map(Math.floor),
    w = x.map((v, a) => Math.round((v - i[a]) * SHADOW_SUBTEXELS) / SHADOW_SUBTEXELS);
  const lit = (dx: number, dy: number) => (reference > at.depth(i[0] + dx, i[1] + dy) ? 1 : 0);
  return (
    (1 - w[1]) * ((1 - w[0]) * lit(0, 0) + w[0] * lit(1, 0)) +
    w[1] * ((1 - w[0]) * lit(0, 1) + w[0] * lit(1, 1))
  );
}
/** `shadowCompare` now: `t` snapped to its weight step's centre, then the integer offset. */
const compareNow = (at: Placed, t: Pair, reference: number) =>
  sampleCompare(
    at,
    t.map((v, a) =>
      f(f(at.offset[a] + roundEven(f(v * SHADOW_SUBTEXELS)) / SHADOW_SUBTEXELS) / at.texels),
    ) as Pair,
    reference,
  );
/** Develop's: `(offset.xy+t)/shadowAtlasTexels()`, whose sum rounds on the page's place. */
const compareBefore = (at: Placed, t: Pair, reference: number) =>
  sampleCompare(at, t.map((v, a) => f(f(at.offset[a] + v) / at.texels)) as Pair, reference);
/** The PCF away from a seam: sixteen comparisons around `t`, each at `t + tap` in single precision. */
const pcf = (compare: typeof compareNow) => (at: Placed, t: Pair, reference: number) =>
  POISSON_16.reduce(
    (lit, tap) => lit + compare(at, [f(t[0] + tap[0]), f(t[1] + tap[1])], reference),
    0,
  );

/** Develop's pool at the boss's screen, one layer on a device holding it; #850's layout of the
 *  same pages that shifted 94–184 px; and the sides the pool may take. */
const DEVELOP = shadowPoolShape(shadowPoolSize(3456, 2234), 128).side;
const SIDES = [DEVELOP, shadowPoolShape(shadowPoolSize(3456, 2234)).side, 64, 74, 50];
/** Places of one page at each side: first page, a later one, and one in the second layer. */
const places = (p: Pair) =>
  SIDES.flatMap((side) =>
    [0, side * 17 + 5, side ** 2 + side + 9, side ** 2 - 1].map((k) => placed(k, side, p)),
  );

/** Deterministic receivers inside a page: map page, page-local texel inside the PCF's reach, depth. */
function* receivers(count: number) {
  for (let n = 0; n < count; n++) {
    const p: Pair = [Math.floor(hash(n * 4 + 1) * 16), Math.floor(hash(n * 4 + 2) * 16)];
    const local = [0, 1].map((a) => 1.5 + hash(n * 4 + 3 + a * 7) * (S - 3));
    yield {
      p,
      t: [f(p[0] * S + local[0]), f(p[1] * S + local[1])] as Pair,
      reference: hash(n * 4 + 4),
    };
  }
}

test('the shadow read snaps its texel to the filter step, then adds the page’s integer offset', () => {
  const wgsl = directShadowWgsl(8, null, 18);
  for (const line of [
    ' let at=offset.xy+round(t*SHADOW_SUBTEXELS)/SHADOW_SUBTEXELS;',
    ' return textureSampleCompareLevel(shadowAtlas,shadowSampler,at/f32(textureDimensions(shadowAtlas).x),i32(offset.z),reference);',
    '  for(var tap=0u;tap<PCF_TAPS;tap++){lit+=shadowCompare(offset,t+POISSON[tap],reference);}',
    ' return lit*shadowThrough(offset+vec3f(first,0.0),t-first,reference);',
    ' let i=vec2i(page.xy)/2+vec2i(floor(h));let f=h-floor(h);let l=i32(page.z);',
  ])
    assert.ok(wgsl.includes(line), line);
  assert.equal(
    wgsl.match(/textureSampleCompareLevel\(/g)?.length,
    1,
    'one comparison, in shadowCompare',
  );
});

test('one page gives bit-identical PCF results at any place, layer and pool side', () => {
  let movedBefore = 0;
  for (const { p, t, reference } of receivers(1500)) {
    const [home, ...others] = places(p);
    const now = pcf(compareNow)(home, t, reference),
      before = pcf(compareBefore)(home, t, reference);
    for (const at of others) {
      assert.equal(pcf(compareNow)(at, t, reference), now, `side ${at.texels / S} at ${at.origin}`);
      if (pcf(compareBefore)(at, t, reference) !== before) movedBefore++;
    }
  }
  assert.ok(movedBefore > 0, 'the normalised read of develop changes with the place');
});

test('at develop’s pool size the read is develop’s arithmetic, done exactly', () => {
  // Develop's weights without its sum's rounding: `t + tap − 0.5` on its nearest step, ties to even.
  const exact = (at: Placed, t: Pair, reference: number) =>
    POISSON_16.reduce((lit, tap) => {
      const x = [0, 1].map(
        (a) => roundEven(f(t[a] + tap[a]) * SHADOW_SUBTEXELS) / SHADOW_SUBTEXELS - 0.5,
      );
      const i = x.map(Math.floor),
        w = x.map((v, a) => v - i[a]);
      const hit = (dx: number, dy: number) =>
        reference > at.depth(at.offset[0] + i[0] + dx, at.offset[1] + i[1] + dy) ? 1 : 0;
      return (
        lit +
        (1 - w[1]) * ((1 - w[0]) * hit(0, 0) + w[0] * hit(1, 0)) +
        w[1] * ((1 - w[0]) * hit(0, 1) + w[0] * hit(1, 1))
      );
    }, 0);
  for (const { p, t, reference } of receivers(1500)) {
    const at = placed(DEVELOP * 23 + 11, DEVELOP, p);
    assert.equal(pcf(compareNow)(at, t, reference), exact(at, t, reference));
  }
});

/** `shadowThrough`'s texel and weights at map texel `t`: now from the page's integer origin and the
 *  page-local texel; before from the atlas texel `offset + t`, rounded on the page's place. */
function throughTexel(at: Placed, t: Pair, now: boolean) {
  return [0, 1].map((a) => {
    const first = Math.floor(t[a] / S) * S,
      half = S / 2;
    const h = now
      ? f(Math.min(Math.max(f(0.5 * f(t[a] - first)), 0.5), half - 0.5) - 0.5)
      : (() => {
          const x = f(at.offset[a] + t[a]),
            o = Math.floor(x / S) * half;
          return f(Math.min(Math.max(f(0.5 * x), o + 0.5), o + half - 0.5) - 0.5) - o;
        })();
    return [Math.floor(h), f(h - Math.floor(h))];
  });
}

test('the transmittance layer is read at the same page texels and weights at any place', () => {
  let movedBefore = 0;
  for (const { p, t } of receivers(1500)) {
    const [home, ...others] = places(p);
    const now = JSON.stringify(throughTexel(home, t, true)),
      before = JSON.stringify(throughTexel(home, t, false));
    for (const at of others) {
      assert.equal(JSON.stringify(throughTexel(at, t, true)), now);
      if (JSON.stringify(throughTexel(at, t, false)) !== before) movedBefore++;
    }
  }
  assert.ok(movedBefore > 0, 'develop’s weights change with the place');
});
