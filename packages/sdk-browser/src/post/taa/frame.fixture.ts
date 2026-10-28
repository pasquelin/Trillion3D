import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { beginTaaFrame, encodeTaaPass, taaRenderMatrix } from './frame.ts'
import { createTaaFrameState } from './frameState.ts'
import { beginCamera } from '../../frame/backend/state/previousCamera.ts'
import { encodeVelocity } from './velocityFrame.ts'
import { NO_WPO } from '../../materials/graph/wpoProgram.ts'
import { NO_RASTERS } from '../../materials/graph/graphRasters.ts'
import { createGraphFrame } from '../../frame/render/graphFrame.ts'
import { createScaleControl, type ScaleControl } from '../../frame/scale/scaleControl.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { TaaInputs } from './inputs.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createFrameRing, frameSequenceOf, planFrame, type FrameSlices } from './historyFrames.ts'
import { createShapeMemo, historyFormatsOf, type HistoryShape } from './historyShape.ts'
import { TAA_LEVEL_KNOBS } from './levels.ts'

/** The history a fixture's pass is made as: the display's size, the finest level's frames. */
const FIXTURE_SHAPE: HistoryShape = {
  width: 64,
  height: 32,
  displayWidth: 64,
  displayHeight: 32,
  sequence: frameSequenceOf(true, 2, 31),
  formats: historyFormatsOf(new Set<string>(), true),
  field: true,
  antiAlias: true,
}

/** The scale controller a fixture runtime's view holds: the engine reads it as its `ViewScale`,
 *  a test drives the whole controller. */
export const scaleControl = (rt: WebgpuPagesRuntime) => rt.views.active.scale as ScaleControl

/** The view's velocity stage, whose last image the pass reads: its target is not made. */
const fakeVelocity = () => ({
  uniform: {} as GPUBuffer,
  wpo: NO_WPO,
  active: false,
  measured: false,
  still: false,
  scan: false,
  moved: false,
  size: [64, 32],
  vectors: {} as GPUTextureView,
  frame: createTaaFrameState(),
  ensure() {},
  /** The `tessellated` flag of each image the stage measured (`encodeVelocity`). */
  drawn: [] as boolean[],
  encode(_encoder: unknown, _inputs: unknown, _render: unknown, tessellated: boolean) {
    this.drawn.push(tessellated)
  },
  release() {},
})

/** The cut's poses the velocity reads (`GpuSelection`): its records, the kept poses and whether a
 *  pose moved since, which a test drives. */
const fakeSelection = () => ({
  worlds: {} as GPUTextureView,
  previous: {} as GPUTextureView,
  posesMoving: false,
})

/** The engine around a pass: its passes, the targets' views and sizes, the revisions that say the
 *  image moved (a view's and scene's; a landing, the resources'), and the main view's scale. */
function fakeEngine(
  temporal: object,
  velocity: object,
  revisions: { scene: number; view: number; resources: number },
) {
  const gate = { revisions, resourcesChanged: () => void revisions.resources++ }
  const rt = {
    gpu: {
      temporal,
      velocity,
      temporalLevel: 'max',
      depthView: {},
      hdrView: {},
      cache: { buffer: {} },
    },
    vis: {
      rasters: NO_RASTERS,
      graphFrame: createGraphFrame(),
      visView: { ids: true },
      pageTable: { pages: true },
      concatPos: {},
      concatUv: {},
      concatNrm: {},
      materialTable: { displaced: { count: 0 }, view: {} as GPUTextureView },
      textures: { color: { views: [{}, {}, {}], pages: { buffer: {} } } },
      mapsSampler: {},
    },
    run: { diagnostic: 'beauty', gpuDrawCalls: 0, frame: 0, gate, gpuSelection: fakeSelection() },
    capture: { capturing: false },
    bounce: { wanted: false },
    // No diagnostic GPU variant: the view's own targets, whichever diagnostic view is drawn.
    context: { diagnosticGpuVariant: undefined },
    lights: { vsm: { settle: { renderedTotal: 0 } } },
  } as unknown as WebgpuPagesRuntime
  rt.gpu.surfaces = { views: () => [{}, {}, {}, {}] } as never
  const size = () => [64, 32]
  Object.assign(rt.gpu, { targetSize: size(), allocatedSize: size(), displaySize: size() })
  const scale = createScaleControl(undefined)
  // The main view drawn, its scale the world's controller.
  const main = { scale }
  Object.assign(rt, { views: { active: main, main, persistent: [] } })
  return rt
}

