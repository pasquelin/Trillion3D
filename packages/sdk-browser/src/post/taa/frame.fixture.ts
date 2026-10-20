import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { beginTaaFrame, encodeTaaPass, taaRenderMatrix } from './frame.ts'
import { createTaaFrameState } from './frameState.ts'
import { createScaleControl, type ScaleControl } from '../../frame/scale/scaleControl.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { TaaInputs } from './inputs.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

/** The scale controller a fixture runtime's view holds: the engine reads it as its `ViewScale`,
 *  a test drives the whole controller. */
export const scaleControl = (rt: WebgpuPagesRuntime) => rt.views.active.scale as ScaleControl

/** The strict minimum of an engine: the fake pass, its inputs, the camera and the revisions. */
export function runtime() {
  const encoded: unknown[] = []
  const output = { color: {}, share: {} }
  const flags = { flags: true } as unknown as GPUTextureView
  const temporal = {
    uniform: {} as GPUBuffer,
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
    inputs: {} as TaaInputs,
    analysisSize: [64, 32],
    encode(_encoder: unknown, inputs: unknown) {
      encoded.push(inputs)
      return output
    },
  }
  const size = () => [64, 32]
  // The image's motion is its view's and scene's revisions; a landing, the resources' one.
  const revisions = { scene: 1, view: 0, resources: 0 }
  const gate = { revisions, resourcesChanged: () => void revisions.resources++ }
  const rt = {
    gpu: {
      temporal,
      temporalLevel: 'max',
      depthView: {},
      hdrView: {},
      cache: { buffer: {} },
    },
    vis: { visView: { ids: true }, pageTable: { pages: true }, concatPos: {}, concatUv: {} },
    run: { diagnostic: 'beauty', gpuDrawCalls: 0, frame: 0, gate },
    capture: { capturing: false },
    lights: { vsm: { settle: { renderedTotal: 0 } } },
  } as unknown as WebgpuPagesRuntime
  rt.gpu.surfaces = { views: () => [{}, {}, {}, flags] } as never
  Object.assign(rt.gpu, { targetSize: size(), allocatedSize: size(), displaySize: size() })
  const scale = createScaleControl(undefined)
  // The main view drawn, its scale the world's controller.
  Object.assign(rt, { views: { active: { scale }, main: { scale } } })
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
    encodeTaaPass(rt, device, device.createCommandEncoder(), cam, rt.gpu.hdrView!, asIs)
    return writes.length > before ? (writes[writes.length - 1].data as Float32Array) : null
  }
  return { rt, cam, temporal, encoded, frame, flags }
}
