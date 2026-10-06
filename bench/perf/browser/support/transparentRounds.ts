// The two laps of a "transparents in a few orders" bench scene, and what they count.
//
// Each scene has its own: a lap shared between two scenes is a polymorphic call site, and
// the timer pays for it. Likewise, each loop is in the function where the engine holds it —
// a loop written inline in the lap slows the others, at strictly identical work.
import {
  orderBlendPasses,
  orderEye,
  refreshEyeKeys,
} from '../../../../packages/sdk-browser/src/webgpu/blend/order.ts';
import {
  expandBlendPlan,
  itemKept,
  orderBlendPlanCpu,
} from '../../../../packages/sdk-browser/src/webgpu/blend/expandCpu.ts';
import { planItem } from '../../../../packages/sdk-browser/src/webgpu/blend/plan.ts';
import { instanceItem } from '../../../oracles/browser/instanceItem.ts';
import { slotCapacity } from '../../../../packages/sdk-browser/src/webgpu/blend/planLayout.ts';
import {
  benchSide,
  glisse,
  pose,
  spans,
  type BenchItem,
  type BenchSide,
  type Frame,
} from './scenesTransparent.ts';
import type * as THREE from 'three';
import {
  argumentsReference,
  classementReference,
  encodeReference,
} from '../../../oracles/browser/transparent-orders.ts';

/** What the encode loop counted on the last lap: read by the sample, not by the lap. */
let counts = 0;
const encodedCalls = () => counts;

/**
 * THE ENCODE LOOP, counted: an own slot whose item the frustum rejects is not encoded; a slot of
 * the main class always is (`packages/sdk-browser/src/webgpu/blend/draw.ts`).
 *
 * It is in ITS function, as in the engine, where it lives in the draw pass and not in
 * ranking. Written inline in the lap, it slowed the sort the lap calls and that the
 * loop does not touch: from +7.6% to −7.6% on the double-sided camera jump, at strictly
 * identical work. A bench that measures something other than the shipped form measures nothing.
 */
function callCount(blendState: BenchSide['blendState']) {
  const seeds = blendState.seeds[0],
    own = blendState.ownSeeds[0],
    slotOwns = blendState.slotOwns[0],
    keep = blendState.keepPacked,
    count = blendState.runCount[0];
  let encodes = 0;
  for (let slot = 0; slot < count; slot++) {
    const rank = slotOwns[slot];
    if (rank < 0 || itemKept(keep, planItem(seeds[own[rank]]))) encodes++;
  }
  return encodes;
}

/** The CPU model of the order and its expansion, reread as index ranges: what the rasterizer would
 *  see. */
function etale(
  blendState: BenchSide['blendState'],
  mirror: { expanded: Uint32Array; args: Uint32Array },
  output: Uint32Array,
) {
  // Reduced fixture, matching the pattern already used by `packages/sdk-browser/src/webgpu/blend/plan.test.ts`.
  const items = blendState.blendGpu as unknown as BenchItem[];
  refreshEyeKeys(blendState, orderEye(blendState));
  const instances = expandBlendPlan({
    order: orderBlendPlanCpu(blendState, 0),
    runs: blendState.runs[0],
    runCount: blendState.runCount[0],
    draws: blendState.drawsPacked,
    keep: blendState.keepPacked,
    itemCounts: blendState.cpuItemCounts,
    instances: blendState.cpuInstances,
    maxVertexWords: blendState.maxVertexWords,
    vertexShift: blendState.vertexShift,
    instanceBase: 0,
    argsBase: 0,
    expanded: mirror.expanded,
    args: mirror.args,
  });
  let at = 0;
  for (let i = 0; i < instances; i++) {
    const item = instanceItem(mirror.expanded[i * 2]),
      key = mirror.expanded[i * 2 + 1];
    output[at++] = item;
    output[at++] = items[item].paged ? spans[key * 2] : key;
    output[at++] = items[item].paged ? spans[key * 2 + 1] : items[item].count - key;
  }
  return at;
}

/** The four laps of a scene, and the CPU-fallback mirrors allocated outside the lap. */
function tours(before: BenchSide, after: BenchSide) {
  const blendState = after.blendState;
  const mirror = {
    expanded: new Uint32Array(blendState.instanceCapacity * 2),
    args: new Uint32Array(slotCapacity(blendState.maxPlanEntries) * 4),
  };
  /** The previous path: ranking, arguments of every item, one call per entry. */
  const reference = (images: Frame[], sequence: boolean) => {
    const output = [];
    for (const image of images) {
      pose(before, image);
      classementReference(before.scene, before.order, image.eye);
      argumentsReference(before.scene, before.args);
      const rendered = encodeReference(before.scene, before.order, before.args, before.output);
      output.push(sequence ? before.output.subarray(0, rendered.length) : rendered.rejected);
    }
    return output;
  };
  /** The batch path: frustum and own entries on the CPU, then one call per slot. */
  const optimised = (images: Frame[], sequence: boolean) => {
    const output = [];
    for (const image of images) {
      pose(after, image);
      const rejections = orderBlendPasses(blendState, image.eye);
      if (sequence) {
        output.push(after.output.subarray(0, etale(blendState, mirror, after.output)));
        continue;
      }
      counts = callCount(blendState);
      output.push(rejections);
    }
    return output;
  };
  return {
    passBefore: (images: Frame[]) => reference(images, false),
    passAfter: (images: Frame[]) => optimised(images, false),
    passBeforeSeq: (images: Frame[]) => reference(images, true),
    passAfterSeq: (images: Frame[]) => optimised(images, true),
  };
}

/** A bench scene: both sides built apart, so neither benefits from the state the other leaves. */
export function sceneDe(name: string, side: THREE.Side) {
  const before = benchSide(side),
    after = benchSide(side);
  return { name, before, after, ...tours(before, after) };
}
export type Scene = ReturnType<typeof sceneDe>;

/** The draw calls of a scene's first frame: one per plan entry before, one per slot after. */
export function callsOf(scene: Scene) {
  const image = glisse[0],
    state = scene.before;
  pose(state, image);
  classementReference(state.scene, state.order, image.eye);
  argumentsReference(state.scene, state.args);
  const before = encodeReference(state.scene, state.order, state.args, state.output);
  scene.passAfter([image]);
  return { name: scene.name, before: before.encoded, after: encodedCalls() };
}
