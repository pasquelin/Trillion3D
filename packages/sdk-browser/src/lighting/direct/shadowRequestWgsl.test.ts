// #966 (OMB-21): granted `subgroups`, the resolve asks for a shadow page once per subgroup and
// distinct page, not once per lane — and asks for exactly the pages the per-lane path asks for.
// The shaders cannot run under node: the texts are pinned, and the election they ship is replayed
// on subgroups of 4 to 64 lanes against the per-lane path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANE_REQUEST_WGSL,
  SUBGROUP_REQUEST_WGSL,
  shadowRequestWgsl,
  withSubgroupShadowRequests,
} from './shadowRequestWgsl.ts';
import { DIRECT_LIGHTING_SHADER } from '../deferred/shaders.ts';
import { createDeferredLighting } from '../deferred/deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { seeded } from '../../../../../site/examples/kit/random.ts';
import { SHADOW_TABLE_ENTRIES } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

const SUBGROUP_SHADER = withSubgroupShadowRequests(DIRECT_LIGHTING_SHADER);

test('the per-lane request stays the fallback; the subgroup one replaces it, feature enabled', () => {
  assert.ok(DIRECT_LIGHTING_SHADER.includes(LANE_REQUEST_WGSL));
  assert.doesNotMatch(DIRECT_LIGHTING_SHADER, /enable subgroups|subgroup[A-Z]/);
  assert.match(SUBGROUP_SHADER, /^enable subgroups;\ndiagnostic\(off,subgroup_uniformity\);/);
  assert.ok(SUBGROUP_SHADER.includes(SUBGROUP_REQUEST_WGSL));
  assert.ok(!SUBGROUP_SHADER.includes(LANE_REQUEST_WGSL));
  assert.throws(() => withSubgroupShadowRequests(shadowRequestWgsl(null)), /ABSENT/);
  // Only a lane the resolve puts in its target is elected: a helper past it claims its own.
  assert.match(DIRECT_LIGHTING_SHADER, /var<private> shadowRequesting:bool=false;/);
  assert.ok(
    DIRECT_LIGHTING_SHADER.includes(
      'shadowRequesting=all(vec2u(pixel.xy)<textureDimensions(depth));',
    ),
  );
});

/** The request buffer — its bits, count and list of `cap` — and the global atomics it took. */
function requestBuffer(cap: number) {
  const buffer = { count: 0, list: [] as number[], bits: new Set<number>(), atomics: 0 };
  /** The claim both paths share (`LANE_REQUEST_WGSL`): a helper's atomics touch nothing. */
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
/** `SUBGROUP_REQUEST_WGSL` over one set of active lanes, lowest first, in `rounds` rounds. */
function subgroupRequest(lanes: Lane[], claim: (e: number, helper: boolean) => void, rounds = 4) {
  for (const helper of lanes.filter((lane) => lane.helper)) claim(helper.e, true);
  let left = lanes.filter((lane) => !lane.helper);
  for (let round = 0; round < rounds && left.length; round++) {
    const first = left[0].e;
    claim(first, false);
    left = left.filter((lane) => lane.e !== first);
  }
  for (const lane of left) claim(lane.e, false);
}

test('the requested page set is the per-lane one on subgroups of 4 to 64 lanes', () => {
  const next = seeded(966);
  for (const size of [4, 8, 16, 32, 64]) {
    for (let frame = 0; frame < 200; frame++) {
      // Few distinct pages, many lanes on each; a cap sometimes short of them all; lanes inactive
      // (returned early) or helpers; a device that splits the active lanes in two.
      const pages = 1 + Math.floor(next() * 3 * size),
        cap = next() < 0.3 ? Math.floor(next() * pages) : 4 * size;
      const lane = requestBuffer(cap),
        subgroup = requestBuffer(cap);
      for (let groups = 1 + Math.floor(next() * 8); groups > 0; groups--) {
        const group: Lane[] = [];
        for (let i = 0; i < size; i++) {
          if (next() < 0.1) continue;
          const asked = { e: Math.floor(next() * pages) * 37, helper: next() < 0.1 };
          lane.claim(asked.e, asked.helper);
          group.push(asked);
        }
        const split = next() < 0.5 ? group.length : Math.floor(next() * group.length);
        subgroupRequest(group.slice(0, split), subgroup.claim);
        subgroupRequest(group.slice(split), subgroup.claim);
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
    subgroupRequest(group, subgroup.claim);
    assert.equal(lane.buffer.atomics, size + 4);
    assert.equal(subgroup.buffer.atomics, 2 + 4);
  }
});

test('the contract program and its reflections ask per subgroup exactly when granted `subgroups`', async () => {
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
    // Lighting, reflection source, stochastic trace and final resolve share the request rule.
    const [light, ...reflections] = codes.filter((code) => code.includes('fn requestShadowPage('));
    assert.equal(light, features.length ? SUBGROUP_SHADER : DIRECT_LIGHTING_SHADER);
    assert.equal(reflections.length, 3);
    for (const code of reflections)
      assert.equal(code.includes(SUBGROUP_REQUEST_WGSL), features.length > 0);
  }
});

test('edge cases: no lane, one lane, the first and last table entries, a cap of zero', () => {
  const last = SHADOW_TABLE_ENTRIES - 1;
  const cases: Lane[][] = [
    [],
    [{ e: last, helper: false }],
    [0, last, 0, last, last].map((e) => ({ e, helper: false })),
    [
      { e: 0, helper: true },
      { e: last, helper: false },
    ],
  ];
  for (const cap of [0, 1, 8])
    for (const group of cases) {
      const lane = requestBuffer(cap),
        subgroup = requestBuffer(cap);
      for (const { e, helper } of group) lane.claim(e, helper);
      subgroupRequest(group, subgroup.claim);
      assert.deepEqual(
        [[...subgroup.buffer.bits].sort(), subgroup.buffer.count, subgroup.buffer.list.sort()],
        [[...lane.buffer.bits].sort(), lane.buffer.count, lane.buffer.list.sort()],
      );
    }
});
