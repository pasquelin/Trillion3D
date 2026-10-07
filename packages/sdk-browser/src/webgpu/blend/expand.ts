import { BLEND_EXPAND_ENTRIES, BLEND_EXPAND_SHADER, blendExpandDispatch } from './expandWgsl.ts'
import { blendExpandBindEntries, EXPAND_BINDING } from './expandBindings.ts'
import {
  BLEND_ORDER_ENTRIES,
  BLEND_ORDER_SHADER,
  blendOrderBindEntries,
  KEY_RECORD_WORDS,
  ORDER_BINDING,
  ORDER_UNI_WORDS,
  orderFrameWords,
} from './orderWgsl.ts'
import { ORDER_STEP_STRIDE, orderStepCount, sortSize, type OrderStep } from './orderSteps.ts'
import { namedBufferEntries } from '../../gpu/core/computeBindings.ts'
import { shaderFailed } from '../../gpu/core/shaderModule.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { cleanupFailedHiz } from '../../gpu/hiz/pipelines.ts'
import { blendExpandUniform } from './runs.ts'
import { EXPAND_PASSES } from './planLayout.ts'
import { UNI_WORDS } from './expandUniform.ts'
import { UNIFORM_STRIDE } from './uniforms.ts'

export type BlendExpand = ReturnType<typeof expandApi>

/** One compute kernel as the frame binds it: its group, and its pipelines by entry rank. */
type Kernel = { group: GPUBindGroup; pipelines: GPUComputePipeline[] }

/** What a plan sends the kernels: never per frame. */
type BlendPlanUpload = {
  /** Each pass's seeded entries, its counts and its plan regions. */
  passes: {
    seeds: Uint32Array
    counts: { entries: number; runs: number; instanceBase: number }
    region: { seeds: number; order: number; runs: number; args: number }
  }[]
  scene: { maxVertexWords: number; vertexShift: number }
  /** The order kernel's dispatch words (`orderSteps.ts`), and the items' key records. */
  stepWords: Uint32Array
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
  buffers: Record<'uniforms' | 'plan' | 'keep' | 'draws' | 'steps' | 'keyed' | 'frame', GPUBuffer>,
  order: Kernel,
  expansion: Kernel,
  items: number,
  made: GPUBuffer[],
) {
  const uni = new Uint32Array(UNI_WORDS)
  // The arrays encoding rereads in place: one dynamic offset, four expansion dispatches.
  const offsets = [0],
    launches = [0, 0, 0, 0]
  const write = (buffer: GPUBuffer, word: number, source: Uint32Array, words?: number) =>
    writeWords(device.queue, buffer, word, source, words)
  return {
    /** Static description of each item: paged rank, chunks, table base, vertices. */
    uploadDraws(packed: Uint32Array) {
      write(buffers.draws, 0, packed, items * 4)
    },
    /** Frustum verdict of the frame: one bit per item, a few hundred bytes. */
    uploadKeep(packed: Uint32Array) {
      write(buffers.keep, 0, packed)
    },
    /** What a new plan changes: each pass's seeds and expansion uniform, the order's dispatch
     *  words, the key records. */
    uploadPlan(plan: BlendPlanUpload) {
      plan.passes.forEach(({ seeds, counts, region }, pass) => {
        if (seeds.length) write(buffers.plan, region.seeds, seeds)
        blendExpandUniform(uni, counts, region, plan.scene)
        device.queue.writeBuffer(buffers.uniforms, pass * UNIFORM_STRIDE, uni)
      })
      write(buffers.steps, 0, plan.stepWords)
      if (plan.keyWords.length) write(buffers.keyed, 0, plan.keyWords)
    },
    /** The frame's eye, own keys and own seeds: the only words a frame sends the order. */
    uploadFrame(words: Uint32Array, count: number) {
      write(buffers.frame, 0, words, count)
    },
    /** One pass ordered (`steps`) then expanded, in the open compute pass. */
    encode(
      encoder: GPUComputePassEncoder,
      pass: number,
      steps: readonly OrderStep[],
      counts: { entries: number; runs: number },
    ) {
      encodeOrder(encoder, order, steps, offsets)
      offsets[0] = pass * UNIFORM_STRIDE
      encoder.setBindGroup(0, expansion.group, offsets)
      blendExpandDispatch(launches, counts.entries, counts.runs)
      for (let step = 0; step < expansion.pipelines.length; step++) {
        encoder.setPipeline(expansion.pipelines[step])
        encoder.dispatchWorkgroups(launches[step])
      }
    },
    dispose() {
      for (const buffer of made) buffer.destroy()
    },
  }
}

