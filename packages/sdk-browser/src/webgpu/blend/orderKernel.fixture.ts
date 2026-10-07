// The order kernel run in JavaScript (`shaderRun`) on generated scenes, its block dispatch replayed
// barrier by barrier, against the CPU model: what `orderWgsl.test.ts` and `slots.test.ts` read.
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { hostBlending } from '../../scene/materialBlending.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { BLEND_ORDER_SHADER, ORDER_UNI, SLOT_GROUP, SORT_BLOCK } from './orderWgsl.ts'
import { writeKeyRecords } from './keyRecords.ts'
import { orderBlendPasses } from './order.ts'
import { cpuModel, orderBlendPlanCpu, refreshEyeKeys } from './expandCpu.fixture.ts'
import { buildBlendStatics, refreshBlendPlan } from './plan.ts'
import { planWords, RUN_WORDS } from './planLayout.ts'
import { createWebgpuBlendState, type BlendGpuItem } from './state.ts'
import type { TransparentTable } from '../transparent/table.ts'

type BlendState = ReturnType<typeof createWebgpuBlendState>
type Vec = number[]
type Kernel = {
  itemKey(item: number): Vec
  sortLoad(p: number): Vec
  sortStore(p: number, v: Vec): void
  blockPair(t: number, j: number, k: number, base: number): void
  sortBlendStep(lid: Vec, wid: Vec, n: Vec): void
  placeBlendSlots(id: Vec, n: Vec): void
}

/** Every function the kernel declares, read from its text. */
const NAMES = [...BLEND_ORDER_SHADER.matchAll(/\bfn (\w+)\(/g)].map((match) => match[1])
/** Threads of a block or step dispatch: one per compare-exchange. */
const THREADS = SORT_BLOCK / 2

/** The GPU buffers of one scene as plain arrays, and the kernel's functions over them. */
export function gpuOf(blendState: BlendState) {
  const plan = new Array<number>(planWords(blendState.maxPlanEntries)).fill(0)
  blendState.seeds.forEach((seeds, pass) => {
    seeds.forEach((entry, seed) => (plan[blendState.planRegions[pass].seeds + seed] = entry))
  })
  const scope = {
    uni: {} as Record<string, number>,
    plan,
    keyed: Array.from(writeKeyRecords(blendState)),
    frame: Array.from(blendState.frameWords.subarray(0, blendState.frameLayout.words)),
    sorted: [] as Vec[],
    placed: [] as number[],
    held: [] as Vec[],
    countLeadingZeros: (x: number) => Math.clz32(x),
  }
  return { scope, kernel: shaderRun<Kernel>(BLEND_ORDER_SHADER, NAMES, scope) }
}

/** Replays the dispatches of one pass's order, a block dispatch barrier by barrier. */
function runOrder(blendState: BlendState, pass: number, gpu: ReturnType<typeof gpuOf>) {
  const { scope, kernel } = gpu,
    words = blendState.orderStepWords
  for (const step of blendState.orderSteps[pass]) {
    for (const [name, rank] of Object.entries(ORDER_UNI))
      scope.uni[name] = words[(step.uniform * blendState.uniformStride) / 4 + rank]
    const { uni } = scope
    if (step.entry === 1) {
      for (let group = 0; group < step.groups; group++)
        for (let t = 0; t < THREADS; t++)
          kernel.sortBlendStep([t, 0, 0], [group, 0, 0], [step.groups, 1, 1])
      continue
    }
    if (step.entry === 2) {
      for (let r = 0; r < step.groups * SLOT_GROUP; r++)
        kernel.placeBlendSlots([r, 0, 0], [step.groups, 1, 1])
      continue
    }
    for (let group = 0; group < step.groups; group++) {
      const base = group * SORT_BLOCK
      for (let t = 0; t < THREADS; t++) {
        scope.held[t] = kernel.sortLoad(base + t)
        scope.held[t + THREADS] = kernel.sortLoad(base + t + THREADS)
      }
      for (let k = uni.stageFrom; k <= uni.stageTo; k <<= 1)
        for (let j = Math.min(k >> 1, THREADS); j > 0; j >>= 1)
          for (let t = 0; t < THREADS; t++) kernel.blockPair(t, j, k, base)
      for (let t = 0; t < THREADS; t++) {
        kernel.sortStore(base + t, scope.held[t])
        kernel.sortStore(base + t + THREADS, scope.held[t + THREADS])
      }
    }
  }
  const region = blendState.planRegions[pass],
    entries = blendState.seeds[pass].length
  return {
    order: scope.plan.slice(region.order, region.order + entries),
    runs: scope.plan.slice(region.runs, region.runs + blendState.slotCounts[pass] * RUN_WORDS),
  }
}

const MODES = ['normal', 'normal', 'normal', 'additive', 'multiply'] as const

/**
 * A scene on a coarse grid — equal keys are common — of paged and unpaged items, single and
 * double-sided, mirrored or not, in several blend modes, some transmissive, a few without a box
 * or with a non-finite bound; paged items have their clusters in a table.
 */
export function transparentScene(count: number, seed: number) {
  const next = random(seed)
  const pick = (n: number) => Math.floor(next() * n)
  const items: BlendGpuItem[] = []
  const ranges: number[] = []
  for (let i = 0; i < count; i++) {
    const x = pick(9) - 4,
      y = pick(5) - 2,
      z = pick(9) - 4
    const bounds = new Float64Array([x - 1, y - 1, z - 1, x + 1, y + 1, z + 1])
    if (next() < 0.03) bounds[pick(6)] = [NaN, Infinity, -Infinity][pick(3)]
    const matrix = new G.Matrix4().makeTranslation(x, y, z)
    // A mirrored placement flips which face each pipeline culls (`matrixWindingCw`).
    if (next() < 0.2) matrix.elements[0] = -1
    const paged = next() < 0.75
    const transmissive = next() < 0.15
    const blending = transmissive ? 'normal' : MODES[pick(MODES.length)]
    const item = {
      surface: surfaceOf(
        G.basicSurface({ side: pick(3), transparent: true, blending: hostBlending(blending) }),
      ),
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
  buildBlendStatics(blendState)
  refreshBlendPlan(blendState)
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  return { blendState, next }
}

/** One frame ranked from `eye`: the kernel's order and slots of each pass against the model's. */
export function checkKernel(blendState: BlendState, eye: number[], what: string) {
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
