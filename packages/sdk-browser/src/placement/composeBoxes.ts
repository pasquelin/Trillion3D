/**
 * The shadow boxes of the roots a parent composes on the GPU (`gpuCompose.ts`): each linked root's
 * box in its parent's frame, made when the links change, and their union per slot, which a
 * parent's move declares at its last world and its new one, and which `settle` declares where the
 * parent now holds it (`../webgpu/shadow/mobility.ts`). No row is read: one box per slot.
 */
import {
  BOX_VALUES,
  boxEmpty,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from '../../../sdk-core/src/index.ts';
import { boxEquals, boxGrow } from '../../../sdk-core/src/math/primitives/box.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { ComposeState } from './gpuCompose.ts';

const reachBox = new Float64Array(BOX_VALUES);

/** Root `rank`'s box in its parent's frame, through `local`, grown by its deformation reach on
 *  every side as its rows' spheres are (`../webgpu/shadow/spheres.ts`): unbounded without a local
 *  box. */
export function linkBox(
  state: ComposeState,
  rank: number,
  root: { localBox?: Float64Array; reach?: number },
  local: ArrayLike<number>,
) {
  const at = rank * BOX_VALUES,
    box = root.localBox,
    reach = root.reach ?? 0;
  if (!box) {
    state.rankBoxes.fill(-Infinity, at, at + 3).fill(Infinity, at + 3, at + 6);
    return;
  }
  boxGrow(reachBox, 0, box, 0, reach);
  boxTransform(state.rankBoxes, at, reachBox, 0, local);
}

/** Slot `slot`'s box made again from the roots it holds. */
export function remakeSlotBox(state: ComposeState, slot: number) {
  const at = slot * BOX_VALUES,
    boxes = state.rankBoxes;
  boxEmpty(state.slotBoxes, at);
  for (const rank of state.ranksOf[slot]) {
    if (state.parentOf[rank] !== slot) continue;
    const b = rank * BOX_VALUES;
    boxUnion(
      state.slotBoxes,
      at,
      boxes[b],
      boxes[b + 1],
      boxes[b + 2],
      boxes[b + 3],
      boxes[b + 4],
      boxes[b + 5],
    );
  }
}

/** Slot `slot`'s box at parent world `world`, written in `out`: every bound infinite when one of
 *  its roots has none, which reaches every page. */
function slotWorldBox(
  state: ComposeState,
  slot: number,
  world: ArrayLike<number>,
  out: Float64Array,
) {
  const at = slot * BOX_VALUES,
    box = state.slotBoxes;
  if (boxIsEmpty(box, at)) return boxEmpty(out, 0);
  for (let v = 0; v < BOX_VALUES; v++)
    if (!Number.isFinite(box[at + v])) {
      out.fill(-Infinity, 0, 3).fill(Infinity, 3, 6);
      return;
    }
  boxTransform(out, 0, box, at, world);
}

/** The slot's box before a change and after it (`declareSlotMove`). */
const before = new Float64Array(BOX_VALUES),
  beforeMin = before.subarray(0, 3),
  beforeMax = before.subarray(3, 6),
  after = new Float64Array(BOX_VALUES),
  afterMin = after.subarray(0, 3),
  afterMax = after.subarray(3, 6);

/** Holds slot `slot`'s box at its parent's last world, the one a change leaves; none for a slot
 *  taken now. */
export function holdSlotBox(state: ComposeState, slot: number | undefined) {
  if (slot === undefined) boxEmpty(before, 0);
  else slotWorldBox(state, slot, state.worlds.subarray(slot * 16, slot * 16 + 16), before);
}

/** The held box and slot `slot`'s at its parent's world as last sent (none for a freed slot),
 *  declared to the shadow cache as a moved node declares its own (`../webgpu/pages/render/
 *  movedBatch.ts`): each on its own, the second only when it differs. */
export function declareSlotMove(
  rt: WebgpuPagesRuntime,
  state: ComposeState,
  slot: number | undefined,
  movingOnly: boolean,
) {
  const { changes } = rt.lights;
  if (slot === undefined) boxEmpty(after, 0);
  else slotWorldBox(state, slot, state.worlds.subarray(slot * 16, slot * 16 + 16), after);
  if (!boxIsEmpty(before, 0)) changes.worldChanged(beforeMin, beforeMax, movingOnly);
  if (!boxIsEmpty(after, 0) && !boxEquals(before, 0, after, 0))
    changes.worldChanged(afterMin, afterMax, movingOnly);
}

/** Slot `lead`'s box where its parent now holds it (`../webgpu/shadow/mobility.ts`, `settle`);
 *  undefined when no parent holds that slot. */
export function composedSlotBox(rt: WebgpuPagesRuntime, lead: number) {
  const state = rt.compose;
  if (!state || lead >= state.slots || state.freeSlots.includes(lead)) return undefined;
  slotWorldBox(state, lead, state.worlds.subarray(lead * 16, lead * 16 + 16), after);
  return boxIsEmpty(after, 0) ? undefined : after;
}