/** `words` of `source` — all of them by default — written from word `word` of `buffer`. */
const writeWords = (
  queue: GPUQueue,
  buffer: GPUBuffer,
  word: number,
  source: Uint32Array,
  words = source.length,
) => queue.writeBuffer(buffer, word * 4, source.buffer as ArrayBuffer, source.byteOffset, words * 4)

/** The order's dispatches of one pass, each step at its uniform's dynamic offset (`offsets`, the
 *  array the encoding rereads in place). */
function encodeOrder(
  encoder: GPUComputePassEncoder,
  order: Kernel,
  steps: readonly OrderStep[],
  offsets: number[],
) {
  let bound: GPUComputePipeline | undefined
  for (const step of steps) {
    const pipeline = order.pipelines[step.entry]
    if (pipeline !== bound) encoder.setPipeline((bound = pipeline))
    offsets[0] = step.uniform * ORDER_STEP_STRIDE
    encoder.setBindGroup(0, order.group, offsets)
    encoder.dispatchWorkgroups(step.groups)
  }
}

/** A kernel's stages on a pipeline layout of its one group's `layout`. */
const stagesOn = <E extends string>(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  module: GPUShaderModule,
  entries: readonly E[],
) =>
  buildComputeStages(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module,
    entries,
  )

/** A device's refusal of the kernels: the scene's, by name. */
const EXPANSION_REFUSED = 'WEBGPU_BLEND_EXPANSION_UNAVAILABLE'

/**
 * The two kernels of the transparent pass — the order, then the expansion of the sorted plan — and
 * the scene buffers they read.
 *
 * Nothing is allocated per frame. What a frame gives fits in two writes: the eye with the own
 * entries' keys and order, and the frustum verdict when it moved. What it gets is the instance list
 * the blend shader reads and one indirect argument per slot — never per item. Both kernels compile
 * together, off the thread, while the scene prepares: no frame compiles one. The transparents are
 * expanded on the GPU alone (#1483): a device that refuses the kernels refuses the scene by name
 * (`WEBGPU_BLEND_EXPANSION_UNAVAILABLE`), what was made for them released.
 */
export async function createBlendExpand(
  device: GPUDevice,
  sizes: ExpandSizes,
  shared: { counts: GPUBuffer | undefined; clusters: GPUBuffer | undefined },
  outputs: { expanded: GPUBuffer; args: GPUBuffer },
) {
  const made: GPUBuffer[] = []
  try {
    const buffers = expandBuffers(device, sizes, made)
    const built = await validated(device, () => expandKernels(device, buffers, shared, outputs))
    if (built) return expandApi(device, buffers, built.order, built.expansion, sizes.items, made)
  } catch (error) {
    cleanupFailedHiz(made)
    throw new Error(EXPANSION_REFUSED, { cause: error })
  }
  // The device refused the kernels: no error to carry.
  cleanupFailedHiz(made)
  throw new Error(EXPANSION_REFUSED)
}

type ExpandSizes = { items: number; entries: number; planWords: number; scratchWords: number }

/** The kernels' scene buffers, each kept in `made`: what the frame writes, then their own work
 *  memory — the expansion's scratch, the order's network and places. */
