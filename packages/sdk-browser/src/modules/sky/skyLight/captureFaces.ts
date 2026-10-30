import { workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import { lowerHemisphereOf } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { FRAME_FLOATS, writeAirFrame } from '../../../lighting/atmosphere/frame.ts'
import {
  CLOUD_TRACE_LAYOUT,
  markCloudTraceCapture,
  writeCloudTrace,
} from '../clouds/traceLayout.ts'
import type { CloudFramePlan } from '../clouds/reconstruct.ts'
import { CAPTURE_CLOUD_SETUP } from '../clouds/cloudModes.ts'
import { cloudSizes } from '../clouds/reconstructLayout.ts'
import { CLOUD_TRACE_GROUP_SIZE } from '../clouds/traceWgsl.ts'
import { capturedClouds, type CapturedClouds } from './captureClouds.ts'
import { groupsFor, type FaceHolds } from './captureGroups.ts'
import { writeBlock, type SkyLightInputs } from './captureInputs.ts'
import { FACE_LAYOUT } from './faceWgsl.ts'
import { faceCamera } from './faces.ts'
import { BLOCK_STRIDE } from './layout.ts'
import type { SkyLightPipelines } from './pipelines.ts'
import type { SkyLightTargets } from './targets.ts'
import { SKY_MESH_NEAR } from './skyMeshWgsl.ts'

const PASS: GPUComputePassDescriptor = { label: 'Trillion3D sky light clouds' }
const SKY_TABLE_PASS: GPUComputePassDescriptor = { label: 'Trillion3D sky light sky table' }

/**
 * THE CAPTURE'S FACES: the sky and the distant fog drawn into the faces of the cube by render
 * passes, and the clouds traced into the cloud texture, one dispatch a face, by the clouds part's
 * own tracing (`clouds/trace.ts`) and laid over the face with the lower hemisphere's colour. A
 * face's passes follow each other in the command stream, so the one texture of clouds is shared by
 * the faces.
 */

/** The words the blocks are written from; each is uploaded as soon as it is filled. */
const faceWords = new ArrayBuffer(FACE_LAYOUT.words * 4)
const faceFloats = new Float32Array(faceWords)
const faceUints = new Uint32Array(faceWords)
const frameFloats = new Float32Array(FRAME_FLOATS)
const traceFloats = new Float32Array(CLOUD_TRACE_LAYOUT.words)
const traceWords = new Uint32Array(traceFloats.buffer)

type Clouds = NonNullable<SkyLightInputs['clouds']>

/** Face `face`'s block: its number, whether the lower hemisphere is replaced and whether the
 *  clouds are laid, the position, the sides and the pre-exposure, and the lower colour with its
 *  coverage. */
function writeFace(
  device: GPUDevice,
  t: SkyLightTargets,
  face: number,
  input: SkyLightInputs,
  withClouds: boolean,
) {
  const { at } = FACE_LAYOUT
  const { light } = input.part
  faceUints.set([face, light.lowerHemisphereIsSolidColor ? 1 : 0, withClouds ? 1 : 0, 0], at.face)
  faceFloats.set([...input.position, SKY_MESH_NEAR], at.eye)
  faceFloats.set([t.width, 1 / t.width, t.cloudSide, input.preExposure], at.size)
  faceFloats.set(lowerHemisphereOf(light), at.lower)
  writeBlock(device, t.blocks.face, face * BLOCK_STRIDE, faceFloats)
}

/** Face `face`'s trace block, written: the camera of the face over the cloud texture, as a
 *  reflection with no late fog and no scene depth, its light written multiplied by the capture's
 *  pre-exposure. */
function writeFaceTrace(
  device: GPUDevice,
  t: SkyLightTargets,
  face: number,
  input: SkyLightInputs,
  clouds: Clouds,
  inverseViewProj: ArrayLike<number>,
) {
  const side = t.cloudSide
  // The view that traces a quarter of its size per axis is four times the side: the image is the
  // face's own pixels, not a cycle over a view's: no jitter, the reflection's sample counts.
  const view = { width: 4 * side, height: 4 * side }
  const plan: CloudFramePlan = {
    sizes: cloudSizes(view, view),
    rank: 0,
    offset: [0, 0],
    destination: 0,
    history: null,
    tracedStale: false,
    destinationStale: false,
    setup: CAPTURE_CLOUD_SETUP,
  }
  writeCloudTrace(
    traceFloats,
    {
      inverseView: inverseViewProj,
      view,
      frameIndex: input.frame,
      time: clouds.time,
      preExposure: input.preExposure,
      ...clouds.air,
    },
    plan,
    clouds.part,
  )
  const { at } = CLOUD_TRACE_LAYOUT
  const { gpu } = clouds.part
  traceFloats.fill(0, at.jitter, at.jitter + 4)
  // The capture is a reflection with no late fog and no scene depth (`markCloudTraceCapture`).
  markCloudTraceCapture(traceWords, clouds.part, clouds.air.airPresent)
  traceFloats[at.samples] = gpu.reflectionSamplesMost
  traceFloats[at.samples + 1] = gpu.reflectionShadowSamplesMost
  writeBlock(device, t.blocks.trace, face * BLOCK_STRIDE, traceFloats)
}

/** The clouds of face `face` traced into the cloud texture. */
function traceFace(
  device: GPUDevice,
  made: SkyLightPipelines,
  holds: FaceHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  face: number,
  input: SkyLightInputs,
  { air, clouds, key }: CapturedClouds,
) {
  const camera = faceCamera(face, input.position)
  const side = t.cloudSide
  writeAirFrame(
    frameFloats,
    { eye: input.position, world: camera.world, perspective: 1 },
    air.resolved,
    camera.viewProj,
    camera.inverseViewProj,
    side,
    side,
  )
  writeBlock(device, t.blocks.frame, face * BLOCK_STRIDE, frameFloats)
  writeFaceTrace(device, t, face, input, clouds, camera.inverseViewProj)
  const traced = made.cloudTrace(key)
  const pipeline = traced.pipeline.get()
  if (!pipeline) return
  const pass = encoder.beginComputePass(PASS)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, holds.traceGroups[face].air)
  pass.setBindGroup(1, holds.traceGroups[face].cloud)
  if (traced.extra) pass.setBindGroup(2, holds.extraGroup!)
  const groups = workgroupCount(side, CLOUD_TRACE_GROUP_SIZE)
  pass.dispatchWorkgroups(groups, groups, 1)
  pass.end()
}

