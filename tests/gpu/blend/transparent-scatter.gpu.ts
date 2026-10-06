// The transparent plan's expansion says on the GPU what its CPU model says. One semantics, two
// implementations: the WGSL kernel production runs (`webgpu/blend/expandWgsl.ts`) and the CPU model
// (`webgpu/blend/expandCpu.ts`), the fallback of a device without compute and the oracle elsewhere.
// The kernel runs on the model's own inputs, slots laid by production (`assignOwnSlots`,
// `placeBlendSlots`) and its uniform by the production writer; the expanded instance list and each
// run's indirect arguments must match word for word.
import test from 'node:test'
import assert from 'node:assert/strict'
import { expandBlendPlan } from '../../../packages/sdk-browser/src/webgpu/blend/expandCpu.ts'
import {
  assignOwnSlots,
  blendExpandUniform,
  placeBlendSlots,
} from '../../../packages/sdk-browser/src/webgpu/blend/runs.ts'
import {
  RUN_WORDS,
  slotCapacity,
} from '../../../packages/sdk-browser/src/webgpu/blend/planLayout.ts'
import { UNI_WORDS } from '../../../packages/sdk-browser/src/webgpu/blend/expandUniform.ts'
import { DRAW_UNPAGED, planPipeline } from '../../../packages/sdk-browser/src/webgpu/blend/plan.ts'
import {
  PLAN_SHARED_BIT,
  planEntry,
} from '../../../packages/sdk-browser/src/webgpu/blend/planEntry.ts'
import { xorshiftRandom as seeded } from '../../../bench/core/index.ts'
import { expandOnGpu } from './scatterKernel.ts'

const next = seeded(1789)
/** The vertex words of the widest item, and the clusters an item holds. */
const VERTEX_WORDS = 48,
  CLUSTERS = 6

/**
 * One plan: paged items that share a run, primitives that carry their own buffers and split the
 * run, a frustum that rejects some of them, and entries enough that several count packets follow
 * each other — where the running sum is proved.
 */
function plan(items: number, unpaged: number[], base: { instances: number; args: number }) {
  const draws = new Uint32Array(items * 4),
    counts = new Uint32Array(items),
    clusters = new Uint32Array(items * CLUSTERS),
    keep = new Uint32Array((items + 31) >> 5)
  for (let item = 0; item < items; item++) {
    const own = unpaged.includes(item)
    draws[item * 4] = own ? DRAW_UNPAGED : item
    draws[item * 4 + 1] = own ? 1 + Math.floor(next() * 4) : CLUSTERS
    draws[item * 4 + 2] = item * CLUSTERS
    draws[item * 4 + 3] = own ? 3 * (1 + Math.floor(next() * 5)) : 0
    counts[item] = Math.floor(next() * (CLUSTERS + 1))
    for (let j = 0; j < CLUSTERS; j++) clusters[item * CLUSTERS + j] = 7000 + item * CLUSTERS + j
    if (next() < 0.8) keep[item >> 5] |= 1 << (item & 31)
  }
  // The sorted plan: paint order, the share bit and the pipeline in the low bits.
  const order = new Uint32Array(items)
  for (let i = 0; i < items; i++) {
    const item = (items - 1 - i + 17) % items
    order[i] = planEntry(item, i % 3 === 0 ? 2 : 1, !unpaged.includes(item))
  }
  // Production's slots: the shared entries of pipeline 1 are the main class, the others draw
  // their own; the plan is already in paint order, each seed in place.
  const seeds = Uint32Array.from(
    Array.from(order.keys()).filter(
      (at) => !(order[at] & PLAN_SHARED_BIT) || planPipeline(order[at]) !== 1,
    ),
  )
  const slots = new Uint32Array(seeds.length),
    runCount = assignOwnSlots(order, seeds, true, slots, new Int32Array(slotCapacity(items)))
  const runs = new Uint32Array(slotCapacity(items) * RUN_WORDS)
  placeBlendSlots(runs, Uint32Array.from(order.keys()), { seeds, slots }, items, true)
  return { items, draws, keep, counts, clusters, order, runs, runCount, base }
}

test('the expansion kernel writes what its CPU model writes, word for word', async () => {
  for (const input of [
    plan(7, [3], { instances: 0, args: 0 }),
    plan(200, [11, 12, 90], { instances: 40, args: 32 }),
  ]) {
    const instanceWords = (input.base.instances + input.items * CLUSTERS * 4) * 2
    const argsWords = input.base.args + input.runCount * 4
    const expanded = new Uint32Array(instanceWords),
      args = new Uint32Array(argsWords)
    expandBlendPlan({
      order: input.order,
      runs: input.runs,
      runCount: input.runCount,
      draws: input.draws,
      keep: input.keep,
      itemCounts: input.counts,
      instances: input.clusters,
      maxVertexWords: VERTEX_WORDS,
      vertexShift: 6,
      instanceBase: input.base.instances,
      argsBase: input.base.args,
      expanded,
      args,
    })
    // The indirect counts the compaction writes: four words per item, the count in the second.
    const counts = new Uint32Array(input.items * 4)
    for (let item = 0; item < input.items; item++) counts[item * 4 + 1] = input.counts[item]
    const gpu = await expandOnGpu({
      uniform: blendExpandUniform(
        new Uint32Array(UNI_WORDS),
        { entries: input.order.length, runs: input.runCount, instanceBase: input.base.instances },
        { order: 0, runs: input.order.length, args: input.base.args },
        { maxVertexWords: VERTEX_WORDS, vertexShift: 6 },
      ),
      plan: Uint32Array.of(...input.order, ...input.runs.subarray(0, input.runCount * RUN_WORDS)),
      entries: input.order.length,
      runs: input.runCount,
      keep: input.keep,
      draws: input.draws,
      counts,
      clusters: input.clusters,
      instanceWords,
      argsWords,
    })
    console.log(`${input.items} items in ${input.runCount} runs on ${gpu.adapter}: GPU = model`)
    assert.deepEqual(gpu.expanded, expanded, `${input.items} items: the expanded list`)
    assert.deepEqual(gpu.args, args, `${input.items} items: the indirect arguments`)
  }
})
