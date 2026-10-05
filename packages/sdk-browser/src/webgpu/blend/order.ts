import { cullBlendHierarchy } from './hierarchyCull.ts';
import { precedes, sortSeedsFarToNear } from './sortPlan.ts';
import { assignOwnSlots } from './runs.ts';
import type { BlendGpuItem, createWebgpuBlendState } from './state.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * PAINT ORDER OF TRANSPARENT SURFACES, REDONE EVERY FRAME.
 *
 * A blend pipeline does not write depth (`pipelines.ts`): two transparent surfaces are
 * therefore separated by nothing other than the order they are encoded in. The encoding plan is a
 * SCENE object — source order, rebuilt only when matrices move — and cannot carry this decision,
 * which depends on the eye.
 *
 * WHAT WE RANK ON: the square of the eye-to-WORLD-box-centre distance of the item, decreasing —
 * farthest first, nearest last. A frank distance, never a normalised depth: the engine convention
 * is inverted (`../../camera/depthConvention.ts`) and ranking on it would read backwards. The square
 * is enough, it is monotonic in the distance. THE GAP IS TAKEN RELATIVE TO THE EYE, bound by bound,
 * before being averaged: that is the space of the rest of the path, and an absolute world centre
 * would lose its useful bits far from the origin.
 *
 * WHO RANKS: the GPU ranks every entry of a pass (`orderWgsl.ts`), on these very keys computed in
 * emulated doubles. The CPU ranks only the own entries, the ones it must encode one draw each
 * (`runs.ts`) — none in a pass of one class — and sends the GPU the eye, their keys and their order.
 */

/** Key of an item: without a usable box, the world origin of its mesh stands in. */
function eyeKey(item: BlendGpuItem, ex: number, ey: number, ez: number) {
  const box = item.bounds,
    m = item.matrix.elements;
  const x = box ? (box[0] - ex + (box[3] - ex)) / 2 : m[12] - ex,
    y = box ? (box[1] - ey + (box[4] - ey)) / 2 : m[13] - ey,
    z = box ? (box[2] - ez + (box[5] - ez)) / 2 : m[14] - ez;
  return x * x + y * y + z * z;
}

/**
 * Sets each item's key and source rank, and copies the key into the flat array the CPU sorts read
 * (`orderKeys`): the fallback pass's and the CPU model's, which rank every item.
 */
export function refreshEyeKeys(blendState: BlendState, eye: ArrayLike<number>) {
  const items = blendState.blendGpu,
    ex = eye[0],
    ey = eye[1],
    ez = eye[2];
  if (blendState.orderKeys.length < items.length)
    blendState.orderKeys = new Float64Array(items.length);
  const keys = blendState.orderKeys;
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      key = eyeKey(item, ex, ey, ez);
    item.orderRank = i;
    item.orderKey = key;
    keys[i] = key;
  }
}

/**
 * The frame data the order kernel reads (`frameLayout`): the eye, each own item's key — a NaN as
 * the GPU's one NaN pattern, all ones —, then each pass's own seeds in paint order and their slots.
 */
function writeOrderFrame(blendState: BlendState, eye: ArrayLike<number>) {
  const { frameDoubles: doubles, frameWords: words, frameLayout: layout } = blendState;
  doubles[0] = eye[0];
  doubles[1] = eye[1];
  doubles[2] = eye[2];
  doubles[3] = 0;
  const own = blendState.ownItems,
    keys = blendState.orderKeys,
    first = layout.ownKeys / 2;
  for (let k = 0; k < own.length; k++) {
    const key = keys[own[k]];
    doubles[first + k] = key;
    if (key !== key) words.fill(0xffffffff, layout.ownKeys + 2 * k, layout.ownKeys + 2 * k + 2);
  }
  for (let pass = 0; pass < layout.ownSeeds.length; pass++) {
    words.set(blendState.ownSeeds[pass], layout.ownSeeds[pass]);
    words.set(blendState.ownSlots[pass], layout.ownSlots[pass]);
  }
}

/**
 * The frame's share of the CPU in the order: the frustum verdict, the own entries' keys and paint
 * order, the frame data for the GPU, and the slots each pass draws. Returns the number of items the
 * frustum rejected.
 *
 * WITHOUT AN EYE, NOTHING IS PAINTED: a frame without a camera has no paint order, and no slot.
 *
 * `cull` is the frustum verdict: the box tree, or develop's item walk the equivalence test ranks the
 * same scene with (`hierarchyOracle.fixture.ts`). It stays on the CPU: the water pass, its scissor,
 * the reflections, the frame signature and the published metrics read it, and none may wait for the
 * GPU.
 */
export function orderBlendPasses(
  blendState: BlendState,
  eye: ArrayLike<number> | undefined,
  cull: (blendState: BlendState) => number = cullBlendHierarchy,
) {
  if (!eye || !blendState.blendGpu.length) {
    blendState.runCount[0] = 0;
    blendState.runCount[1] = 0;
    blendState.transmissiveInView = 0;
    return 0;
  }
  const rejected = cull(blendState);
  const { blendGpu: items, ownItems, orderKeys } = blendState;
  for (let k = 0; k < ownItems.length; k++)
    orderKeys[ownItems[k]] = eyeKey(items[ownItems[k]], eye[0], eye[1], eye[2]);
  for (let pass = 0; pass < blendState.seeds.length; pass++) {
    const seeds = blendState.seeds[pass],
      own = blendState.ownSeeds[pass];
    sortSeedsFarToNear(own, seeds, orderKeys);
    if (seeds.length)
      assignOwnSlots(
        seeds,
        own,
        blendState.mainPipeline[pass] >= 0,
        blendState.ownSlots[pass],
        blendState.slotOwns[pass],
      );
    blendState.runCount[pass] = blendState.slotCounts[pass];
  }
  writeOrderFrame(blendState, eye);
  return rejected;
}

/** The eye the frame data holds: what the CPU model ranks from (`expandCpu.ts`). */
export const orderEye = (blendState: BlendState) => blendState.frameDoubles.subarray(0, 3);

/**
 * The same ranking for the fallback path, whose draw list is made of items and not of plan
 * entries. The comparison is the one above: both paths paint in the same order, and a machine
 * without a visibility buffer does not see another image.
 */
export function orderVisibleBlend(blendState: BlendState, eye: ArrayLike<number> | undefined) {
  if (!eye || !blendState.blendGpu.length) return;
  refreshEyeKeys(blendState, eye);
  const visible = blendState.visibleBlend;
  for (let i = 1; i < visible.length; i++) {
    const moved = visible[i],
      movedKey = moved.orderKey,
      movedRank = moved.orderRank;
    let j = i - 1;
    for (; j >= 0; j--) {
      const held = visible[j];
      if (!precedes(held.orderKey, held.orderRank, movedKey, movedRank)) break;
      visible[j + 1] = held;
    }
    visible[j + 1] = moved;
  }
}
