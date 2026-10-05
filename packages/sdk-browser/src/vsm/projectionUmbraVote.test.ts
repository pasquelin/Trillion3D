// The umbra vote of the adaptive ray count (`rayCountWgsl`, `traceWgsl.ts`) is asked at the
// adaptive count alone. Past it, a half its vote did not stop holds a lane that missed, which votes
// no at every later ray (`missCount` never falls) and so is never stopped; a half it stopped has no
// lane left running. The shipped `vsmTraceSun` and `vsmTraceLocal` run here for whole groups, lane
// by lane in lock-step — each vote answered from what its half (`vsmVoteAllTrue`) or the group
// (`vsmGroupVoted`) gave at the same call, replayed until that no longer changes — over generated
// hits, narrow occluders, proven first rays, lanes out of the light and a point light's face
// crossings: every lane gets the result the trace gives with the umbra vote asked at every ray.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { IDENTITY, constructors, unit } from './pageWorld.fixture.ts';
import { vsmLayout } from './resources.ts';
import { vsmProjectionWgsl } from './projectionWgsl.ts';

const LAYOUT = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27);
const SHIPPED = vsmProjectionWgsl(LAYOUT, { subgroups: false });
const STRUCTS = constructors(SHIPPED);
const AT_COUNT = 'else if(i==u32(settings.voteAfter)){halfStops=';
/** The traces with the umbra vote asked at every ray from the adaptive count on. */
const EVERY_RAY = SHIPPED.replaceAll(AT_COUNT, 'else if(i>=u32(settings.voteAfter)){halfStops=');

type Result = { valid: boolean; shadowFactor: number; rayCount: number };
type Trace = (...args: unknown[]) => Result;
/** The lane running, its group's case, its ray and its cube-face reads in that ray. */
type Cursor = { lane: number; group: number; ray: number; face: number };
const NO = [0, 0, 0];
/** A map's record: no shift, no dither, an identity projection. */
const PD = {
  ...{ ditherTexels: 0, mapLevel: 0, levelBias: 0, originShiftHigh: NO, originShiftLow: NO },
  ...{ lightViewToClip: IDENTITY, shiftedToMapUv: IDENTITY },
};

/** Whether ray `ray` of group `g`'s lane `lane` hits: a chance its half often shares (all, none,
 *  most, few, half). */
const CHANCES = [0, 1, 1, 0.5, 0.9, 0.1];
const hits = (g: number, lane: number, ray: number) => {
  const kind = unit(g, lane >> 5, 1) < 0.6 ? unit(g, lane >> 5, 2) : unit(g, lane, 3);
  return unit(g, lane, ray, 4) < CHANCES[Math.floor(kind * CHANCES.length)];
};
const participating = (g: number, lane: number) => unit(g, lane, 5) > 0.1;
const settings = (g: number) => ({
  voteAfter: 1 + (g % 3),
  rayCount: [7, 4, 2][Math.floor(g / 3) % 3],
  stepsPerRay: 8,
  slopeCapSetting: 5,
  ditherTexels: 0,
});

/** The sun's trace of `code` at a lane: its spread one pixel per 0.1 of occluder depth, so an
 *  occluder under 0.1 from the receiver is narrow (`vsmSunRaySpread`). */
function sun(code: string, votes: object, at: Cursor) {
  const { vsmTraceSun } = shaderRun<{ vsmTraceSun: Trace }>(
    code,
    ['vsmTraceSun', 'vsmEmptyTrace'],
    {
      ...STRUCTS,
      ...votes,
      vsmTraceSetupSun: () => settings(at.group),
      vsmHandleFromIdDirectional: (id: number) => ({ id }),
      vsmMappedLevel: (h: unknown) => h,
      vsmHandleIsValid: () => true,
      vsmHandleInvalid: () => ({ id: -1 }),
      vsmProjectionOf: () => PD,
      vsmSunRaySpread: () => [10, 0],
      vsmView: { shiftedToView: IDENTITY, originShiftHigh: NO, originShiftLow: NO, frameIndex: 0 },
      vsm: { traceReachSun: 1.5 },
      vsmSunDepthGradientUv: () => [0, 0],
      vsmSubtractHighLow: () => NO,
      vsmRayNoise4: (_p: unknown, _f: unknown, i: number) => ((at.ray = i), [0.5, 0.5, 0.5, 0.5]),
      vsmSunDiskRayDirection: (d: number[]) => d,
      vsmSunRayBegin: () => ({}),
      // The proof accepts half the first rays that miss: never one the march hits.
      vsmSunRayMisses: () => !hits(at.group, at.lane, at.ray) && unit(at.group, at.lane, 6) < 0.5,
      vsmMarchSun: () => ({
        hitFound: hits(at.group, at.lane, at.ray),
        occluderDepth: 0.5 + (unit(at.group, at.lane, at.ray, 7) - 0.5) * 0.5,
      }),
    },
  );
  const light = { direction: [0, 1, 0], sourceRadius: 0.005 };
  return (lane: number) =>
    vsmTraceSun(0, light, [lane, 0], [0, 0, 0.5], 0, 0.5, [0, 1, 0], participating(at.group, lane));
}

/** A local light's trace of `code` at a lane: a spot, or a point light whose rays cross from one
 *  cube face to another at random. */
