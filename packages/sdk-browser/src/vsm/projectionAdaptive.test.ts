// The sun's adaptive ray count (`rayCountWgsl`): a lane whose first ray hit an occluder whose rays
// stay within a pixel stops there alone, whatever its half; a half none of whose lanes hit a wider
// one stops after one ray (lit); one whose rays all hit stops after the second (umbra); a lane in a
// wide penumbra, or that missed beside a lane that hit a wide one, traces all seven. The shipped
// projection's `vsmTraceSun` is run with its traces stubbed and the half's vote given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { IDENTITY } from './pageWorld.fixture.ts';
import { vsmLayout } from './resources.ts';
import { vsmProjectionWgsl } from './projectionWgsl.ts';
import { VSM_TRACE_VOTE_AFTER, VSM_TRACE_RAYS_SUN } from './constants.ts';

const CODE = vsmProjectionWgsl(vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27), {
  subgroups: false,
});

/** Rays one lane traces, and its result, when each ray `hits(i)` an occluder `depth` above the
 *  receiver's 0.5 (spread: one pixel per 0.1 of depth, `vsmSunRaySpread`) and the rest of its half
 *  votes `others` (true: agrees with any vote; false: holds every vote back). */
function trace(hits: (i: number) => boolean, others: boolean, depth = 0.5) {
  let rays = 0,
    ray = 0;
  const { vsmTraceSun } = shaderRun<{
    vsmTraceSun: (...a: unknown[]) => { shadowFactor: number; rayCount: number };
  }>(CODE, ['vsmTraceSun', 'vsmEmptyTrace'], {
    vsmTraceSetupSun: () => ({
      voteAfter: VSM_TRACE_VOTE_AFTER,
      rayCount: VSM_TRACE_RAYS_SUN,
      stepsPerRay: 8,
      slopeCapSetting: 5,
      ditherTexels: 0,
    }),
    vsmHandleFromIdDirectional: (id: number) => ({ id }),
    vsmMappedLevel: (handle: unknown) => handle,
    vsmHandleIsValid: () => true,
    vsmHandleInvalid: () => ({ id: -1 }),
    vsmProjectionOf: () => ({
      ditherTexels: 0,
      mapLevel: 0,
      levelBias: 0,
      originShiftHigh: [0, 0, 0],
      originShiftLow: [0, 0, 0],
      lightViewToClip: IDENTITY,
      shiftedToMapUv: IDENTITY,
    }),
    vsmSunRaySpread: () => [10, 0],
    vsmView: {
      shiftedToView: IDENTITY,
      originShiftHigh: [0, 0, 0],
      originShiftLow: [0, 0, 0],
    },
    vsm: { traceReachSun: 1.5 },
    vsmTexelsAtLevel: () => 16384,
    vsmSunDepthGradientUv: () => [0, 0],
    vsmSubtractHighLow: () => [0, 0, 0],
    vsmRayNoise4: () => [0.5, 0.5, 0.5, 0.5],
    vsmSunDiskRayDirection: (d: number[]) => d,
    vsmSunRayBegin: () => ({ levelMap: { id: 0 }, sunUvzStart: [0, 0, 0.5] }),
    // The first ray's proof (`vsmSunRayMisses`) proves nothing here: every ray is marched.
    vsmSunRayMisses: () => false,
    vsmMarchSun: () => {
      rays++;
      return { hitFound: hits(ray++), occluderDepth: 0.5 + depth };
    },
    VsmTraceResult: (valid: boolean, shadowFactor: number, rayCount: number) => ({
      valid,
      shadowFactor,
      rayCount,
    }),
    vsmVoteAllTrue: (mine: boolean) => mine && others,
    vsmGroupVoted: (voted: boolean) => voted,
  });
  const light = { direction: [0, 1, 0], sourceRadius: 0.005 };
  const r = vsmTraceSun(0, light, [3, 4], [0, 0, 0.5], 0, 0.5, [0, 1, 0], true);
  return { rays, factor: r.shadowFactor, rayCount: r.rayCount };
}

test('a lit half stops after its first ray, an umbra after its second', () => {
  assert.deepEqual(
    trace(() => false, true),
    { rays: 1, factor: 1, rayCount: 1 },
  );
  assert.deepEqual(
    trace(() => true, true),
    { rays: 2, factor: 0, rayCount: 2 },
  );
});

test('a lane in penumbra, or a neighbour that disagrees, traces all seven rays', () => {
  const all = VSM_TRACE_RAYS_SUN;
  assert.deepEqual(
    trace((i) => i % 2 === 0, true),
    { rays: all, factor: 3 / 7, rayCount: all },
  );
  assert.equal(trace(() => false, false).rays, all);
  assert.equal(trace(() => true, false).rays, all);
});

test('a lane whose first ray hit an occluder within a pixel stops there, whatever its half', () => {
  for (const others of [true, false]) {
    // 0.0625 deep: 0.625 pixel; 0.125: 1.25 pixels, not within.
    assert.deepEqual(
      trace(() => true, others, 0.0625),
      { rays: 1, factor: 0, rayCount: 1 },
    );
    assert.deepEqual(
      trace(() => true, others, -0.0625),
      { rays: 1, factor: 0, rayCount: 1 },
    );
    assert.equal(trace(() => true, false, 0.125).rays, VSM_TRACE_RAYS_SUN);
    // A first ray that missed has no occluder of its own: its half decides.
    assert.equal(trace((i) => i > 0, false, 0.0625).rays, VSM_TRACE_RAYS_SUN);
  }
});
