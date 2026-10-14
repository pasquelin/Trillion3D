// The GPU water rectangle run in JavaScript (`shaderRun`) on the collected water scene, beside the
// CPU walk it replaces (`waterRect.fixture.ts`): what `rectWgsl.test.ts` compares.
import assert from 'node:assert/strict'
import { createEngineCamera, type EngineCamera } from '../../camera/engineCamera.ts'
import { readCameraWorld } from '../../camera/world.ts'
import { collectClusterPages } from '../../page/selection/collect.ts'
import { prepareWebgpuBlend } from '../blend/prepare.ts'
import { createWebgpuBlendState, type WebgpuBlendState } from '../blend/state.ts'
import { refreshBlendPlan } from '../blend/plan.ts'
import { buildBlendStatics } from '../blend/statics.ts'
import { uniformStride } from '../../residency/pools.ts'
import { orderBlendPasses } from '../blend/order.ts'
import { writeKeyRecords } from '../blend/keyRecords.ts'
import { blendVerdictCpu } from '../blend/verdict.fixture.ts'
import { VERDICT, verdictWords } from '../blend/verdictLayout.ts'
import { BLEND_ITEM_WORDS, BLEND_ITEM_WORLD } from '../blend/items.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { WATER_RECT_SHADER } from './rectWgsl.ts'
import { writeWaterItems } from './waterItems.ts'
import { writeWaterFrame } from './frameWords.ts'
import { waterRectCpu } from './waterRect.fixture.ts'
import { VOLUME_ITEM, VOLUME_WORDS, waterRankOf } from '../transparent/transmission.ts'
import { device, prepared } from './pass.fixture.ts'
import {
  waterCostScene,
  waterCostCamera,
  poseWaterCost,
  SIZE,
} from '../../../../../tests/gpu/water/waterCostScene.ts'
import { graphDraws } from '../../page/selection/drawSource.ts'

type Vec = number[]
type Kernel = { boundWaterItems(id: Vec, n: Vec): void; writeWaterArgs(): void }
/** The kernel's own functions; the library's are reached on their own. */
const NAMES = [
  'boundWaterItems',
  'writeWaterArgs',
  'includeWaterItem',
  'waterCrops',
  'waterFull',
  'waterFold',
  'frameMatrix',
  'unionWord',
  'writeWords',
  'waterProject',
  'waterCorners',
  'waterCorner',
  'waterViewRow',
  'waterEnclose',
  'waterBoxTransform',
  'waterRow',
  'waterWiden',
  'waterStretch',
  'frameDouble',
  'keyedDouble',
  'flatIndex',
]

/** The pass's words as the kernels leave them for `state`, its items drawing as `waterDraws`. */
function gpuRect(state: WebgpuBlendState, waterDraws: Uint32Array) {
  const items = state.blendGpu
  const records = new Float32Array(items.length * BLEND_ITEM_WORDS)
  items.forEach((item, i) =>
    records.set(item.matrix.elements, i * BLEND_ITEM_WORDS + BLEND_ITEM_WORLD),
  )
  const verdict = new Array<number>(verdictWords(state.transmissive)).fill(0)
  waterDraws.forEach((draws, rank) => (verdict[VERDICT.waterDraws + rank] = draws))
  const scope = {
    frame: Array.from(state.frameWords),
    keyed: Array.from(writeKeyRecords(state)),
    waterItems: Array.from(writeWaterItems(state)),
    items: Array.from(new Uint32Array(records.buffer)),
    volumes: Array.from(new Uint32Array(state.volumePacked.buffer)),
    verdict,
    encloseError: [] as Vec[],
    projectNdc: [] as Vec[],
  }
  const kernel = shaderRun<Kernel>(WATER_RECT_SHADER, NAMES, scope)
  for (let rank = 0; rank < state.transmissive; rank++)
    kernel.boundWaterItems([rank, 0, 0], [1, 1, 1])
  kernel.writeWaterArgs()
  const at = (word: number, count: number) => verdict.slice(word, word + count).map((w) => w >>> 0)
  return {
    drawn: verdict[VERDICT.quadArgs + 1] === 1,
    rect: at(VERDICT.rect, 4),
    copy: at(VERDICT.copy, 4),
  }
}

/** Volumes of no declared thickness for `state`'s transmissive items, each naming its item's rank
 *  in the item records as `writeVolumeRecords` names it. */
export function blankVolumes(state: WebgpuBlendState) {
  state.volumePacked = new Float32Array(VOLUME_WORDS * Math.max(1, state.transmissive))
  const words = new Uint32Array(state.volumePacked.buffer)
  state.blendGpu.forEach((item, index) => {
    const rank = waterRankOf(item.flags)
    if (rank) words[(rank - 1) * VOLUME_WORDS + VOLUME_ITEM] = index
  })
}

/** The collected water-cost scene, prepared as the frame prepares it, and its camera. */
export function scene(enabled = true) {
  const source = waterCostScene(1 / 16, enabled)
  // A compiled geometry-page declaration still takes the source path for transmission.
  for (const page of source.metadata.primitives.at(-1)!.pages)
    page.geometry = { url: 'quantized-water', maxPositionError: 0.01 } as never
  const collected = collectClusterPages(
    source.source,
    graphDraws(source.source, source.associations),
    source.metadata,
    source.indices,
  )
  const state = createWebgpuBlendState(),
    { gpu } = prepared()
  state.transmissive = prepareWebgpuBlend(
    device,
    collected.blendCopies,
    gpu,
    state,
    source.source as never,
  )
  buildBlendStatics(state, uniformStride())
  refreshBlendPlan(state)
  blankVolumes(state)
  const host = waterCostCamera()
  poseWaterCost(host, 0, false)
  const camera = readCameraWorld(createEngineCamera(), host)
  state.blendPlanes.set(camera.planes)
  return { state, item: state.blendGpu[0], camera }
}

/** One image of `state` under `projection`, its rectangle on the GPU and on the CPU. */
export function frame(
  state: WebgpuBlendState,
  camera: EngineCamera,
  projection: ArrayLike<number> = camera.viewProjection,
) {
  orderBlendPasses(state, camera.eye)
  writeWaterFrame(state, camera, projection, SIZE)
  const { waterDraws } = blendVerdictCpu(state)
  const gpu = gpuRect(state, waterDraws),
    cpu = waterRectCpu(state, camera, projection, SIZE, waterDraws)
  assert.deepEqual(gpu, cpu, 'the GPU rectangle is the CPU walk’s, word for word')
  return gpu
}
