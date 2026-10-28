import type { AirShadowMaps } from '../../lighting/atmosphere/bindings.ts'
import { FLAGS_VIEW } from '../../materials/surface/surfaceOutputs.ts'
import { createAtmosphereGpu } from '../../lighting/atmosphere/gpu.ts'
import type { AirInputs } from '../../lighting/atmosphere/encode.ts'
import { FRAME_FLOATS, writeAirFrame } from '../../lighting/atmosphere/frame.ts'
import { FRAME_LAYOUT } from '../../lighting/atmosphere/frameLayout.ts'
import { airShapeKey } from '../../lighting/atmosphere/shape.ts'
import {
  vsmConsumerResources,
  vsmOrStandIns,
} from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { airStateOf } from './airState.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
import { litImageShown } from '../prepare/contractLight.ts'
import { holdoutOn } from '../prepare/alphaHoldout.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { noiseFrame } from './noiseFrame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What the image tells the air's passes, its frame included, rewritten each image: nothing is
 *  allocated. */
const inputs: AirInputs = {
  buffer: undefined as unknown as GPUBuffer,
  version: 0,
  frame: new Float32Array(FRAME_FLOATS),
  maps: undefined as unknown as AirShadowMaps,
  separate: false,
  capture360: false,
}

/** The atmosphere this image shows: the scene's, in a lit view of the lit image, the quality settings
 *  not turning it off (`atmosphereOn`) — the unlit view and the views that paint raw values show
 *  none. The lights' store is told whether the air shades them. */
function atmosphereShown(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  const air = store.environment?.atmosphere
  if (!air) return undefined
  const on = airStateOf(rt).quality.atmosphereOn
  store.setAirOn(on)
  return on && litImageShown(rt) ? air : undefined
}

/** Starts the atmosphere's GPU work once a scene shows one: its pipelines compile off the frame
 *  and the frames wait for them (`createAtmosphereGpu`). Made again when the quality settings made
 *  another shape of it. A scene with none makes nothing. */
export function askAtmosphere(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!atmosphereShown(rt)) return
  const { shape, key } = airStateOf(rt)
  if (rt.gpu.atmosphere && airShapeKey(rt.gpu.atmosphere.shape) === key) {
    // The variants the clouds ask are asked as the frame enters, the frame waits for them.
    rt.gpu.atmosphere.variantsReady(airStateOf(rt).requests)
    return
  }
  rt.gpu.atmosphere?.dispose()
  rt.gpu.atmosphere = createAtmosphereGpu(device, shape, (error) =>
    rt.diag.diagnosticFailure('atmosphere-program-failed', error),
  )
}

/** The virtual shadow maps and the blue noise the sky and the haze are drawn with: the engine's where it
 *  projects some, their stand-ins else (`vsmOrStandIns`). */
function mapsOf(rt: WebgpuPagesRuntime) {
  const { placeholders } = rt.gpu.deferred!
  return vsmOrStandIns(vsmConsumerResources(rt), placeholders)
}

/** Whether every map of this image kept the id it had in the image before (`VsmMapIds`: each claimed map left its next-map data under its previous
 *  id, naming the id it has now), so that the previous frame set's tables, indexed by id, describe the same lights. A new map, or one that moved,
 *  makes the previous pages those of another light. */
function mapIdsKept({ state: { ids } }: NonNullable<WebgpuPagesRuntime['lights']['vsm']>) {
  if (ids.nextMapIdCount !== ids.claimedCount) return false
  for (let j = 0; j < ids.nextMapIdCount; j++) {
    const prevId = ids.nextMapIds[j]
    if (ids.nextMaps[prevId].nextMapId !== prevId) return false
  }
  return true
}

/**
 * The virtual shadow maps the air's tables are made with, before this image's shadow pages are rendered
 * (`encodeVsmFrame`): the pages of the image before, as the reference makes its sky look-up tables
 * before it renders any shadow depth. Their page table, projection records and uniforms are the previous
 * frame set's (`VsmResources.prev`, swapped in at the end of that image), of which the pool still holds
 * the pages; the stand-ins where the image before projected none, this one projects none, or a map changed id since (`mapIdsKept`). Chosen once
 * an image.
 */
