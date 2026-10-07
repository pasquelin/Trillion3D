import type { OrderStep } from './orderSteps.ts'

/** What the transparent passes hold of their encoding plan and paint order (`plan.ts`,
 *  `order.ts`, `runs.ts`): reused from one image to the next, rebuilt with the plan. */
export const createBlendOrderState = () => ({
  /** Static tables of the encoding plan (`plan.ts`). */
  drawsPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** Seeded entries of each pass — blend, then transmission —, in source order, a double-sided
   *  item's back before its face (`plan.ts`). Like everything that goes per pass, indexed by
   *  the pass. */
  seeds: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
  /** Pipeline of each pass's main class, -1 for a pass without one (`runs.ts`). */
  mainPipeline: [-1, -1],
  /** The items that draw their own slots, and each item's rank among them, `NOT_OWN` for the
   *  others (`runs.ts`). */
  ownItems: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  ownRanks: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** Each pass's own entries, seed indices in paint order: seeded in source order, reordered in
   *  place every frame (`order.ts`). */
  ownSeeds: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
  /** This frame's slot of each own entry, in paint order, and the own entry each slot draws,
   *  -1 for a gap of the main class (`runs.ts`). */
  ownSlots: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
  slotOwns: [new Int32Array(0), new Int32Array(0)] as Int32Array<ArrayBuffer>[],
  /** Slots of each pass (`runs.ts`), and those the frame draws: none without an eye. */
  slotCounts: [0, 0],
  runCount: [0, 0],
  /** Each item's sort key by source rank: the own items' every frame (`order.ts`). */
  orderKeys: new Float64Array(0),
  /** The order kernel's dispatches of each pass and their uniform words (`orderSteps.ts`). */
  orderSteps: [[], []] as OrderStep[][],
  orderStepWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** Where the frame data holds the own keys and each pass's own seeds and slots, and its words;
   *  the eye comes first (`order.ts`). Two views of one buffer, rewritten every frame. */
  frameLayout: { ownKeys: 0, ownSeeds: [0, 0], ownSlots: [0, 0], words: 0 },
  frameDoubles: new Float64Array(0) as Float64Array<ArrayBuffer>,
  frameWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** Key records of the items, two views of one buffer (`keyRecords.ts`). */
  keyPacked: new Float64Array(0) as Float64Array<ArrayBuffer>,
  keyWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** The plan changed since the GPU last received it: seeds, dispatches, key records. */
  planMoved: true,
})