function local(code: string, votes: object, at: Cursor, spot: boolean) {
  const { vsmTraceLocal } = shaderRun<{ vsmTraceLocal: Trace }>(
    code,
    ['vsmTraceLocal', 'vsmEmptyTrace'],
    {
      ...STRUCTS,
      ...votes,
      vsmTraceSetupLocal: () => settings(at.group),
      vsmHandleFromId: (id: number) => ({ id }),
      vsmHandleOffset: (h: { id: number }, k: number) => ({ id: h.id + k }),
      vsmHandleInvalid: () => ({ id: -1 }),
      // The light's face, then each ray's start and end faces.
      vsmCubeFace: () =>
        at.ray < 0 || at.face++ === 0 ? 0 : +(unit(at.group, at.lane, at.ray, 8) < 0.3),
      vsmProjectionOf: () => PD,
      vsmSubtractHighLow: () => NO,
      vsmLocalDepthGradientUv: () => [0, 0],
      vsmReceiverPixelSize: () => 0.01,
      vsm: { tracePlaneBiasCapLocal: 1 },
      vsmFrameAround: () => ({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }),
      vsmIntoFrame: (_m: unknown, v: number[]) => v,
      vsmLocalMipAt: () => 0,
      vsmView: { frameIndex: 0 },
      vsmRayNoise4: (...a: number[]) => ((at.ray = a[2]), (at.face = 0), [0.5, 0.5, 0.5, 0.5]),
      vsmSquareToDiskFast: () => [0, 0],
      vsmOutOfFrame: (v: number[]) => v,
      vsmLocalRayReach: () => 0.75,
      vsmFaceRayBegin: () => ({}),
      vsmCrossFaceRayBegin: () => ({}),
      vsmMarchFace: () => ({ hitFound: hits(at.group, at.lane, at.ray) }),
      vsmMarchCrossFace: () => ({ hitFound: hits(at.group, at.lane, at.ray) }),
      vsmNextRayJitter: (seed: number) => seed,
    },
  );
  const light = {
    ...{ shiftedPosition: [0, 3, 0], invRadius: 0.1, direction: [0, -1, 0], sourceRadius: 0.1 },
    ...{ spotAngles: spot ? [0.5, 2] : [-2, 1], mapId: 0, kind: spot ? 2 : 1 },
  };
  return (lane: number) =>
    vsmTraceLocal(0, light, [lane, 0], 2, NO, 0.01, 0.5, [0, 0, 1], participating(at.group, lane));
}

type Kind = (code: string, votes: object, at: Cursor) => (lane: number) => Result;
const KINDS: [string, Kind][] = [
  ['sun', sun],
  ['spot', (code, votes, at) => local(code, votes, at, true)],
  ['point', (code, votes, at) => local(code, votes, at, false)],
];

/** Group `group`'s 64 results through `code`, and the votes each lane asked. */
function lockStep(code: string, kind: Kind, at: Cursor, group: number) {
  let before: boolean[][] = [],
    asked: boolean[][] = [],
    call = 0;
  const answer = (c: boolean, half: boolean) => {
    const k = call++;
    (asked[at.lane] ??= [])[k] = c;
    let all = true;
    for (let lane = 0; lane < 64; lane++)
      if (!half || lane >> 5 === at.lane >> 5) all &&= before[lane]?.[k] ?? c;
    return all;
  };
  const votes = {
    vsmVoteAllTrue: (c: boolean) => answer(c, true),
    vsmGroupVoted: (c: boolean) => answer(c, false),
  };
  const trace = kind(code, votes, at);
  at.group = group;
  for (let turn = 0; turn < 80; turn++) {
    asked = [];
    const results = Array.from({ length: 64 }, (_, lane) => {
      Object.assign(at, { lane, ray: -1, face: 0 });
      call = 0;
      return trace(lane);
    });
    if (JSON.stringify(asked) === JSON.stringify(before)) {
      const calls = new Set(results.map((_, lane) => asked[lane]?.length ?? 0));
      assert.equal(calls.size, 1, 'every lane asks the same votes: they are in uniform flow');
      return { results, votes: [...calls][0] };
    }
    before = asked;
  }
  throw new Error(`group ${group}: the votes never settle`);
}

test('the umbra vote is asked at the adaptive count alone, in both traces', () => {
  assert.equal(SHIPPED.split(AT_COUNT).length, 3);
  assert.doesNotMatch(SHIPPED, /i>=u32\(settings\.voteAfter\)/);
});

test('no lane gets another result than with the umbra vote asked at every ray', () => {
  const at: Cursor = { lane: 0, group: 0, ray: -1, face: 0 };
  for (const [name, kind] of KINDS) {
    let saved = 0,
      umbra = 0,
      full = 0;
    for (let group = 0; group < 54; group++) {
      const shipped = lockStep(SHIPPED, kind, at, group),
        every = lockStep(EVERY_RAY, kind, at, group);
      assert.deepEqual(shipped.results, every.results, `${name}, group ${group}`);
      saved += every.votes - shipped.votes;
      const { rayCount, voteAfter } = settings(group);
      for (const r of shipped.results) {
        umbra += +(r.rayCount === voteAfter + 1 && r.rayCount < rayCount && r.shadowFactor === 0);
        full += +(r.rayCount === rayCount);
      }
    }
    // Lanes the umbra vote stopped, lanes that traced every ray, and votes no longer asked.
    assert.ok(umbra > 100 && full > 500 && saved > 50, `${name}: ${umbra}, ${full}, ${saved}`);
  }
});
