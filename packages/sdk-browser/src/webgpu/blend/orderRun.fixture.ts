// The order kernel (`orderWgsl.ts`) run in JavaScript (`shaderRun`), one dispatch at a time, a
// block sort barrier by barrier: what `orderKernel.fixture.ts` replays a pass with and what a fake
// device dispatches (`tests/kit/gpu/fakeComputeBlend.ts`).
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { BLEND_ORDER_SHADER, SORT_BLOCK } from './orderWgsl.ts'

type Vec = number[]
type OrderKernel = {
  itemKey(item: number): Vec
  sortLoad(p: number): Vec
  sortStore(p: number, v: Vec): void
  blockPair(t: number, j: number, k: number, base: number): void
  sortBlendStep(lid: Vec, wid: Vec, n: Vec): void
  placeBlendSlots(id: Vec, n: Vec): void
}

/** The buffers the kernel binds, under their WGSL names, and its workgroup memory (`held`): the
 *  uniform as an object of its fields, `sorted` as an array of its `vec4u`. */
type OrderScope = {
  uni: Record<string, number>
  plan: ArrayLike<number>
  keyed: ArrayLike<number>
  frame: ArrayLike<number>
  sorted: Vec[]
  placed: ArrayLike<number>
  held: Vec[]
}

/** Every function the kernel declares, read from its text. */
const NAMES = [...BLEND_ORDER_SHADER.matchAll(/\bfn (\w+)\(/g)].map((match) => match[1])
/** Threads of a block or step dispatch: one per compare-exchange. */
const THREADS = SORT_BLOCK / 2

/** The kernel's functions over `scope`, whose uniform fields a dispatch sets in place. */
export const orderKernelOf = (scope: OrderScope) =>
  shaderRun<OrderKernel>(BLEND_ORDER_SHADER, NAMES, scope)

/**
 * One dispatch of `groups` workgroups of entry point `entry` (its rank in `BLEND_ORDER_ENTRIES`)
 * under the uniform `scope.uni` holds: a block sort (`sortBlendBlocks`) replayed barrier by barrier
 * over its workgroup memory, a step across blocks or the slots one thread after the other.
 */
export function runOrderDispatch(
  kernel: OrderKernel,
  scope: OrderScope,
  entry: number,
  groups: number,
) {
  const { uni, held } = scope
  if (entry === 1) {
    for (let group = 0; group < groups; group++)
      for (let t = 0; t < THREADS; t++)
        kernel.sortBlendStep([t, 0, 0], [group, 0, 0], [groups, 1, 1])
    return
  }
  if (entry === 2) {
    for (let r = 0; r < groups * WORKGROUP_THREADS; r++)
      kernel.placeBlendSlots([r, 0, 0], [groups, 1, 1])
    return
  }
  for (let group = 0; group < groups; group++) {
    const base = group * SORT_BLOCK
    // A block of the last row past the size has nothing to sort.
    if (base >= uni.size) continue
    for (let t = 0; t < THREADS; t++) {
      held[t] = kernel.sortLoad(base + t)
      held[t + THREADS] = kernel.sortLoad(base + t + THREADS)
    }
    for (let k = uni.stageFrom; k <= uni.stageTo; k <<= 1)
      for (let j = Math.min(k >> 1, THREADS); j > 0; j >>= 1)
        for (let t = 0; t < THREADS; t++) kernel.blockPair(t, j, k, base)
    for (let t = 0; t < THREADS; t++) {
      kernel.sortStore(base + t, held[t])
      kernel.sortStore(base + t + THREADS, held[t + THREADS])
    }
  }
}
