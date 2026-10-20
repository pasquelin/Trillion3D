import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { blendExpandDispatch } from './expandWgsl.ts'
import { dispatchRows } from '../../gpu/dispatch/grid.ts'
import type { OrderStep } from './orderSteps.ts'
import { destroyAll } from '../../gpu/core/errorScope.ts'
import { blendExpandUniform } from './runs.ts'
import { UNI_WORDS } from './expandUniform.ts'
import type { UniformSlots } from '../../residency/pools.ts'
import { writeChangedSlots } from '../../gpu/core/writeChanged.ts'
import { bindKernels, EXPANSION_REFUSED, type BlendKernels, type Kernel } from './expandKernels.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { arrayView } from '../../gpu/core/textureViews.ts'
import { COLD_TABLE } from '../../gpu/dag/cutTables.ts'
import {
  expandBuffers,
  expandSlots,
  type ExpandBuffers,
  type ExpandSizes,
  type ExpandSlots,
} from './expandBuffers.ts'
import { VERDICT_GROUP } from './verdictWgsl.ts'
import { VERDICT_WORDS } from './verdictLayout.ts'
import { createVerdictRead } from './verdictRead.ts'

export type BlendExpand = ReturnType<typeof expandApi>

/** What a plan sends the kernels: never per frame. */
type BlendPlanUpload = {
  /** The pass's seeded entries, its counts and its plan region. */
  seeds: Uint32Array
  counts: { entries: number; runs: number; instanceBase: number }
  region: { seeds: number; order: number; runs: number; args: number }
  scene: { maxVertexWords: number; vertexShift: number }
  /** The order kernel's dispatch words (`orderSteps.ts`), laid as its steps' slots, and the items'
   *  key records. */
  stepWords: Uint32Array<ArrayBuffer>
  keyWords: Uint32Array
}

/**
 * SCENE OBJECT OF THE KERNELS: what they hold per frame, and nothing of the factory that mounted
 * them.
 *
 * Written apart from `createBlendExpand` on purpose: closures returned from the factory would
 * retain its compiled modules, layouts and fallback closures, none of which serve after creation.
 */
function expandApi(
  device: GPUDevice,
  buffers: ExpandBuffers,
  kernels: ReturnType<typeof bindKernels>,
  items: number,
  slots: ExpandSlots,
  made: GPUBuffer[],
) {
  // Bound where the cut follows no world: the verdict reads no cell then (\`cellDraws\`).
  const noCells = standInTexture(device, 'Trillion3D blend verdict no cells', COLD_TABLE.format),
    noCellsView = arrayView(noCells)
  const uni = new Uint32Array(UNI_WORDS)
  // The array encoding rereads in place: four expansion dispatches.
  const launches = [0, 0, 0, 0]
  const write = (buffer: GPUBuffer, word: number, source: Uint32Array, words?: number) =>
    writeWords(device.queue, buffer, word, source, words)
  const { order, expansion, verdict } = kernels
  const read = createVerdictRead(device)
  return {
    /** The last verdict counts that came back (`verdictRead.ts`). */
    counts: read.latest,
    /** Static description of each item, four words (`buildBlendStatics`): its paged rank, the
     *  instances the table holds of it, its table base, a fourth word unused. */
    uploadDraws(packed: Uint32Array) {
      write(buffers.draws, 0, packed, items * 4)
    },
    /** What a new plan changes: the pass's seeds and expansion uniform, the order's dispatch
     *  words, the key records. */
    uploadPlan(plan: BlendPlanUpload) {
      if (plan.seeds.length) write(buffers.plan, plan.region.seeds, plan.seeds)
      blendExpandUniform(uni, plan.counts, plan.region, plan.scene)
      device.queue.writeBuffer(buffers.uniforms, slots.pass.offset(0)[0], uni)
      sendSteps(device, buffers.steps, plan.stepWords, slots.steps)
      if (plan.keyWords.length) write(buffers.keyed, 0, plan.keyWords)
    },
    /** Key records rewritten between two plans (`writeMovedKeyRecords`), from word `first`. */
    uploadKeys(first: number, words: Uint32Array) {
      write(buffers.keyed, first, words)
    },
    /** The frame's head, own keys and own seeds: the only words a frame sends the kernels. */
    uploadFrame(words: Uint32Array, count: number) {
      write(buffers.frame, 0, words, count)
    },
    /** The verdict's counts zeroed, before the compute pass that judges. */
    clearVerdict(encoder: GPUCommandEncoder) {
      encoder.clearBuffer(buffers.verdict, 0, VERDICT_WORDS * 4)
    },
    /** The frustum verdict of every item (`verdictWgsl.ts`), first in the open compute pass, on
     *  the cut's cold words `cells` where the world's cell states lie, if it follows one. */
    judge(encoder: GPUComputePassEncoder, cells: GPUTextureView | undefined) {
      encoder.setPipeline(verdict.pipelines[0])
      encoder.setBindGroup(0, verdict.groupOn(cells ?? noCellsView))
      dispatchRows(encoder, workgroupCount(items, VERDICT_GROUP))
    },
    /** The pass ordered (`steps`) then expanded, in the open compute pass. */
    encode(
      encoder: GPUComputePassEncoder,
      steps: readonly OrderStep[],
      counts: { entries: number; runs: number },
    ) {
      encodeOrder(encoder, order, steps, slots.steps)
      encoder.setBindGroup(0, expansion.group, slots.pass.offset(0))
      blendExpandDispatch(launches, counts.entries, counts.runs)
      for (let step = 0; step < expansion.pipelines.length; step++) {
        encoder.setPipeline(expansion.pipelines[step])
        dispatchRows(encoder, launches[step])
      }
    },
    /** This image's counts to the readback, under the verdict's `epoch`, once the pass ended. */
    readCounts(encoder: GPUCommandEncoder, epoch: number) {
      read.copy(encoder, buffers.verdict, epoch)
    },
    /** After the image's submit: its counts map. */
    submitted: read.submitted,
    dispose() {
      read.destroy()
      noCells.destroy()
      for (const buffer of made) buffer.destroy()
    },
  }
}

