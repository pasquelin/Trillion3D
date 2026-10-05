import { matrixWindingCw } from '../../../../sdk-core/src/index.ts';
import { refreshSurface, surfaceSide, type PageSurface } from '../../page/surface.ts';
import { BLEND_MODES, drawnBlending } from '../../scene/materialBlending.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import { filtersDisplay } from './equations.ts';
import { buildBlendHierarchy } from './hierarchy.ts';
import {
  EXPAND_PASSES,
  RUN_WORDS,
  blendChunkWords,
  blendVertexShift,
  planRegions,
  slotCapacity,
} from './planLayout.ts';
import { slotCount } from './runs.ts';
import { FRAME_EYE_WORDS, NOT_OWN, orderFrameWords } from './orderWgsl.ts';
import { ORDER_STEP_STRIDE, orderStepCount, planOrderSteps } from './orderSteps.ts';
import type { BlendGpuItem, createWebgpuBlendState } from './state.ts';
import {
  PLAN_PIPELINE_MASK,
  PLAN_SHARED_BIT,
  PLAN_SHIFT,
  PLAN_VERTEX_CULL_BIT,
  planEntry,
} from './planEntry.ts';
import { planCull } from './planCull.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/** The three cull ranks of a pass's pipelines: a plan entry picks them without a test, and the
 *  rank, plus three per blend mode (`BLEND_MODES`), indexes the pipelines of the pass
 *  (`BlendModePipelines`, `draw.ts`). The water surfaces have only the three normal ones. */
const PIPELINE_NONE = 0,
  PIPELINE_FRONT = 1,
  PIPELINE_BACK = 2;
export const planItem = (entry: number) => entry >>> PLAN_SHIFT;
/** Cull mode the vertex stage applies to the entry's instances: zero when the pipeline culls. */
export const planVertexCull = (entry: number) =>
  entry & PLAN_VERTEX_CULL_BIT ? planCull(entry) : PIPELINE_NONE;
/** Pipeline the entry sets: its mode's one that culls nothing when the vertex stage culls for it. */
export const planPipeline = (entry: number) => (entry & PLAN_PIPELINE_MASK) - planVertexCull(entry);
const planShared = (entry: number) => (entry & PLAN_SHARED_BIT) !== 0;
/** No paged primitive behind this item: it draws its own indices, in chunks. */
export const DRAW_UNPAGED = 0xffffffff;
/** Plan entries an item can set at most: the back and the face of a double-sided material. */
const MAX_SIDES = 2;

/**
 * Addressing stride of the scene: large enough for the longest instance, small enough for the
 * rank of a run's first instance to fit in the high bits of a vertex index. A paged cluster sets
 * the floor; an unpaged primitive, split into chunks, can yield if the expanded list gets too long.
 */
function sceneVertexShift(items: readonly BlendGpuItem[], paged: number, capacity: number) {
  // Only UNPAGED primitives depend on the stride: their lengths are gathered once, and capacity
  // is recomputed on that list alone when the stride yields.
  const libres: number[] = [];
  let longest = paged;
  for (const item of items)
    if (!item.paged) {
      libres.push(item.count);
      longest = Math.max(longest, item.count);
    }
  const floor = blendVertexShift(paged);
  let shift = blendVertexShift(longest);
  while (shift > floor && instanceCapacity(libres, shift, capacity) * 2 ** shift > 0xffffffff)
    shift--;
  return shift;
}

/** Instances the scene can expand at most: the paged table, plus the others' chunks, and all of
 *  that twice — a double-sided material drawn in two passes carries two plan entries. */
function instanceCapacity(libres: readonly number[], shift: number, capacity: number) {
  let total = capacity;
  for (const count of libres) total += Math.ceil(count / blendChunkWords(shift, count));
  return total * MAX_SIDES;
}

/**
 * Static tables of the transparent pass: what an instance draws, and where its item is named.
 *
 * A paged instance draws a cluster, an unpaged instance a chunk of at most one index stride. The
 * vertex index no longer carries the item rank but the rank of its run's first instance
 * (`runs.ts`): that is what lets a whole run fit in ONE draw, and all paged items share
 * ONE bind group.
 */
