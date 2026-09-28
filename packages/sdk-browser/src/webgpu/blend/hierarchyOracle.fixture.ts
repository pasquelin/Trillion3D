// Develop's frustum walk before the box tree (#981), kept verbatim as the oracle of
// `hierarchy.test.ts`: the audit's CPU-17 equivalence harness.
import { notDrawn } from '../../placement/hidden.ts';
import { frustumExcludesBox } from '../../../../sdk-core/src/index.ts';
import { blendFootprintHeld, holdBlendRanking } from './footprint.ts';
import type { blendSceneOf } from './plan.fixture.ts';
import { resliceBlendRuns, RUN_WORDS } from './runs.ts';
import { sortPlanFarToNear } from './sortPlan.ts';

type BlendState = ReturnType<typeof blendSceneOf>;

/** Develop's `orderBlendPasses` with an eye: the footprint, keys, the frustum item by item, then
 *  the sort and the runs. */
export function developOrder(blendState: BlendState, eye: number[]) {
  const items = blendState.blendGpu;
  if (!items.length) {
    blendState.runCount[0] = 0;
    blendState.runCount[1] = 0;
    blendState.transmissiveInView = 0;
    blendState.footprint.held = false;
    return 0;
  }
  if (blendFootprintHeld(blendState, eye)) return blendState.footprint.rejected;
  if (blendState.orderKeys.length < items.length)
    blendState.orderKeys = new Float64Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      box = item.bounds,
      m = item.matrix.elements;
    const x = box ? (box[0] - eye[0] + (box[3] - eye[0])) / 2 : m[12] - eye[0],
      y = box ? (box[1] - eye[1] + (box[4] - eye[1])) / 2 : m[13] - eye[1],
      z = box ? (box[2] - eye[2] + (box[5] - eye[2])) / 2 : m[14] - eye[2];
    item.orderRank = i;
    item.orderKey = blendState.orderKeys[i] = x * x + y * y + z * z;
  }
  const keep = blendState.keepPacked,
    planes = blendState.blendPlanes;
  let rejected = 0,
    water = 0,
    bouge = false,
    mot = 0;
  const pose = (rang: number) => {
    if (keep[rang] !== mot >>> 0) {
      keep[rang] = mot;
      bouge = true;
    }
    mot = 0;
  };
  for (let i = 0; i < items.length; i++) {
    const box = items[i].bounds;
    const parked = notDrawn(items[i]);
    if (
      !parked &&
      box &&
      frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5])
    )
      rejected++;
    else if (!parked) {
      mot |= 1 << (i & 31);
      if (items[i].transmissive) water++;
    }
    if ((i & 31) === 31) pose(i >>> 5);
  }
  if (items.length & 31) pose(items.length >>> 5);
  blendState.keepMoved = bouge;
  blendState.transmissiveInView = water;
  const { orders, orderMoved, runs, runCount } = blendState;
  for (let pass = 0; pass < orders.length; pass++) {
    const order = orders[pass];
    const voided = !runCount[pass] && order.length;
    const first = sortPlanFarToNear(order, blendState.orderKeys);
    if (first === order.length && !voided && !orderMoved[pass]) continue;
    orderMoved[pass] = true;
    runCount[pass] = resliceBlendRuns(order, runs[pass], runCount[pass], first);
  }
  holdBlendRanking(blendState.footprint, rejected);
  return rejected;
}

/** Everything a ranking hands the frame. */
export function outcome(blendState: BlendState, rejected: number) {
  return {
    rejected,
    keep: Array.from(blendState.keepPacked),
    keepMoved: blendState.keepMoved,
    water: blendState.transmissiveInView,
    orders: blendState.orders.map((order) => Array.from(order)),
    runs: blendState.runs.map((runs, p) =>
      Array.from(runs.subarray(0, blendState.runCount[p] * RUN_WORDS)),
    ),
  };
}