/** What a draw of faces puts in each: the atmosphere (and the fog over it), the clouds' composition
 *  and a clear of the colour. */
interface FaceWork {
  readonly atmosphereDrawn: boolean
  /** The sky meshes' image is drawn in the place of the atmosphere. */
  readonly meshesDrawn: boolean
  readonly composing: boolean
  readonly clearing: boolean
}

function faceWork(withSky: boolean, withClouds: boolean, input: SkyLightInputs): FaceWork {
  // The scene's sky meshes, where it has a sky material, are drawn instead of the atmosphere (the reference's `bSceneHasSkyMaterial`).
  const meshesDrawn = withSky && !!input.skyMeshes?.ready
  const atmosphereDrawn = withSky && !meshesDrawn && input.atmosphere && input.air !== undefined
  const composing =
    withClouds && (input.part.light.lowerHemisphereIsSolidColor || input.clouds !== undefined)
  // The colour is cleared before the sky where the setting says (`skyLightAlwaysClear`), else only
  // where no sky is drawn over it.
  const clearing =
    withSky && !meshesDrawn && (!atmosphereDrawn || input.part.quality.skyLightAlwaysClear)
  return { atmosphereDrawn, meshesDrawn, composing, clearing }
}

const faceTarget: GPURenderPassColorAttachment = {
  view: undefined as never,
  loadOp: 'load',
  clearValue: { r: 0, g: 0, b: 0, a: 1 },
  storeOp: 'store',
}
const FACE: GPURenderPassDescriptor = {
  label: 'Trillion3D sky light face',
  colorAttachments: [faceTarget],
}

/** The sky shaded by the opaque scene where the setting asks (`skyLightShadowFromOpaque`), asked
 *  now where it is not made yet. */
const shadowedSky = (made: SkyLightPipelines, input: SkyLightInputs) =>
  input.part.quality.skyLightShadowFromOpaque && input.air?.maps
    ? made.skyShadowed.ask()
    : undefined

/** Whether the sky the faces draw is compiled: a capture draws no face with the unshaded sky in
 *  place of the shaded one, nor from a sky table not built yet, which would move its slices on over
 *  a wrong cube; nor with the fog program that reads the meshes' depth missing, where the fog is laid over their image
 *  (`facePass`: the meshes drawn, the fog read and shown). */
export const skyCompiled = (made: SkyLightPipelines, input: SkyLightInputs) =>
  (shadowedSky(made, input)?.ready ?? true) &&
  (!made.shape.skyView.fast || made.pipelines.skyView.ready) &&
  (!(input.skyMeshes?.ready && input.skyMeshes.depthBuffer && input.fog && input.fogShown) ||
    made.fogDepth.ask().ready)

