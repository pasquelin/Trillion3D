// The sun's first-ray proof (`vsmSunRayMisses`, `traceWgsl.ts`) is exact: a ray it accepts is
// a ray the march (`vsmMarchSun`) misses, run in the shipped WGSL over made-up worlds
// (`projectionEarlyOut.fixture.ts`) — pages mapped, unmapped and falling back across levels, rays
// across page and tile edges and past the clipmap's, reference depths meeting the pool's exactly,
// words no depth is. Then whole pixels: the trace with its proof gives every pixel the mask word
// the trace without it does. The tile depths it reads are `tileDepth.test.ts`'s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts';
import { CODE, IDENTITY, ref, unit } from './pageWorld.fixture.ts';
import {
  earlyOutWorld,
  rayRun,
  type RayState,
  RAY_FUNCTIONS,
} from './projectionEarlyOut.fixture.ts';
import { VSM_SINGLE_PAGE_MAP_SLOTS } from './constants.ts';

const PAGE = 1 / 128;
/** Ray `k` of world `seed`: a level of the sun, a start anywhere (on page corners, across the
 *  clipmap's edge), a reach of a fifth of a page to four, a reference depth on the 2^-10 grid. */
function ray(seed: number, k: number): RayState {
  const r = (j: number) => unit(seed, k, j);
  const kind = k % 3,
    start =
      kind === 0
        ? [r(1) * 1.03 - 0.015, r(2) * 1.03 - 0.015]
        : kind === 1
          ? [Math.round(r(1) * 128) * PAGE, Math.round(r(2) * 128) * PAGE]
          : [0.99 + r(1) * 0.02, r(2)],
    reach = [0.2, 1.2, 4][k % 3] * PAGE;
  return {
    levelMap: { id: VSM_SINGLE_PAGE_MAP_SLOTS + 3 + (k % 24), isSinglePage: false },
    sunUvzStart: [...start, Math.round((0.2 + 0.75 * r(5)) * 1024) / 1024],
    sunUvzStep: [(r(3) - 0.5) * 2 * reach, (r(4) - 0.5) * 2 * reach, -0.05 + 0.45 * r(6)],
    slopeCap: 0.02 * r(7),
  };
}

test('a first ray the proof accepts, the march misses: 24 000 rays over six worlds', () => {
  let accepted = 0,
    missed = 0,
    rays = 0,
    tiles = 0,
    pool = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const world = earlyOutWorld(seed),
      run = rayRun(world.scope);
    for (let k = 0; k < 4000; k++, rays++) {
      const steps = k % 7 === 0 ? k % 13 : 8,
        offset = unit(seed, k, 8),
        extrapolate = k % 2 === 0;
      const before = { ...world.reads },
        proof = run.vsmSunRayMisses(ref(ray(seed, k)), steps, offset);
      tiles += world.reads.tiles - before.tiles;
      const hit = run.vsmMarchSun(ref(ray(seed, k)), steps, offset, extrapolate).hitFound;
      if (proof) assert.equal(hit, false, `world ${seed} ray ${k}: accepted, the march hits`);
      accepted += +proof;
      missed += +!hit;
      pool += world.reads.pool - before.pool;
    }
  }
  // Both answers often enough to mean something; the proof reads no pool word, and under half the
  // words the march does.
  assert.ok(accepted > rays * 0.2 && accepted < missed, `${accepted} of ${missed} misses`);
  assert.ok(tiles * 2 < pool, `${tiles} tile words against ${pool} pool words`);
});

/** A level 12 m wide: world (x, y, z) at UV (0.5 + x / 12, 0.5 + y / 12), depth 0.5 + z / 80. */
const TO_UV = new Mat([1 / 12, 0, 0, 0, 0, 1 / 12, 0, 0, 0, 0, 1 / 80, 0, 0.5, 0.5, 0.5, 1]);
/** An orthographic view 12 m wide at 96 pixels (12.5 cm a pixel), down the light: an occluder under
 *  about 13 m spreads the sun's rays over less than a pixel. */
const VIEW_TO_CLIP = new Mat([1 / 6, 0, 0, 0, 0, 1 / 6, 0, 0, 0, 0, 1 / 80, 0, 0, 0, 0.5, 1]);

/** The sun's traces at `pixels` pixels of world `seed`, the first ray's proof on or off, each
 *  lane's half voting with it (`agree`) or holding every vote back. `rays`: the trace as shipped
 *  (`adaptive`), with no ray spread known to stay within a pixel (`wide`: the count before the
 *  penumbra test), or its first ray alone (`one`). */
