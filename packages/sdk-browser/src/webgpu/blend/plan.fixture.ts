import { buildBlendStatics, planItem, refreshBlendPlan } from './plan.ts'
import { cpuModel, orderBlendPlanCpu, orderEye, refreshEyeKeys } from './expandCpu.fixture.ts'
import { RUN_WORDS } from './planLayout.ts'
import { precedes } from './paintOrder.ts'
import { createWebgpuBlendState, type BlendGpuItem } from './state.ts'

/** A blend state holding `items`, its statics and encoding plan built as a frame would. */
export function blendSceneOf(items: readonly BlendGpuItem[]) {
  const blendState = createWebgpuBlendState()
  blendState.blendGpu.push(...items)
  buildBlendStatics(blendState)
  refreshBlendPlan(blendState)
  return blendState
}

/**
 * What a frame's ranking leaves for the GPU and the draws — the own entries in paint order, the
 * slots and the frame words — with each pass's whole paint order and slot runs as the CPU model of
 * the order kernel gives them (`orderBlendPlanCpu`): what the ranking tests compare.
 */
export function paintOutcome(blendState: ReturnType<typeof blendSceneOf>) {
  const drawn = blendState.runCount.some(Boolean)
  if (drawn) refreshEyeKeys(blendState, orderEye(blendState))
  return {
    runCount: [...blendState.runCount],
    ownSeeds: blendState.ownSeeds.map((own) => Array.from(own)),
    frame: drawn ? Array.from(blendState.frameWords.subarray(0, blendState.frameLayout.words)) : [],
    orders: blendState.seeds.map((_, pass) =>
      blendState.runCount[pass] ? Array.from(orderBlendPlanCpu(blendState, pass)) : [],
    ),
    runs: cpuModel(blendState).runs.map((runs, pass) =>
      Array.from(runs.subarray(0, blendState.runCount[pass] * RUN_WORDS)),
    ),
  }
}

/**
 * The paint order of a pass's `seeds` from scratch: every entry by `precedes` on its item's key
 * (`keys`, by item) and rank — its index —, a double-sided item's back before its face — what the
 * GPU order, the CPU model and the own entries the CPU ranks must all match.
 */
export function referenceOrder(seeds: Uint32Array, keys: ArrayLike<number>) {
  return Array.from(seeds.keys())
    .sort((a, b) => {
      const [x, y] = [planItem(seeds[a]), planItem(seeds[b])]
      if (precedes(keys[x], x, keys[y], y)) return 1
      if (precedes(keys[y], y, keys[x], x)) return -1
      return a - b
    })
    .map((seed) => seeds[seed])
}
