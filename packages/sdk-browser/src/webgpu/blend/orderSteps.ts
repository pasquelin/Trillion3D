import { ORDER_UNI, SLOT_GROUP, SORT_BLOCK } from './orderWgsl.ts'

/** Bytes between two dispatches' uniform words: WebGPU's default dynamic-offset alignment. */
export const ORDER_STEP_STRIDE = 256
const STEP_WORDS = ORDER_STEP_STRIDE / 4
const [BLOCKS, STEP, SLOTS] = [0, 1, 2]

/** One dispatch of the order kernel: its entry point's rank in `BLEND_ORDER_ENTRIES`, its
 *  workgroups, and the rank of its uniform words in the steps buffer. */
export type OrderStep = { entry: number; groups: number; uniform: number }

/** The size the network sorts: the pass's entries padded to a power of two, one block at least. */
export const sortSize = (entries: number) =>
  Math.max(SORT_BLOCK, 2 ** Math.ceil(Math.log2(Math.max(1, entries))))

/**
 * Dispatches that order a pass of `entries` entries and place its slots: the block sort, then for
 * each stage wider than a block its steps across blocks and the block merge that finishes it, then
 * the slots. Fixed by the padded size alone, which is how the CPU encodes them blind.
 */
export function orderStepCount(entries: number) {
  let count = 2
  for (let stage = 2 * SORT_BLOCK; stage <= sortSize(entries); stage *= 2)
    count += Math.log2(stage / SORT_BLOCK) + 1
  return count
}

/** What the order of one pass reads, where: its plan regions and its part of the frame data. */
type OrderPass = {
  entries: number
  ownCount: number
  main: boolean
  region: { seeds: number; order: number; runs: number }
  ownSeedBase: number
  ownSlotBase: number
  ownKeyBase: number
}

/**
 * The dispatches of one pass, their uniform words written into `words` from step `first` on, one
 * step every `ORDER_STEP_STRIDE` bytes. Written once per plan: nothing here depends on the frame.
 */
export function planOrderSteps(pass: OrderPass, words: Uint32Array, first: number) {
  const size = sortSize(pass.entries),
    groups = size / SORT_BLOCK,
    steps: OrderStep[] = []
  const push = (entry: number, fields: Partial<Record<keyof typeof ORDER_UNI, number>>) => {
    const uniform = first + steps.length,
      at = uniform * STEP_WORDS
    words.fill(0, at, at + STEP_WORDS)
    words[at + ORDER_UNI.entryCount] = pass.entries
    words[at + ORDER_UNI.size] = size
    words[at + ORDER_UNI.seedBase] = pass.region.seeds
    words[at + ORDER_UNI.orderBase] = pass.region.order
    words[at + ORDER_UNI.runsBase] = pass.region.runs
    words[at + ORDER_UNI.ownSeedBase] = pass.ownSeedBase
    words[at + ORDER_UNI.ownSlotBase] = pass.ownSlotBase
    words[at + ORDER_UNI.ownCount] = pass.ownCount
    words[at + ORDER_UNI.gaps] = pass.main ? 1 : 0
    words[at + ORDER_UNI.ownKeyBase] = pass.ownKeyBase
    for (const [name, value] of Object.entries(fields))
      words[at + ORDER_UNI[name as keyof typeof ORDER_UNI]] = value
    steps.push({
      entry,
      // The slot kernel runs one thread per own entry, one for the lone gap of a pass without.
      groups: entry === SLOTS ? Math.ceil(Math.max(1, pass.ownCount) / SLOT_GROUP) : groups,
      uniform,
    })
  }
  push(BLOCKS, { fresh: 1, stageFrom: 2, stageTo: SORT_BLOCK, last: size === SORT_BLOCK ? 1 : 0 })
  for (let stage = 2 * SORT_BLOCK; stage <= size; stage *= 2) {
    for (let step = stage / 2; step >= SORT_BLOCK; step /= 2) push(STEP, { stageTo: stage, step })
    push(BLOCKS, { stageFrom: stage, stageTo: stage, last: stage === size ? 1 : 0 })
  }
  push(SLOTS, {})
  return steps
}