function traces(
  seed: number,
  pixels: number,
  proof: boolean,
  agree: boolean,
  rays: 'adaptive' | 'wide' | 'one' = 'adaptive',
) {
  const world = earlyOutWorld(seed);
  const pd = (h: object) => ({
    handle: h,
    ditherTexels: 1,
    mapLevel: 10,
    levelBias: -1.5,
    shiftedToMapUv: TO_UV,
    planesToMapUv: TO_UV,
    lightViewToClip: TO_UV,
    originShiftHigh: [0, 0, 0],
    originShiftLow: [0, 0, 0],
  });
  const names = [
    'vsmTraceSun',
    'vsmEmptyTrace',
    'vsmMaskCode',
    'vsmHandleFromIdDirectional',
    'vsmHandleIsValid',
    'vsmSunDepthGradientUv',
    'vsmSubtractHighLow',
    'vsmSunRayBegin',
    'vsmSunTexelPlaneBias',
    ...(rays === 'wide' ? [] : ['vsmSunRaySpread', 'vsmAcrossLightOnScreen', 'vsmFrameAround']),
    ...RAY_FUNCTIONS.filter((name) => proof || name !== 'vsmSunRayMisses'),
  ];
  const { vsmTraceSun, vsmMaskCode } = shaderRun<{
    vsmTraceSun: (...a: unknown[]) => object;
    vsmMaskCode: (r: object) => number;
  }>(CODE, names, {
    ...world.scope,
    ...(proof ? {} : { vsmSunRayMisses: () => false }),
    ...(rays === 'wide' ? { vsmSunRaySpread: () => [3.4e38, 3.4e38] } : {}),
    vsmView: {
      shiftedToView: IDENTITY,
      viewToClip: VIEW_TO_CLIP,
      viewPixels: [96, 96, 1 / 96, 1 / 96],
      frameIndex: 3,
      originShiftHigh: [0, 0, 0],
      originShiftLow: [0, 0, 0],
    },
    vsmTraceSetupSun: () => ({
      voteAfter: 1,
      rayCount: rays === 'one' ? 1 : 7,
      stepsPerRay: 8,
      slopeCapSetting: 5,
      ditherTexels: 2,
    }),
    vsmMappedLevel: (h: { id: number }) => ({ id: h.id + 2, isSinglePage: false }),
    vsmProjectionOf: pd,
    vsmRayNoise4: (p: number[], f: number, i: number) =>
      [1, 2, 3, 4].map((k) => unit(seed, ...p, i, k)),
    vsmSunDiskRayDirection: (d: number[], _: number, e: number[]) => {
      const v = [d[0] + 0.06 * (e[0] - 0.5), d[1] + 0.06 * (e[1] - 0.5), d[2]];
      return v.map((x) => x / Math.hypot(...v));
    },
    vsmVoteAllTrue: (c: boolean) => c && agree,
    vsmGroupVoted: (voted: boolean) => voted,
  });
  return Array.from({ length: pixels }, (_, k) => {
    const r = (j: number) => unit(seed, k, j);
    // Points over the level, a depth from 16 m below the grounds to 36 m above.
    const p = [(r(1) - 0.5) * 12, (r(2) - 0.5) * 12, (r(3) - 0.2) * 40];
    const light = { direction: [0, 0, 1], sourceRadius: 0.0047 };
    const result = vsmTraceSun(
      VSM_SINGLE_PAGE_MAP_SLOTS,
      light,
      [k, 7],
      p,
      0.01,
      r(4),
      [0, 0, 1],
      true,
      false,
    );
    return vsmMaskCode(result);
  });
}

test('a pixel traced with the first ray proof gives the mask word it gives without', () => {
  for (const agree of [true, false]) {
    const kept = traces(831, 2000, true, agree);
    assert.deepEqual(kept, traces(831, 2000, false, agree));
    // Lit, shadowed and penumbra words among them.
    assert.ok(new Set(kept).size > 3, `${new Set(kept).size} words`);
  }
});

test('a pixel whose rays spread over a pixel at most takes its first ray; any other, the count before', () => {
  for (const agree of [true, false]) {
    const shipped = traces(1468, 2000, true, agree),
      wide = traces(1468, 2000, true, agree, 'wide'),
      one = traces(1468, 2000, true, agree, 'one');
    let narrow = 0,
      differs = 0;
    shipped.forEach((word, k) => {
      if (word === wide[k]) return;
      // Only a pixel that took its first ray alone where the count before took more.
      assert.equal(word, one[k], `pixel ${k}`);
      narrow++;
      // The two differ in value only where the rays before disagreed: a shadow edge inside the
      // pixel's spread (a word k of n with 0 < k < n).
      const n = wide[k] >> 4,
        missed = wide[k] & 15;
      if ((word & 15) !== (missed === n ? 1 : 0)) {
        assert.ok(missed > 0 && missed < n, `pixel ${k}: ${missed} of ${n}, then ${word & 15}`);
        differs++;
      }
    });
    assert.ok(narrow > 50, `${narrow} pixels took one ray`);
    assert.ok(narrow < 2000 - 50, `${2000 - narrow} pixels kept the count before`);
    assert.ok(differs < narrow, `${differs} of ${narrow} changed value`);
  }
});