export function buildBlendStatics(blendState: BlendState) {
  const items = blendState.blendGpu,
    table = blendState.table;
  const paged = table?.maxVertexWords ?? 0;
  const shift = sceneVertexShift(items, paged, table?.length ?? 0);
  blendState.vertexShift = shift;
  blendState.maxVertexWords = Math.max(3, paged);
  const draws = new Uint32Array(Math.max(1, items.length) * 4);
  // The two passes expand their instances into TWO disjoint regions of the same list. Their size
  // is that of the WORST CASE — two plan entries per item — not that of the current plan:
  // `sidesOf` reads the item's surface RECORD, refilled in place by its declaration, and a material switched
  // to double-sided between two frames would overflow the list and push the transmission region
  // past its end. Out-of-bounds kernel writes are dropped silently: transparent geometry would
  // vanish without an error.
  const room = [0, 0];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.tableBase =
      item.paged && table && item.pagedIndex !== undefined
        ? table.itemRanges[item.pagedIndex * 2]
        : 0;
    const known = item.paged && table && item.pagedIndex !== undefined;
    draws[i * 4] = known ? item.pagedIndex! : DRAW_UNPAGED;
    draws[i * 4 + 2] = item.tableBase;
    if (known) {
      // Instances a plan entry can expand at most: what the table holds for this item. The kernel
      // reads this word only for an unpaged primitive.
      draws[i * 4 + 1] = table!.itemRanges[item.pagedIndex! * 2 + 1];
      room[item.transmissive ? 1 : 0] += MAX_SIDES * draws[i * 4 + 1];
      continue;
    }
    const words = blendChunkWords(shift, item.count);
    draws[i * 4 + 1] = Math.ceil(item.count / words);
    draws[i * 4 + 3] = words;
    room[item.transmissive ? 1 : 0] += MAX_SIDES * draws[i * 4 + 1];
  }
  blendState.instanceBase[1] = room[0];
  blendState.instanceCapacity = Math.max(1, room[0] + room[1]);
  blendState.drawsPacked = draws;
  blendState.keepPacked = new Uint32Array(Math.max(1, (items.length + 31) >> 5));
  buildBlendHierarchy(blendState);
  // Same worst case for the plan tables, its slots and the frame data, and for the same reason.
  const entries = Math.max(1, items.length) * MAX_SIDES;
  blendState.maxPlanEntries = entries;
  blendState.planRegions = planRegions(entries);
  const slots = slotCapacity(entries) * RUN_WORDS;
  blendState.runs = [new Uint32Array(slots), new Uint32Array(slots)];
  blendState.runCount.fill(0);
  blendState.orderKeys = new Float64Array(Math.max(1, items.length));
  blendState.ownRanks = new Uint32Array(items.length);
  blendState.frameDoubles = new Float64Array(Math.ceil(orderFrameWords(items.length, entries) / 2));
  blendState.frameWords = new Uint32Array(blendState.frameDoubles.buffer);
  blendState.orderStepWords = new Uint32Array(
    EXPAND_PASSES * orderStepCount(entries) * (ORDER_STEP_STRIDE / 4),
  );
  blendState.planMoved = true;
}

/** First pipeline rank of an item's blend mode (`drawnBlending`, which refuses by name). */
const modeBase = (surface: PageSurface, transmissive: boolean) =>
  BLEND_MODES.indexOf(drawnBlending(surface.blending, transmissive)) * 3;

/** Plan entries of an item: back then face for a double-sided one drawn in two passes, else one. */
function sidesOf(item: BlendGpuItem) {
  // One determinant: the call used to yield the same value twice to pick the two faces.
  const renverse = matrixWindingCw(item.matrix.elements);
  const front = renverse ? PIPELINE_FRONT : PIPELINE_BACK,
    back = renverse ? PIPELINE_BACK : PIPELINE_FRONT;
  // The record is reread here: the host writes `side` on the declaration it shares with its
  // mesh, and the plan is what must see it (see the room reserved above).
  const surface = refreshSurface(item.surface);
  const side = surfaceSide(surface),
    base = modeBase(surface, !!item.transmissive);
  if (side === 'double' && !surface.forceSinglePass) return [base + back, base + front];
  if (side === 'front') return [base + front];
  if (side === 'back') return [base + back];
  return [base + PIPELINE_NONE];
}

/**
 * Encoding plan, rebuilt when the scene has changed matrices — and never per frame. An entry
 * carries the item rank and the pipeline to set, so neither the order nor the slots read a
 * material.
 */