export function previousMapsOf(rt: WebgpuPagesRuntime) {
  const state = airStateOf(rt)
  if (state.mapsFrame === rt.run.frame && state.maps) return state.maps
  const now = vsmConsumerResources(rt)
  const vsm = rt.lights.vsm
  const held = !!now && !!vsm && state.shadowed === true && mapIdsKept(vsm)
  state.shadowed = !!now
  state.mapsFrame = rt.run.frame
  // Copied: `vsmOrStandIns` rewrites one object at each call, which the sky and the haze ask again later in the image.
  return Object.assign(
    (state.maps ??= {} as NonNullable<typeof state.maps>),
    vsmOrStandIns(
      held && now && vsm
        ? {
            ...now,
            pageTable: vsm.res.prev.pageTable,
            projectionData: vsm.res.prev.projectionData,
            uniforms: vsm.res.prev.uniforms,
          }
        : undefined,
      rt.gpu.deferred!.placeholders,
    ),
  )
}

/**
 * The air's tables and volume for this image, before the lighting resolve reads them (and before the surface
 * cache's update, as the reference makes its sky look-up tables): the tables of the air when it changed, the sky around
 * the eye and the haze volume, and the sky's sums when the sun moved. False when the image shows no atmosphere, or its programs are not compiled yet —
 * then the image draws without one, and `encodeSky` draws nothing.
 */
export function encodeAtmosphere(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  viewProj: ArrayLike<number>,
  inverseViewProj: ArrayLike<number>,
) {
  const air = atmosphereShown(rt),
    { lights, gpu } = rt
  if (!air || !lights.buffer) return false
  askAtmosphere(rt, device)
  const { requests } = airStateOf(rt)
  if (!gpu.atmosphere?.ready || !gpu.atmosphere.variantsReady(requests)) return false
  const [width, height] = gpu.targetSize
  const capture = requests.capturePosition && { position: requests.capturePosition }
  writeAirFrame(inputs.frame, cam, air, viewProj, inverseViewProj, width, height, {
    capture,
    frameIndex: noiseFrame(rt),
    preExposure: preExposureOf(rt).now,
  })
  inputs.frame[FRAME_LAYOUT.at.hidden] = air.inMainView ? 0 : 1
  inputs.frame[FRAME_LAYOUT.at.hidden + 1] = atmosphereHoldout(rt) ? 1 : 0
  const maps = previousMapsOf(rt)
  inputs.buffer = lights.buffer
  inputs.version = lights.store.atmosphereVersion
  inputs.maps = maps
  inputs.cloudShadow = cloudShadowOf(rt)
  inputs.separate = requests.separate
  inputs.capture360 = requests.capture360
  gpu.atmosphere.encode(encoder, inputs)
  return true
}

/** Whether the atmosphere holds its light out of the image's alpha this image (`SceneAtmosphere.holdout`, with the
 *  alpha holdout in effect). */
export const atmosphereHoldout = (rt: WebgpuPagesRuntime) =>
  !!atmosphereShown(rt)?.holdout && holdoutOn(rt)

/** The sky over the lit image where no surface was drawn: after the lighting, before the fog and the
 *  transparents. Where the atmosphere is not drawn in the view (`inMainView`) the sky is black, the fog
 *  pass's colour alone over it. */
export function encodeSky(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu } = rt,
    flags = gpu.surfaces?.views()[FLAGS_VIEW]
  if (!gpu.atmosphere || !gpu.hdrView || !flags || !gpu.deferred) return
  const [width, height] = gpu.targetSize
  // Held out, or drawn in no view (`inMainView` off): the sky is black and lays its coverage on the alpha, which
  // leaves the background's where the view draws none.
  const air = atmosphereShown(rt)
  const held = !!air && (atmosphereHoldout(rt) || !air.inMainView)
  gpu.atmosphere.drawSky(encoder, gpu.hdrView, flags, width, height, mapsOf(rt).noise, held)
}

/** The haze marched on the opaque surfaces, over the lit image after the sky (`aerialFastOnOpaque`
 *  off; nothing otherwise, nor where the atmosphere is not drawn in the view): each pixel a surface
 *  drew is hazed up to its depth. */
export function encodeOpaqueHaze(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu } = rt,
    flags = gpu.surfaces?.views()[FLAGS_VIEW]
  if (
    !rt.lights.store.environment?.atmosphere?.inMainView ||
    !gpu.atmosphere?.drawOpaqueHaze ||
    !gpu.hdrView ||
    !flags ||
    !gpu.depthView ||
    !gpu.deferred
  )
    return
  const [width, height] = gpu.targetSize
  gpu.atmosphere.drawOpaqueHaze(
    encoder,
    gpu.hdrView,
    flags,
    gpu.depthView,
    width,
    height,
    mapsOf(rt).noise,
  )
}
