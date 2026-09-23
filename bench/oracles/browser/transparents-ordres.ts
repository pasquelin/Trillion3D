// The path from BEFORE the "transparents in a few orders" batch, copied as-is: ranking
// that posed only keys, indirect arguments rewritten per item and per frame, and the
// encode loop that posed one `drawIndirect` per plan entry while retesting the frustum
// entry by entry. The two files that carried them — `webgpuBlendArgs.ts` and
// `webgpuBlendSelect.ts` — no longer exist: these copies are all that remains of them,
// and that is their reason to be.
//
// This is the oracle: these copies are wanted duplicates, and the bench compares their
// output to that of the imported package path.
import { frustumExcludesBox, matrixWindingCw } from '../../../packages/sdk-core/index.ts';
import type { BlendGpuItem } from '../../../packages/sdk-browser/webgpuBlendState.ts';

/** The scene shape both the previous ranking and encode loop read. */
export interface ReferenceScene {
  items: readonly BlendGpuItem[];
  draws: Uint32Array;
  planes: Float64Array;
  spans: Uint32Array;
  itemCounts: Uint32Array | undefined;
  instances: Uint32Array | undefined;
}

/** The previous plan: the item rank, the pipeline in the two low bits, and nothing more. */
const planItem = (entry: number) => entry >>> 2;
const PIPELINE_NONE = 0,
  PIPELINE_FRONT = 1,
  PIPELINE_BACK = 2;

/** `webgpuBlendPlan.ts` from before: the two entries of a double-sided item, back then front.
 *  The item carries the engine's surface record where it carried a host material (#288); the three
 *  host face constants this copy tested are that record's two booleans, one for one —
 *  `DoubleSide` is `doubleSided`, `BackSide` is `backSide`, `FrontSide` is neither. Nothing else
 *  of the copy moved: a double-sided item drawn in ONE pass falls through all three tests and
 *  plans `PIPELINE_NONE`, as it did. */
function sidesOf(item: BlendGpuItem) {
  const surface = item.surface;
  const renverse = matrixWindingCw(item.matrix.elements);
  const front = renverse ? PIPELINE_FRONT : PIPELINE_BACK,
    back = renverse ? PIPELINE_BACK : PIPELINE_FRONT;
  if (surface.doubleSided && !surface.forceSinglePass) return [back, front];
  if (!surface.doubleSided && !surface.backSide) return [front];
  if (surface.backSide) return [back];
  return [PIPELINE_NONE];
}

/** The previous blend plan, seeded in source order. */
export function planReference(items: readonly BlendGpuItem[]) {
  const blend: number[] = [];
  for (let i = 0; i < items.length; i++)
    for (const side of sidesOf(items[i])) blend.push((i << 2) | side);
  return Uint32Array.from(blend);
}

/** `webgpuBlendOrder.ts` from before: an item's key, the square of the eye-to-centre distance. */
function eyeKey(item: BlendGpuItem, ex: number, ey: number, ez: number) {
  const box = item.bounds,
    m = item.matrix.elements;
  const x = box ? (box[0] - ex + (box[3] - ex)) / 2 : m[12] - ex,
    y = box ? (box[1] - ey + (box[4] - ey)) / 2 : m[13] - ey,
    z = box ? (box[2] - ez + (box[5] - ez)) / 2 : m[14] - ez;
  return x * x + y * y + z * z;
}

const precedes = (keyA: number, rankA: number, keyB: number, rankB: number) =>
  keyA < keyB || (keyA === keyB && rankA > rankB);

/** Insertion sort of the plan, on the buffer the previous frame left. */
function sortPlanFarToNear(order: Uint32Array, items: readonly BlendGpuItem[]) {
  for (let i = 1; i < order.length; i++) {
    const entry = order[i],
      moved = items[planItem(entry)];
    let j = i - 1;
    while (j >= 0) {
      const held = items[planItem(order[j])];
      if (
        !precedes(
          held.orderKey ?? 0,
          held.orderRank ?? 0,
          moved.orderKey ?? 0,
          moved.orderRank ?? 0,
        )
      )
        break;
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = entry;
  }
}

/** The previous ranking: keys, a source rank, and nothing else. */
export function classementReference(scene: ReferenceScene, order: Uint32Array, eye: number[]) {
  const items = scene.items;
  for (let i = 0; i < items.length; i++) {
    items[i].orderRank = i;
    items[i].orderKey = eyeKey(items[i], eye[0], eye[1], eye[2]);
  }
  sortPlanFarToNear(order, items);
}

/** Previous indirect arguments: four words per item, rewritten as integers every frame. */
export function argumentsReference(scene: ReferenceScene, args: Uint32Array) {
  const { items, planes, draws, itemCounts } = scene;
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      box = item.bounds;
    const out = !!box && frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5]);
    args[i * 4] = draws[i * 4 + 1];
    args[i * 4 + 1] = out
      ? 0
      : item.paged && itemCounts && item.pagedIndex !== undefined
        ? (itemCounts[item.pagedIndex] ?? 0)
        : item.paged
          ? 0
          : 1;
    args[i * 4 + 2] = draws[i * 4 + 2];
    args[i * 4 + 3] = 0;
  }
}

/**
 * The previous encode loop: one `drawIndirect` per plan entry, the frustum retests in double
 * precision, and an item fully off-field is not encoded. Yields encoded calls, rejected
 * items, and the sequence of index ranges the rasterizer would have seen.
 */
export function encodeReference(
  scene: ReferenceScene,
  order: Uint32Array,
  args: Uint32Array,
  sortie: Uint32Array,
) {
  const { items, planes, spans, instances } = scene;
  let encoded = 0,
    rejete = -1,
    rejected = 0,
    at = 0;
  for (let i = 0; i < order.length; i++) {
    const index = planItem(order[i]),
      item = items[index],
      box = item.bounds;
    if (box && frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5])) {
      if (index !== rejete) rejected++;
      rejete = index;
      continue;
    }
    encoded++;
    const held = args[index * 4 + 1];
    for (let j = 0; j < held; j++) {
      if (item.paged && instances && item.tableBase !== undefined) {
        const entry = instances[item.tableBase + j];
        sortie[at++] = index;
        sortie[at++] = spans[entry * 2];
        sortie[at++] = spans[entry * 2 + 1];
      } else {
        sortie[at++] = index;
        sortie[at++] = 0;
        sortie[at++] = item.count;
      }
    }
  }
  return { encoded, rejected, length: at };
}
