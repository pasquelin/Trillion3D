// The order kernel run in JavaScript (`shaderRun`) on generated scenes, its block dispatch replayed
// barrier by barrier, against the CPU model: what `orderWgsl.test.ts` and `../slots.test.ts` read.
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { ORDER_UNI } from './orderWgsl.ts'
import { orderKernelOf, runOrderDispatch } from './orderRun.fixture.ts'
import { writeKeyRecords } from '../keyRecords.ts'
import { orderBlendPasses } from './order.ts'
import { cpuModel, orderBlendPlanCpu, refreshEyeKeys } from '../expand/expandCpu.fixture.ts'
import { refreshBlendPlan } from '../plan/plan.ts'
import { buildBlendStatics } from '../statics.ts'
import { uniformStride } from '../../session/memory/pools.ts'
import { planWords, RUN_WORDS } from '../plan/planLayout.ts'
import { createWebgpuBlendState, type BlendGpuItem, type WebgpuBlendState } from '../state.ts'
import type { TransparentTable } from '../transparent/table.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** The GPU buffers of one scene as plain arrays, and the kernel's functions over them. */
export function gpuOf(blendState: WebgpuBlendState) {
  const plan = new Array<number>(planWords(blendState.maxPlanEntries)).fill(0)
  blendState.seeds.forEach((entry, seed) => (plan[blendState.planRegion.seeds + seed] = entry))
  const scope = {
    uni: {} as Record<string, number>,
    plan,
    keyed: Array.from(writeKeyRecords(blendState)),
    frame: Array.from(blendState.frameWords.subarray(0, blendState.frameLayout.words)),
    sorted: [] as number[][],
    placed: [] as number[],
    held: [] as number[][],
  }
  return { scope, kernel: orderKernelOf(scope) }
}

/** Replays the dispatches of the pass's order, each at the workgroups its step encodes. */
function runOrder(blendState: WebgpuBlendState, gpu: ReturnType<typeof gpuOf>) {
  const { scope, kernel } = gpu,
    words = blendState.orderStepWords
  for (const step of blendState.orderSteps) {
    for (const [name, rank] of Object.entries(ORDER_UNI))
      scope.uni[name] = words[(step.uniform * blendState.uniformStride) / 4 + rank]
    runOrderDispatch(kernel, scope, step.entry, step.groups)
  }
  const region = blendState.planRegion,
    entries = blendState.seeds.length
  return {
    order: scope.plan.slice(region.order, region.order + entries),
    runs: scope.plan.slice(region.runs, region.runs + blendState.slotCount * RUN_WORDS),
  }
}

const MODES = ['normal', 'normal', 'normal', 'additive', 'multiply'] as const
/** The sides a pick names. */
const SIDES = ['front', 'back', 'double'] as const

/**
 * A scene on a coarse grid — equal keys are common — of items single and double-sided, mirrored or
 * not, in several blend modes, some transmissive, a few of another sort priority, a few without a
 * box or with a non-finite bound;
 * most have their clusters in the table, the others none there yet.
 */
export function transparentScene(count: number, seed: number) {
  const next = lcgRandom(seed)
  const pick = (n: number) => Math.floor(next() * n)
  const items: BlendGpuItem[] = []
  const ranges: number[] = []
  for (let i = 0; i < count; i++) {
    const x = pick(9) - 4,
      y = pick(5) - 2,
      z = pick(9) - 4
    const bounds = new Float64Array([x - 1, y - 1, z - 1, x + 1, y + 1, z + 1])
    if (next() < 0.03) bounds[pick(6)] = [NaN, Infinity, -Infinity][pick(3)]
    const matrix = new Matrix4().makeTranslation(x, y, z)
    // A mirrored placement flips which face each pipeline culls (`matrixWindingCw`).
    if (next() < 0.2) matrix.elements[0] = -1
    const held = next() < 0.75
    const transmissive = next() < 0.15
    const blending = transmissive ? 'normal' : MODES[pick(MODES.length)]
    const item = {
      surface: surfaceOf(G.basicSurface({ side: SIDES[pick(3)], transparent: true, blending })),
      matrix,
      transmissive,
      bounds: next() < 0.9 ? bounds : undefined,
      // A few items of another sort priority, painted before or after the others.
      priority: next() < 0.1 ? pick(3) - 1 : 0,
    } as unknown as BlendGpuItem
    if (held) {
      item.pagedIndex = ranges.length / 2
      ranges.push(ranges.length * 4, 1 + pick(3))
    }
    items.push(item)
  }
  const blendState = createWebgpuBlendState()
  blendState.blendGpu.push(...items)
  blendState.table = {
    maxVertexWords: 48,
    length: ranges.length / 2,
    itemRanges: Uint32Array.from(ranges),
  } as unknown as TransparentTable
  buildBlendStatics(blendState, uniformStride())
  refreshBlendPlan(blendState)
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  return { blendState, next }
}

/** One frame ranked from `eye`: the kernel's order and slots against the model's. */
export function checkKernel(blendState: WebgpuBlendState, eye: number[], what: string) {
  orderBlendPasses(blendState, eye)
  const gpu = gpuOf(blendState)
  refreshEyeKeys(blendState, eye)
  if (!blendState.seeds.length) return
  const got = runOrder(blendState, gpu)
  const model = Array.from(orderBlendPlanCpu(blendState))
  assert.deepEqual(got.order, model, `${what}: order`)
  assert.deepEqual(
    got.runs,
    Array.from(cpuModel(blendState).runs.subarray(0, got.runs.length)),
    `${what}: slots`,
  )
}