/** The render pass of face `face`: the sky, or the sky meshes' image, the fog over it, then the clouds laid over. */
function facePass(
  made: SkyLightPipelines,
  holds: FaceHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  face: number,
  work: FaceWork,
  input: SkyLightInputs,
) {
  const { pipelines } = made
  faceTarget.view = t.faceTargets[face]
  const offset = [face * BLOCK_STRIDE]
  // The meshes' image replaces what was there, in a pass of its own (`SkyMeshes.drawFace`), the fog and the clouds go over it.
  if (work.meshesDrawn)
    input.skyMeshes!.drawFace(encoder, t.faceTargets[face], face, input.preExposure)
  faceTarget.loadOp = work.clearing ? 'clear' : 'load'
  const pass = encoder.beginRenderPass(FACE)
  if (work.atmosphereDrawn) {
    // Compiled: the capture waits for it (`skyCompiled`).
    const shadowed = shadowedSky(made, input)
    const sky = (shadowed ?? pipelines.sky).get()
    if (sky) {
      pass.setPipeline(sky)
      pass.setBindGroup(0, shadowed ? holds.shadowedGroup! : holds.skyGroup!)
      pass.setBindGroup(1, holds.faceGroup!.group, offset)
      pass.draw(3)
    }
  }
  if (work.atmosphereDrawn || work.meshesDrawn) {
    // Over the sky meshes with their depth, the fog is laid at the distance of the mesh in each pixel.
    const deep = work.meshesDrawn && input.skyMeshes!.depthBuffer
    const shown = holds.fogGroup && input.fog && input.fogShown
    const fog = shown ? (deep ? made.fogDepth.ask() : pipelines.fog).get() : undefined
    if (fog) {
      pass.setPipeline(fog)
      pass.setBindGroup(0, holds.fogGroup!)
      pass.setBindGroup(1, deep ? holds.depthGroups!.groups[face] : holds.faceGroup!.group, offset)
      pass.draw(3)
    }
  }
  const compose = work.composing ? pipelines.compose.get() : undefined
  if (compose) {
    pass.setPipeline(compose)
    pass.setBindGroup(0, t.groups.clouds)
    pass.setBindGroup(1, holds.faceGroup!.group, offset)
    pass.draw(3)
  }
  pass.end()
}

/** The sky table the sky of the faces reads, built from the capture's place in a frame that does not
 *  turn with the face (the first face's camera: any one would do, the faces read the table in the
 *  frame it is built in), before the faces are drawn. None where the quality settings ask for no
 *  table (`skyView.fast`). */
function buildSkyTable(
  device: GPUDevice,
  made: SkyLightPipelines,
  holds: FaceHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  input: SkyLightInputs,
) {
  const { skyView } = made.shape
  const pipeline = skyView.fast ? made.pipelines.skyView.get() : undefined
  if (!pipeline || !input.air) return
  const camera = faceCamera(0, input.position)
  writeAirFrame(
    frameFloats,
    { eye: input.position, world: camera.world, perspective: 1 },
    input.air.resolved,
    camera.viewProj,
    camera.inverseViewProj,
    1,
    1,
  )
  writeBlock(device, t.blocks.skyFrame, 0, frameFloats)
  const pass = encoder.beginComputePass(SKY_TABLE_PASS)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, holds.skyViewGroup)
  pass.dispatchWorkgroups(workgroupCount(skyView.width, 8), workgroupCount(skyView.height, 8), 1)
  pass.end()
}

/** The sky (`withSky`) and the clouds (`withClouds`) of faces `first` to `end`. */
function drawFaces(
  device: GPUDevice,
  made: SkyLightPipelines,
  holds: FaceHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  first: number,
  end: number,
  withSky: boolean,
  withClouds: boolean,
  input: SkyLightInputs,
) {
  const work = faceWork(withSky, withClouds, input)
  if (!work.atmosphereDrawn && !work.meshesDrawn && !work.composing && !work.clearing) return
  groupsFor(device, made, holds, t, input)
  if (work.atmosphereDrawn) buildSkyTable(device, made, holds, encoder, t, input)
  const traced = withClouds ? capturedClouds(input) : undefined
  for (let face = first; face < end; face++) {
    writeFace(device, t, face, input, !!traced)
    if (traced) traceFace(device, made, holds, encoder, t, face, input, traced)
    facePass(made, holds, encoder, t, face, work, input)
  }
}

/** The capture's faces: `draw` encodes the sky (`withSky`) and the clouds (`withClouds`) of faces
 *  `first` to `end`. */
export function createFaceDrawer(device: GPUDevice, made: SkyLightPipelines) {
  const holds: FaceHolds = { traceGroups: [] }
  return {
    draw: (
      encoder: GPUCommandEncoder,
      t: SkyLightTargets,
      first: number,
      end: number,
      withSky: boolean,
      withClouds: boolean,
      input: SkyLightInputs,
    ) => drawFaces(device, made, holds, encoder, t, first, end, withSky, withClouds, input),
  }
}
