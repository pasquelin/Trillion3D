import { FRUSTUM_PLANE_VALUES } from '../../../../sdk-core/src/index.ts';
import { notDrawn } from '../../placement/hidden.ts';
import type { BlendGpuItem, createWebgpuBlendState } from './state.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * FOOTPRINT OF THE LAST PAINT ORDER: every input `orderBlendPasses` reads, as it read them.
 *
 * The order, the frustum mask and the runs are a pure function of the eye, the frustum planes,
 * the plan tables, and per item its box — or, without one, its world origin —, whether it is drawn (a hidden node, a
 * parked row: `notDrawn`) and its pass. When all of them are bit-identical to the last ranked frame, ranking again would
 * write the same words: the frame keeps them, as `keepMoved`/`orderMoved` already keep the GPU
 * copies. Anything that differs — one bit — ranks again.
 *
 * The item walk is paid only when the view is still: a moving camera fails on the eye and ranks
 * without recording items, and the first still frame after it records them while ranking.
 */
const ITEM_VALUES = 7;

export function createBlendFootprint() {
  return {
    /** A full ranking of these inputs is on record: false until one is, and after any change. */
    held: false,
    /** Items recorded in `items`: false while the view moves, see above. */
    itemsHeld: false,
    eye: new Float64Array(3),
    planes: new Float64Array(FRUSTUM_PLANE_VALUES),
    /** Arrays the plan tables are rebuilt into: a new plan is new arrays (`plan.ts`). */
    tables: [] as unknown[],
    items: new Float64Array(0),
    /** What the recorded ranking returned: the items the frustum rejected. */
    rejected: 0,
  };
}
export type BlendFootprint = ReturnType<typeof createBlendFootprint>;

/** Compares `count` of `values` from `from` to `into` from `at`, overwriting as it goes; true
 *  when all were equal. */
function hold(into: Float64Array, at: number, values: ArrayLike<number>, count: number, from = 0) {
  let same = true;
  for (let i = 0; i < count; i++)
    if (into[at + i] !== values[from + i]) {
      into[at + i] = values[from + i];
      same = false;
    }
  return same;
}

/** Compares each item's inputs to the record and records them; true when none changed. */
function holdItems(footprint: BlendFootprint, items: readonly BlendGpuItem[]) {
  if (footprint.items.length !== items.length * ITEM_VALUES) {
    footprint.items = new Float64Array(items.length * ITEM_VALUES);
    footprint.itemsHeld = false;
  }
  const record = footprint.items;
  let same = footprint.itemsHeld;
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      box = item.bounds,
      at = i * ITEM_VALUES;
    const flags = (box ? 1 : 0) | (notDrawn(item) ? 2 : 0) | (item.transmissive ? 4 : 0);
    if (record[at] !== flags) {
      record[at] = flags;
      same = false;
    }
    // Without a box, the world origin of its mesh: the translation column of its matrix.
    same =
      (box ? hold(record, at + 1, box, 6) : hold(record, at + 1, item.matrix.elements, 3, 12)) &&
      same;
  }
  footprint.itemsHeld = true;
  return same;
}

/** Plan tables the ranking reads or writes, compared by identity: `plan.ts` never refills one. */
function holdTables(footprint: BlendFootprint, blendState: BlendState) {
  const { orders, runs, keepPacked } = blendState,
    tables = footprint.tables;
  let same = tables.length === orders.length * 2 + 1;
  tables.length = orders.length * 2 + 1;
  for (let i = 0; i < orders.length; i++) {
    same = tables[i * 2] === orders[i] && tables[i * 2 + 1] === runs[i] && same;
    tables[i * 2] = orders[i];
    tables[i * 2 + 1] = runs[i];
  }
  same = tables[tables.length - 1] === keepPacked && same;
  tables[tables.length - 1] = keepPacked;
  return same;
}

/**
 * True when the frame's inputs are those of the recorded ranking, which then stands as it is.
 * False records the new inputs: the caller ranks, then calls `holdBlendRanking`.
 */
export function blendFootprintHeld(blendState: BlendState, eye: ArrayLike<number>) {
  const footprint = blendState.footprint;
  let same = hold(footprint.eye, 0, eye, 3);
  same = hold(footprint.planes, 0, blendState.blendPlanes, FRUSTUM_PLANE_VALUES) && same;
  same = holdTables(footprint, blendState) && same;
  if (!same) {
    footprint.itemsHeld = false;
    footprint.held = false;
    return false;
  }
  return holdItems(footprint, blendState.blendGpu) && footprint.held;
}

/** Records what the ranking of the recorded inputs returned. */
export function holdBlendRanking(footprint: BlendFootprint, rejected: number) {
  footprint.rejected = rejected;
  footprint.held = true;
}