/** A plan's order step words up to `buffer`, laid as `slots`: what changed of each step's words,
 *  in one write as the whole steps once went — never the padding up to the device's alignment,
 *  never more writes. A plan laid on another stride than the kernels bind is refused, never
 *  misread. */
function sendSteps(
  device: GPUDevice,
  buffer: GPUBuffer,
  words: Uint32Array<ArrayBuffer>,
  slots: UniformSlots,
) {
  if (words.length !== slots.bytes / 4) throw new Error(STEP_LAYOUT)
  writeChangedSlots(device, buffer, words, slots, 0, slots.count, 'one')
}

/** `words` of `source` — all of them by default — written from word `word` of `buffer`. */
const writeWords = (
  queue: GPUQueue,
  buffer: GPUBuffer,
  word: number,
  source: Uint32Array,
  words = source.length,
) => queue.writeBuffer(buffer, word * 4, source.buffer as ArrayBuffer, source.byteOffset, words * 4)

/** The order's dispatches, each step at its uniform slot's dynamic offset. */
function encodeOrder(
  encoder: GPUComputePassEncoder,
  order: Kernel,
  steps: readonly OrderStep[],
  slots: UniformSlots,
) {
  let bound: GPUComputePipeline | undefined
  for (const step of steps) {
    const pipeline = order.pipelines[step.entry]
    if (pipeline !== bound) encoder.setPipeline((bound = pipeline))
    encoder.setBindGroup(0, order.group, slots.offset(step.uniform))
    dispatchRows(encoder, step.groups)
  }
}

/** A plan's step words not laid as the kernels' step slots. */
const STEP_LAYOUT = 'WEBGPU_BLEND_STEP_LAYOUT'

/**
 * The scene buffers of the kernels, and the kernels bound to them. Nothing is allocated per frame.
 * What a frame gives fits in one write: its head — the eye, the frustum planes —
 * with the own entries' keys and order. What it gets is the frustum verdict, the instance list the
 * blend shader reads and one indirect argument per slot — never per item. A refusal releases what
 * was made.
 */
export function mountBlendExpand(
  device: GPUDevice,
  kernels: BlendKernels,
  sizes: ExpandSizes,
  shared: { counts: GPUBuffer | undefined; clusters: GPUBuffer | undefined },
  outputs: { expanded: GPUBuffer; args: GPUBuffer },
) {
  const made: GPUBuffer[] = []
  try {
    const slots = expandSlots(device, sizes.entries)
    const buffers = expandBuffers(device, sizes, slots, made)
    const bound = bindKernels(device, kernels, buffers, shared, outputs)
    return expandApi(device, buffers, bound, sizes.items, slots, made)
  } catch (error) {
    destroyAll(made)
    throw new Error(EXPANSION_REFUSED, { cause: error })
  }
}
