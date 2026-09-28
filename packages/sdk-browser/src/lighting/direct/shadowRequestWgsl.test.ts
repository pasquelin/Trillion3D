// #966 (OMB-21): granted `subgroups`, the resolve asks for a shadow page once per subgroup and
// distinct page, not once per lane — and asks for exactly the pages the per-lane path asks for.
// The shaders cannot run under node: the texts are read for the claim and the election they
// ship, and the election is replayed on subgroups of 4 to 64 lanes against the per-lane path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANE_REQUEST_WGSL,
  shadowRequestWgsl,
  withSubgroupShadowRequests,
} from './shadowRequestWgsl.ts';
import { DIRECT_LIGHTING_SHADER } from '../deferred/shaders.ts';
import { createDeferredLighting } from '../deferred/deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const SUBGROUP_SHADER = withSubgroupShadowRequests(DIRECT_LIGHTING_SHADER);
/** The text of function `name` in `source`, from its signature to its closing brace. */
function declared(source: string, name: string) {
  const start = source.indexOf(`fn ${name}(`);
  assert.ok(start >= 0, `no function ${name}`);
  let end = source.indexOf('{', start),
    depth = 0;
  do depth += { '{': 1, '}': -1 }[source[end++]] ?? 0;
  while (depth);
  return source.slice(start, end);
}

test('the per-lane request stays the fallback, and the subgroup one claims with its very text', () => {
  assert.ok(DIRECT_LIGHTING_SHADER.includes(LANE_REQUEST_WGSL));
  assert.doesNotMatch(DIRECT_LIGHTING_SHADER, /subgroup/);
  assert.match(SUBGROUP_SHADER, /^enable subgroups;\ndiagnostic\(off,subgroup_uniformity\);/);
  assert.equal(
    declared(SUBGROUP_SHADER, 'shadowClaimPage'),
    LANE_REQUEST_WGSL.replace('requestShadowPage', 'shadowClaimPage'),
  );
  // A helper lane leaves before the election; then one lane per distinct page claims it.
  assert.match(
    declared(SUBGROUP_SHADER, 'requestShadowPage'),
    /\{\s*if\(!shadowRequesting\)\{return;\}\s*loop\{\s*let first=subgroupBroadcastFirst\(e\);\s*if\(e==first\)\{\s*if\(subgroupElect\(\)\)\{shadowClaimPage\(e\);\}\s*return;\s*\}\s*\}\s*\}$/,
  );
  assert.throws(() => withSubgroupShadowRequests(shadowRequestWgsl(null)), /ABSENT/);
});

test('the resolve clears `shadowRequesting` on a lane past its target: a helper invocation', () => {
  assert.match(DIRECT_LIGHTING_SHADER, /var<private> shadowRequesting:bool=true;/);
  assert.match(
    DIRECT_LIGHTING_SHADER,
    /shadowRequesting=all\(vec2u\(pixel\.xy\)<textureDimensions\(depth\)\);/,
  );
});

/** The request buffer: count, list of `cap` pages, one bit per entry, and the global atomics. */
function requestBuffer(cap: number) {
  const buffer = { count: 0, list: [] as number[], bits: new Set<number>(), atomics: 0 };
  /** `LANE_REQUEST_WGSL`'s claim: a helper's atomics touch nothing. */
  const claim = (e: number, helper: boolean) => {
    buffer.atomics++;
    if (helper || buffer.bits.has(e)) return;
    buffer.bits.add(e);
    buffer.atomics += 2;
    const at = buffer.count++;
    if (at < cap) buffer.list[at] = e;
  };
  return { buffer, claim };
}

type Lane = { e: number; helper: boolean };
/** The subgroup request over one set of active lanes, lowest first: `guarded` false replays it
 *  without the helper test, to show what that test is for. */
