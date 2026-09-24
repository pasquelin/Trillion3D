// SPREAD OF THE TRANSPARENT PLAN, ACTUALLY RUN ON THE GPU.
//
// The "transparents in a few orders" batch has two implementations of one semantics: the WGSL
// kernel (`packages/sdk-browser/src/webgpu/blend/expandWgsl.ts`), which production uses, and the CPU model
// (`packages/sdk-browser/src/webgpu/blend/expandCpu.ts`), which is the fallback for devices without a compute stage and
// the oracle everywhere else — the test double replays it, and the bench compares it to the
// path from before.
//
// None of that proves the KERNEL says the same thing. This script actually runs it in Chromium
// WebGPU, on the same inputs as the model, and compares both outputs word for word: the
// expanded instance list and the indirect argument of each run.
//
// node --experimental-strip-types \
//   tests/browser/probes/transparent-scatter-gpu.ts
import assert from 'node:assert/strict';
import { expandBlendPlan } from '../../../packages/sdk-browser/src/webgpu/blend/expandCpu.ts';
import {
  blendExpandUniform,
  buildBlendRuns,
  EXPAND_GROUP,
  RUN_WORDS,
  UNI_WORDS,
} from '../../../packages/sdk-browser/src/webgpu/blend/runs.ts';
import {
  BLEND_EXPAND_ENTRIES,
  BLEND_EXPAND_SHADER,
  blendExpandDispatch,
} from '../../../packages/sdk-browser/src/webgpu/blend/expandWgsl.ts';
import { blendExpandBindEntries } from '../../../packages/sdk-browser/src/webgpu/blend/expandBindings.ts';
import { DRAW_UNPAGED, planEntry } from '../../../packages/sdk-browser/src/webgpu/blend/plan.ts';
import { etalementGpu } from './scatterKernelGpu.ts';
import { graine } from '../../../bench/core/index.ts';

const alea = graine(1789);
const MOTS = 48,
  GRAPPES = 6;

interface CasBase {
  instances: number;
  args: number;
}

/**
 * One case: paged items that share a run, primitives that carry their own buffers and split the
 * run, a frustum that rejects some of them, and enough entries that several count packets follow
 * each other — that is where the running sum is proved.
 */
function cas(items: number, isoles: number[], base: CasBase) {
  const draws = new Uint32Array(items * 4),
    counts = new Uint32Array(items),
    clusters = new Uint32Array(items * GRAPPES),
    keep = new Uint32Array((items + 31) >> 5);
  for (let item = 0; item < items; item++) {
    const isole = isoles.includes(item);
    draws[item * 4] = isole ? DRAW_UNPAGED : item;
    draws[item * 4 + 1] = isole ? 1 + Math.floor(alea() * 4) : GRAPPES;
    draws[item * 4 + 2] = item * GRAPPES;
    draws[item * 4 + 3] = isole ? 3 * (1 + Math.floor(alea() * 5)) : 0;
    counts[item] = Math.floor(alea() * (GRAPPES + 1));
    for (let j = 0; j < GRAPPES; j++) clusters[item * GRAPPES + j] = 7000 + item * GRAPPES + j;
    if (alea() < 0.8) keep[item >> 5] |= 1 << (item & 31);
  }
  // The sorted plan: paint order, with the share bit and the pipeline in the low bits.
  const order = new Uint32Array(items);
  for (let i = 0; i < items; i++) {
    const item = (items - 1 - i + 17) % items;
    order[i] = planEntry(item, i % 3 === 0 ? 2 : 1, !isoles.includes(item));
  }
  // The split into runs is PRODUCTION's, not a copy: a "GPU = model" proof that replayed its
  // own splitter would prove nothing of the shipped path.
  const runs = new Uint32Array(items * RUN_WORDS);
  const count = buildBlendRuns(order, runs);
  // The indirect count compaction writes: four words per item, the count in the second.
  const indirect = new Uint32Array(items * 4);
  for (let item = 0; item < items; item++) indirect[item * 4 + 1] = counts[item];
  return { items, draws, keep, counts, indirect, clusters, order, runs, runCount: count, base };
}

type CasEntry = ReturnType<typeof cas>;

/** The CPU model, on the same inputs: that is what the kernel must repeat. */
function attendu(entree: CasEntry, instanceWords: number, argsWords: number) {
  const expanded = new Uint32Array(instanceWords),
    args = new Uint32Array(argsWords);
  expandBlendPlan({
    order: entree.order,
    runs: entree.runs,
    runCount: entree.runCount,
    draws: entree.draws,
    keep: entree.keep,
    itemCounts: entree.counts,
    instances: entree.clusters,
    maxVertexWords: MOTS,
    vertexShift: 6,
    instanceBase: entree.base.instances,
    argsBase: entree.base.args,
    expanded,
    args,
  });
  return { expanded, args };
}

/** The twelve uniform words, set by the production writer: one layout. */
const uniformeDe = (entree: CasEntry) =>
  Array.from(
    blendExpandUniform(
      new Uint32Array(UNI_WORDS),
      { entries: entree.order.length, runs: entree.runCount, instanceBase: entree.base.instances },
      { order: 0, runs: entree.order.length, args: entree.base.args },
      { maxVertexWords: MOTS, vertexShift: 6 },
    ),
  );

const entrees = [
  cas(7, [3], { instances: 0, args: 0 }),
  cas(200, [11, 12, 90], { instances: 40, args: 32 }),
];
for (const entree of entrees) {
  const instanceWords = (entree.base.instances + entree.items * GRAPPES * 4) * 2;
  const argsWords = entree.base.args + entree.runCount * 4;
  const modele = attendu(entree, instanceWords, argsWords);
  const carte = await etalementGpu({
    code: BLEND_EXPAND_SHADER,
    uni: uniformeDe(entree),
    plan: Array.from(entree.order).concat(Array.from(entree.runs)),
    keep: Array.from(entree.keep),
    draws: Array.from(entree.draws),
    indirect: Array.from(entree.indirect),
    clusters: Array.from(entree.clusters),
    scratchWords: entree.order.length + Math.ceil(entree.order.length / EXPAND_GROUP),
    layoutEntries: blendExpandBindEntries(),
    noms: BLEND_EXPAND_ENTRIES,
    lancements: blendExpandDispatch([], entree.order.length, entree.runCount),
    uniBytes: UNI_WORDS * 4,
    instanceWords,
    argsWords,
  });
  assert.ok(carte, 'the page did open a WebGPU device');
  assert.deepEqual(carte.compilation, [], 'the kernel compiles without error');
  assert.deepEqual(carte.expanded, Array.from(modele.expanded), 'the expanded list, word for word');
  assert.deepEqual(carte.args, Array.from(modele.args), 'the indirect arguments, word for word');
  console.log(`spread of ${entree.items} items in ${entree.runCount} runs: GPU = model`);
}
