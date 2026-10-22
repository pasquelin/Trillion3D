import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { beginTaaFrame, encodeTaaPass, taaRenderMatrix } from './frame.ts'
import { createTaaFrameState } from './frameState.ts'
import { encodeVelocity } from './velocityFrame.ts'
import { createScaleControl, type ScaleControl } from '../../frame/scale/scaleControl.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { TaaInputs } from './inputs.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

/** The scale controller a fixture runtime's view holds: the engine reads it as its `ViewScale`,
 *  a test drives the whole controller. */
export const scaleControl = (rt: WebgpuPagesRuntime) => rt.views.active.scale as ScaleControl

/** The view's velocity stage, whose motion and last image the pass reads: its target is not made. */
const fakeVelocity = () => ({
  uniform: {} as GPUBuffer,
  active: false,
  measured: false,
  still: false,
  scan: false,
  moved: false,
  size: [64, 32],
  vectors: {} as GPUTextureView,
  motion: {
    buffer: {} as GPUBuffer,
    moved: false,
    updates: [] as boolean[],
    resets: 0,
    update(_eye: ArrayLike<number>, scan: boolean) {
      this.updates.push(scan)
    },
    reset() {
      this.resets++
    },
  },
  frame: createTaaFrameState(),
  boxes: () => ({}) as GPUBuffer,
  ensure() {},
  encode() {},
  release() {},
})

/** The engine around a pass: its passes, the targets' views and sizes, the revisions that say the
 *  image moved (a view's and scene's; a landing, the resources'), and the main view's scale. */
function fakeEngine(
  temporal: object,
  velocity: object,
  revisions: { scene: number; view: number; resources: number },
  flags: GPUTextureView,
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
    vis: { visView: { ids: true }, pageTable: { pages: true }, concatPos: {}, concatUv: {} },
    run: { diagnostic: 'beauty', gpuDrawCalls: 0, frame: 0, gate },
    capture: { capturing: false },
    bounce: { wanted: false },
    // No diagnostic GPU variant: the view's own targets, whichever diagnostic view is drawn.
    context: { diagnosticGpuVariant: undefined },
    lights: { vsm: { settle: { renderedTotal: 0 } } },
  } as unknown as WebgpuPagesRuntime
  rt.gpu.surfaces = { views: () => [{}, {}, {}, flags] } as never
  const size = () => [64, 32]
  Object.assign(rt.gpu, { targetSize: size(), allocatedSize: size(), displaySize: size() })
  const scale = createScaleControl(undefined)
  // The main view drawn, its scale the world's controller.
  Object.assign(rt, { views: { active: { scale }, main: { scale } } })
  return rt
}

/** The strict minimum of an engine: the fake pass, its inputs, the camera and the revisions. */
export function runtime() {
  const encoded: unknown[] = []
  const output = { color: {}, share: {} }
  const flags = { flags: true } as unknown as GPUTextureView
  const velocity = fakeVelocity()
  const temporal = {
    uniform: {} as GPUBuffer,
    frame: velocity.frame,
    inputs: {} as TaaInputs,
    analysisSize: [64, 32],
    encode(_encoder: unknown, inputs: unknown) {
      encoded.push(inputs)
      return output
    },
  }
  const revisions = { scene: 1, view: 0, resources: 0 }
  const rt = fakeEngine(temporal, velocity, revisions, flags)
  const { device, writes } = fakeDevice()
  const cam = {
    viewProjection: IDENTITY_MATRIX4,
    projection: IDENTITY_MATRIX4,
    eye: [0, 0, 0],
  } as unknown as EngineCamera
  /** A whole frame: input, render matrix, pass; returns the written uniform, or `null`. A moving
   *  one moves the view; the first image of a view moves whatever it is told, nothing before it. */
  const frame = (quiet: boolean, asIs = true) => {
    if (!quiet) revisions.view++
    beginTaaFrame(rt, cam)
    taaRenderMatrix(rt, cam)
    const before = writes.length
    const encoder = device.createCommandEncoder()
    encodeVelocity(rt, device, encoder, cam)
    encodeTaaPass(rt, device, encoder, cam, rt.gpu.hdrView!, asIs)
    return writes.length > before ? (writes[writes.length - 1].data as Float32Array) : null
  }
  return { rt, cam, temporal, velocity, encoded, frame, flags }
}