export function refreshBlendPlan(blendState: BlendState) {
  const items = blendState.blendGpu;
  const blend: number[] = [],
    transmission: number[] = [];
  // Triangles each pass SUBMITS (a double-sided item twice: two plan entries), and whether a mode
  // filters the display: counted with the plan, never per frame.
  let blendTriangles = 0,
    transmissionTriangles = 0,
    filters = false;
  const modes = new Set<Blending>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      into = item.transmissive ? transmission : blend;
    const sides = sidesOf(item),
      vertexCull = !!item.paged && sides.length === MAX_SIDES;
    filters ||= filtersDisplay(BLEND_MODES[Math.floor(sides[0] / 3)]);
    modes.add(BLEND_MODES[Math.floor(sides[0] / 3)]);
    for (const side of sides) {
      into.push(planEntry(i, side, !!item.paged, vertexCull));
      if (item.paged) continue;
      if (item.transmissive) transmissionTriangles += item.count / 3;
      else blendTriangles += item.count / 3;
    }
  }
  blendState.seeds = [Uint32Array.from(blend), Uint32Array.from(transmission)];
  splitBlendClasses(blendState);
  planBlendOrder(blendState);
  blendState.blendTriangles = blendTriangles;
  blendState.transmissionTriangles = transmissionTriangles;
  blendState.filtersDisplay = filters;
  blendState.planModes = [...modes];
}

/**
 * Each pass's MAIN CLASS — the shared entries of its most common pipeline, the lowest on a tie —
 * and its OWN entries, every other one, each its own draw slot (`runs.ts`). An item's entries
 * share its class: a paged double-sided item sets one pipeline for both sides (VERTEX CULL), an
 * unpaged one is never shared; they are consecutive seeds, which is how its own items are counted.
 * The own entries start in source order, the order the CPU then keeps sorting in place.
 */
function splitBlendClasses(blendState: BlendState) {
  const ranks = blendState.ownRanks.fill(NOT_OWN),
    owned: number[] = [];
  for (let pass = 0; pass < EXPAND_PASSES; pass++) {
    const seeds = blendState.seeds[pass],
      shared = new Array<number>(PLAN_PIPELINE_MASK + 1).fill(0);
    for (const entry of seeds) if (planShared(entry)) shared[planPipeline(entry)]++;
    const most = Math.max(...shared),
      main = most ? shared.indexOf(most) : -1;
    const own: number[] = [];
    let items = 0;
    for (let seed = 0; seed < seeds.length; seed++) {
      const entry = seeds[seed];
      if (planShared(entry) && planPipeline(entry) === main) continue;
      own.push(seed);
      const item = planItem(entry);
      if (ranks[item] === NOT_OWN) ranks[item] = owned.push(item) - 1;
      if (own.length === 1 || planItem(seeds[own[own.length - 2]]) !== item) items++;
    }
    blendState.mainPipeline[pass] = main;
    blendState.ownSeeds[pass] = Uint32Array.from(own);
    blendState.ownSlots[pass] = new Uint32Array(own.length);
    const slots = seeds.length ? slotCount(own.length, items, main >= 0) : 0;
    blendState.slotOwns[pass] = new Int32Array(slots);
    blendState.slotCounts[pass] = slots;
  }
  blendState.ownItems = Uint32Array.from(owned);
}

/** Where the frame data puts the own keys and seeds, and the order kernel's dispatches. */
function planBlendOrder(blendState: BlendState) {
  const layout = blendState.frameLayout;
  layout.ownKeys = FRAME_EYE_WORDS;
  let at = layout.ownKeys + 2 * blendState.ownItems.length;
  let step = 0;
  for (let pass = 0; pass < EXPAND_PASSES; pass++) {
    layout.ownSeeds[pass] = at;
    layout.ownSlots[pass] = at + blendState.ownSeeds[pass].length;
    at += 2 * blendState.ownSeeds[pass].length;
    const entries = blendState.seeds[pass].length;
    blendState.orderSteps[pass] = entries
      ? planOrderSteps(
          {
            entries,
            ownCount: blendState.ownSeeds[pass].length,
            main: blendState.mainPipeline[pass] >= 0,
            region: blendState.planRegions[pass],
            ownSeedBase: layout.ownSeeds[pass],
            ownSlotBase: layout.ownSlots[pass],
            ownKeyBase: layout.ownKeys,
          },
          blendState.orderStepWords,
          step,
        )
      : [];
    step += blendState.orderSteps[pass].length;
  }
  layout.words = at;
  blendState.planMoved = true;
}