/** The strict minimum of an engine: the fake pass, its inputs, the camera and the revisions. */
export function runtime() {
  const encoded: unknown[] = []
  const output = { color: {} }
  const velocity = fakeVelocity()
  const temporal = {
    uniform: {} as GPUBuffer,
    frame: velocity.frame,
    inputs: {} as TaaInputs,
    analysisSize: [64, 32],
    shape: FIXTURE_SHAPE,
    wanted: () => FIXTURE_SHAPE,
    historyBytes: 0,
    layers: { bytes: 0, uncounted: () => 0, drop() {} },
    resize: () => false,
    /** Every pipeline of the chain compiled. */
    ready: () => true,
    /** The frames each image encoded in (`planFrame`). */
    slices: [] as FrameSlices[],
    encode(_encoder: unknown, inputs: unknown, _render: unknown, slices: FrameSlices) {
      encoded.push(inputs)
      this.slices.push(slices)
      return output
    },
  }
  const revisions = { scene: 1, view: 0, resources: 0 }
  const rt = fakeEngine(temporal, velocity, revisions)
  const { device, writes, computePipelines } = fakeDevice()
  rt.gpu.device = device
  const cam = {
    viewProjection: IDENTITY_MATRIX4,
    projection: IDENTITY_MATRIX4,
    eye: [0, 0, 0],
  } as unknown as EngineCamera
  /** A whole frame: input, render matrix, pass; returns the written uniform, or `null`. A moving
   *  one moves the view; the first image of a view moves whatever it is told, nothing before it. */
  const frame = (quiet: boolean) => {
    if (!quiet) revisions.view++
    // The image's number advances and its camera is begun, as the frame begins them (`encodeSurfaceLighting`).
    rt.run.frame++
    beginTaaFrame(rt, cam)
    beginCamera(rt, cam)
    taaRenderMatrix(rt, cam)
    const before = writes.length
    const encoder = device.createCommandEncoder()
    encodeVelocity(rt, device, encoder, cam)
    encodeTaaPass(rt, device, encoder, cam, rt.gpu.hdrView!)
    return writes.length > before ? (writes[writes.length - 1].data as Float32Array) : null
  }
  return { rt, cam, device, computePipelines, temporal, velocity, encoded, frame }
}

const bareDeviceShape = createShapeMemo(fakeDevice().device)

/** The history of a `width × height` display at a level of the temporal pass, on a device that
 *  draws no 11-11-10 format and holds WebGPU's default limits: the shape `resize` takes. */
export const taaShape = (
  width: number,
  height: number,
  level: keyof typeof TAA_LEVEL_KNOBS = 'max',
) =>
  bareDeviceShape(TAA_LEVEL_KNOBS[level], { frames: 2, interval: 31, packed: true }, width, height)

/** The frames the first image of a history of `shape` reads and writes. */
export const taaSlices = (shape = taaShape(8, 4)) =>
  planFrame(createFrameRing(shape.sequence), false)

/** The colour atlas and the sampler a velocity pass binds beside its other inputs
 *  (`velocityInputResources`): one view a lane, a page table. Their fields are of the type of
 *  every input they stand in for (`never`), an object a frame's inputs can spread. */
const ATLAS_INPUTS = {
  textures: { color: { views: [{}, {}, {}], pages: { buffer: {} } } },
  sampler: {},
} as { textures: never; sampler: never }

/** The inputs of a frame of the temporal pass, every resource a stand-in of its own (the atlas's
 *  `ATLAS_INPUTS`), and no as-is flags; `over` names the ones a test gives. */
export function taaInputs(over: Partial<TaaInputs> = {}): TaaInputs {
  const view = () => ({}) as GPUTextureView
  const buffer = {} as GPUBuffer
  return {
    current: view(),
    depth: view(),
    ids: view(),
    pages: buffer,
    worlds: view(),
    previous: view(),
    vectors: view(),
    pool: buffer,
    positions: buffer,
    uvs: buffer,
    normals: view(),
    material: view(),
    frame: buffer,
    ...ATLAS_INPUTS,
    ...over,
  }
}
