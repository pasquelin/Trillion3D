// The order kernel run in JavaScript (`shaderRun`) on generated scenes, its block dispatch replayed
// barrier by barrier, against the CPU model: what `orderWgsl.test.ts` and `slots.test.ts` read.
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../page/surface.ts'
import { ORDER_UNI } from './orderWgsl.ts'
import { orderKernelOf, runOrderDispatch } from './orderRun.fixture.ts'
import { writeKeyRecords } from './keyRecords.ts'
import { orderBlendPasses } from './order.ts'
import { cpuModel, orderBlendPlanCpu, refreshEyeKeys } from './expandCpu.fixture.ts'
import { refreshBlendPlan } from './plan.ts'
import { buildBlendStatics } from './statics.ts'
import { uniformStride } from '../../residency/pools.ts'
import { planWords, RUN_WORDS } from './planLayout.ts'
import { createWebgpuBlendState, type BlendGpuItem, type WebgpuBlendState } from './state.ts'
import type { TransparentTable } from '../transparent/table.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** The GPU buffers of one scene as plain arrays, and the kernel's functions over them. */
export function gpuOf(blendState: WebgpuBlendState) {
  const plan = new Array<number>(planWords(blendState.maxPlanEntries)).fill(0)
  blendState.seeds.forEach((seeds, pass) => {
    seeds.forEach((entry, seed) => (plan[blendState.planRegions[pass].seeds + seed] = entry))
  })
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

/** Replays the dispatches of one pass's order, each at the workgroups its step encodes. */
function runOrder(blendState: WebgpuBlendState, pass: number, gpu: ReturnType<typeof gpuOf>) {
  const { scope, kernel } = gpu,
    words = blendState.orderStepWords
  for (const step of blendState.orderSteps[pass]) {
    for (const [name, rank] of Object.entries(ORDER_UNI))
      scope.uni[name] = words[(step.uniform * blendState.uniformStride) / 4 + rank]
    runOrderDispatch(kernel, scope, step.entry, step.groups)
  }
  const region = blendState.planRegions[pass],
    entries = blendState.seeds[pass].length
  return {
    order: scope.plan.slice(region.order, region.order + entries),
    runs: scope.plan.slice(region.runs, region.runs + blendState.slotCounts[pass] * RUN_WORDS),
  }
}

const MODES = ['normal', 'normal', 'normal', 'additive', 'multiply'] as const
/** The sides a pick names. */
const SIDES = ['front', 'back', 'double'] as const

/**
 * A scene on a coarse grid — equal keys are common — of paged and unpaged items, single and
 * double-sided, mirrored or not, in several blend modes, some transmissive, a few without a box
 * or with a non-finite bound; paged items have their clusters in a table.
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
    const paged = next() < 0.75
    const transmissive = next() < 0.15
    const blending = transmissive ? 'normal' : MODES[pick(MODES.length)]
    const item = {
      surface: surfaceOf(G.basicSurface({ side: SIDES[pick(3)], transparent: true, blending })),
      matrix,
      count: paged ? 0 : 3 * (1 + pick(4)),
      paged,
      transmissive,
      bounds: next() < 0.9 ? bounds : undefined,
    } as unknown as BlendGpuItem
    if (paged) {
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

/** One frame ranked from `eye`: the kernel's order and slots of each pass against the model's. */
export function checkKernel(blendState: WebgpuBlendState, eye: number[], what: string) {
  orderBlendPasses(blendState, eye)
  const gpu = gpuOf(blendState)
  refreshEyeKeys(blendState, eye)
  for (let pass = 0; pass < 2; pass++) {
    if (!blendState.seeds[pass].length) continue
    const got = runOrder(blendState, pass, gpu)
    const model = Array.from(orderBlendPlanCpu(blendState, pass))
    assert.deepEqual(got.order, model, `${what}, pass ${pass}: order`)
    assert.deepEqual(
      got.runs,
      Array.from(cpuModel(blendState).runs[pass].subarray(0, got.runs.length)),
      `${what}, pass ${pass}: slots`,
    )
  }
}
