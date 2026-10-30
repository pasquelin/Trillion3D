import type { OrderStep } from './orderSteps.ts'

/** What the transparent passes hold of their encoding plan, paint order and the records the
 *  kernels read (`../plan/plan.ts`, `order.ts`, `../runs.ts`, `../keyRecords.ts`): reused from one image to the
 *  next, rebuilt with the plan. */
export const createBlendOrderState = () => ({
  /** Static tables of the encoding plan (`../statics.ts`). */
  drawsPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** The pass's seeded entries — the one pass of every translucent item —, in source order, a
   *  double-sided item's back before its face (`../plan/plan.ts`). */
  seeds: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** Pipeline of the pass's main class, -1 without one (`../runs.ts`). */
  mainPipeline: -1,
  /** The items that draw their own slots (`../runs.ts`): the CPU keys them each frame. */
  ownItems: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** The pass's own entries, seed indices in paint order: seeded in source order, reordered in
   *  place every frame (`order.ts`). */
  ownSeeds: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** This frame's slot of each own entry, in paint order, and the own entry each slot draws,
   *  -1 for a gap of the main class (`../runs.ts`). */
  ownSlots: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  slotOwns: new Int32Array(0) as Int32Array<ArrayBuffer>,
  /** The pipeline rank each slot sets this frame (`fillSlotPipelines`): its own entry's, or the main
   *  class's — what every pass that draws the slots reads, taken once a frame. */
  slotPipelines: new Int8Array(0) as Int8Array<ArrayBuffer>,
  /** The pass's slots (`../runs.ts`), and those the frame draws: none without an eye. */
  slotCount: 0,
  runCount: 0,
  /** Each item's sort key by source rank: the own items' every frame (`order.ts`). */
  orderKeys: new Float64Array(0),
  /** Each item's sort priority by source rank, set with the plan (`../statics.ts`). */
  orderPriorities: new Int32Array(0),
  /** Bytes between two uniform slots of the order's steps and of the expansion's passes: the
   *  device's dynamic-offset alignment, which `buildBlendStatics` is given as the scene's resources
   *  are made (`prepareBlendResources`) — zero until then, when nothing is planned. */
  uniformStride: 0,
  /** The order kernel's dispatches and their uniform words (`orderSteps.ts`). */
  orderSteps: [] as OrderStep[],
  orderStepWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** Where the frame data holds the own seeds and slots, and its words; the eye comes first
   *  (`order.ts`). Two views of one buffer, rewritten every frame. */
  frameLayout: { ownSeeds: 0, ownSlots: 0, words: 0, cuts: 0 },
  /** The cut words of the frame data (`frameWords`, from `frameLayout.cuts`), as one view of it: made with the frame data (`statics.ts`). */
  cutWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  frameDoubles: new Float64Array(0) as Float64Array<ArrayBuffer>,
  frameWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** Key records of the items, two views of one buffer (`../keyRecords.ts`). */
  keyPacked: new Float64Array(0) as Float64Array<ArrayBuffer>,
  keyWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
  /** The records noted stale between two plans (`noteKeyRecord`); none when `to` is below
   *  `from`. */
  keyMoved: { from: Infinity, to: -1 },
  /** Whether a transmissive item lies in an HLOD 0 cell (`../keyRecords.ts`): a cell switch then moves
   *  the verdict's in-view count, its inputs' epoch with it (`../expand/expansionFrame.ts`). */
  cellTransmits: false,
  /** Whether a record lies in a cell file (`KEY_FILED`), and the world and the revision of its
   *  files' slots the records were written under (`noteFileSlots`): a slot moved, they are
   *  written again. */
  keyFiled: false,
  fileSlots: { world: undefined as object | undefined, revision: -1 },
  /** The revision of the world's cells (`WorldCells.revision`) the verdict last judged under. No
   *  record is rewritten for it: the verdict reads the cells' state words itself. */
  cellRevision: -1,
  /** The plan changed since the GPU last received it: seeds, dispatches, key records. */
  planMoved: true,
})