function expandBuffers(device: GPUDevice, sizes: ExpandSizes, made: GPUBuffer[]) {
  const make = (label: string, size: number, usage: number) => {
    const buffer = device.createBuffer({ label, size: Math.max(16, size), usage })
    made.push(buffer)
    return buffer
  }
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    work = GPUBufferUsage.STORAGE
  const steps = EXPAND_PASSES * orderStepCount(sizes.entries) * ORDER_STEP_STRIDE
  return {
    uniforms: make('Trillion3D blend expand uniforms', UNIFORM_STRIDE * EXPAND_PASSES, uniform),
    plan: make('Trillion3D blend sorted plan', sizes.planWords * 4, storage),
    keep: make('Trillion3D blend frustum verdicts', ((sizes.items + 31) >> 5) * 4, storage),
    draws: make('Trillion3D blend draw descriptions', sizes.items * 16, storage),
    steps: make('Trillion3D blend order steps', steps, uniform),
    keyed: make('Trillion3D blend key records', sizes.items * KEY_RECORD_WORDS * 4, storage),
    frame: make(
      'Trillion3D blend order frame',
      orderFrameWords(sizes.items, sizes.entries) * 4,
      storage,
    ),
    scratch: make('Trillion3D blend expand scratch', sizes.scratchWords * 4, work),
    sorted: make('Trillion3D blend order network', sortSize(sizes.entries) * 16, work),
    placed: make('Trillion3D blend order places', sizes.entries * 4, work),
  }
}

/** The two kernels on their buffers, compiled together off the thread; `undefined` when a module
 *  does not compile. */
async function expandKernels(
  device: GPUDevice,
  buffers: ReturnType<typeof expandBuffers>,
  shared: { counts: GPUBuffer | undefined; clusters: GPUBuffer | undefined },
  outputs: { expanded: GPUBuffer; args: GPUBuffer },
) {
  const expandModule = device.createShaderModule({ code: BLEND_EXPAND_SHADER })
  const orderModule = device.createShaderModule({ code: BLEND_ORDER_SHADER })
  if ((await shaderFailed(expandModule)) || (await shaderFailed(orderModule))) return undefined
  const expandLayout = device.createBindGroupLayout({ entries: blendExpandBindEntries() })
  const orderLayout = device.createBindGroupLayout({ entries: blendOrderBindEntries() })
  const [expandStages, orderStages] = await Promise.all([
    stagesOn(device, expandLayout, expandModule, BLEND_EXPAND_ENTRIES),
    stagesOn(device, orderLayout, orderModule, BLEND_ORDER_ENTRIES),
  ])
  // Without a paged primitive there is neither a count nor a cluster list to read: the kernel
  // never touches those two bindings, and `draws` fills them — the same group cannot stay empty.
  const expansion: Kernel = {
    group: device.createBindGroup({
      layout: expandLayout,
      entries: namedBufferEntries(EXPAND_BINDING, {
        uni: { buffer: buffers.uniforms, size: UNI_WORDS * 4 },
        plan: { buffer: buffers.plan },
        keep: { buffer: buffers.keep },
        draws: { buffer: buffers.draws },
        counts: { buffer: shared.counts ?? buffers.draws },
        clusters: { buffer: shared.clusters ?? buffers.draws },
        scratch: { buffer: buffers.scratch },
        expanded: { buffer: outputs.expanded },
        args: { buffer: outputs.args },
      }),
    }),
    pipelines: BLEND_EXPAND_ENTRIES.map((entry) => expandStages[entry]),
  }
  const order: Kernel = {
    group: device.createBindGroup({
      layout: orderLayout,
      entries: namedBufferEntries(ORDER_BINDING, {
        uni: { buffer: buffers.steps, size: ORDER_UNI_WORDS * 4 },
        plan: { buffer: buffers.plan },
        keyed: { buffer: buffers.keyed },
        frame: { buffer: buffers.frame },
        sorted: { buffer: buffers.sorted },
        placed: { buffer: buffers.placed },
      }),
    }),
    pipelines: BLEND_ORDER_ENTRIES.map((entry) => orderStages[entry]),
  }
  return { order, expansion }
}