function electAndClaim(lanes: Lane[], claim: (e: number, helper: boolean) => void, guarded = true) {
  let left = guarded ? lanes.filter((lane) => !lane.helper) : lanes;
  while (left.length) {
    const first = left[0].e,
      asking = left.filter((lane) => lane.e === first);
    claim(first, asking[0].helper);
    left = left.filter((lane) => lane.e !== first);
  }
}

/** A deterministic generator: the same frames on every run. */
function random(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

test('the requested page set is the per-lane one on subgroups of 4 to 64 lanes', () => {
  const next = random(966);
  for (const size of [4, 8, 16, 32, 64]) {
    for (let frame = 0; frame < 200; frame++) {
      // Few distinct pages, many lanes on each; a cap sometimes short of them all; lanes of a
      // subgroup inactive (returned early) or helpers; a device that splits the active lanes.
      const pages = 1 + Math.floor(next() * 3 * size),
        cap = next() < 0.3 ? Math.floor(next() * pages) : 4 * size;
      const lanes = (1 + Math.floor(next() * 8)) * size;
      const lane = requestBuffer(cap),
        subgroup = requestBuffer(cap);
      for (let base = 0; base < lanes; base += size) {
        const group: Lane[] = [];
        for (let i = 0; i < size; i++) {
          if (next() < 0.1) continue;
          const asked = { e: Math.floor(next() * pages) * 37, helper: next() < 0.1 };
          lane.claim(asked.e, asked.helper);
          group.push(asked);
        }
        const split = next() < 0.5 ? group.length : Math.floor(next() * group.length);
        electAndClaim(group.slice(0, split), subgroup.claim);
        electAndClaim(group.slice(split), subgroup.claim);
      }
      const a = lane.buffer,
        b = subgroup.buffer;
      assert.deepEqual([...b.bits].sort(), [...a.bits].sort(), `size ${size} frame ${frame}`);
      assert.equal(b.count, a.count);
      if (a.count <= cap) assert.deepEqual([...b.list].sort(), [...a.list].sort());
      assert.ok(b.atomics <= a.atomics);
    }
  }
});

test('one claim per distinct page and subgroup: the atomics a whole subgroup on one page saves', () => {
  for (const size of [4, 16, 64]) {
    const lane = requestBuffer(8),
      subgroup = requestBuffer(8);
    const group = Array.from({ length: size }, (_, i) => ({ e: 5 + (i & 1), helper: false }));
    for (const { e } of group) lane.claim(e, false);
    electAndClaim(group, subgroup.claim);
    assert.equal(lane.buffer.atomics, size + 4);
    assert.equal(subgroup.buffer.atomics, 2 + 4);
  }
});

test('without the helper test, an elected helper loses the page of the pixels beside it', () => {
  const group = [
    { e: 9, helper: true },
    { e: 9, helper: false },
  ];
  const guarded = requestBuffer(4),
    unguarded = requestBuffer(4);
  electAndClaim(group, guarded.claim);
  electAndClaim(group, unguarded.claim, false);
  assert.deepEqual([...guarded.buffer.bits], [9]);
  assert.deepEqual([...unguarded.buffer.bits], []);
});

test('the contract program asks per subgroup exactly when the device granted `subgroups`', async () => {
  for (const features of [[], ['subgroups']] as GPUFeatureName[][]) {
    const { device } = fakeDevice({ features }),
      codes: string[] = [],
      create = device.createShaderModule.bind(device);
    device.createShaderModule = (descriptor) => (codes.push(descriptor.code), create(descriptor));
    const lighting = await createDeferredLighting(device),
      view = {} as GPUTextureView,
      surface = { views: () => [view, view, view, view] } as unknown as SurfaceBuffer;
    lighting.bind(surface, view, view, true);
    await lighting.settle();
    const contract = codes.filter((code) => code.includes('fn requestShadowPage('));
    assert.deepEqual(contract, [features.length ? SUBGROUP_SHADER : DIRECT_LIGHTING_SHADER]);
  }
});
