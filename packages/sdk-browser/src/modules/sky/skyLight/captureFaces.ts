import { workgroupCount } from '../../../../../math/src/scalar/integers.ts'
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
import { groupsFor, type FaceHolds } from './captureGroups.ts'
import { writeBlock, type SkyLightInputs } from './captureInputs.ts'
import { FACE_LAYOUT } from './faceWgsl.ts'
import { faceCamera } from './faces.ts'
import { BLOCK_STRIDE } from './layout.ts'
import type { SkyLightPipelines } from './pipelines.ts'
import type { SkyLightTargets } from './targets.ts'

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

type Air = NonNullable<SkyLightInputs['air']>
type Clouds = NonNullable<SkyLightInputs['clouds']>

/** Face `face`'s block: its number, whether the lower hemisphere is replaced and whether the
 *  clouds are laid, the position, the sides, and the lower colour with a coverage of one. */
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
  faceFloats.set([...input.position, 0], at.eye)
  faceFloats.set([t.width, 1 / t.width, t.cloudSide, 0], at.size)
  faceFloats.set([...light.lowerHemisphereColor, 1], at.lower)
  writeBlock(device, t.blocks.face, face * BLOCK_STRIDE, faceFloats)
}

/** Face `face`'s trace block, written: the camera of the face over the cloud texture, as a
 *  reflection with no late fog and no scene depth. */
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
      ...clouds.air,
    },
    plan,
    clouds.part,
  )
  const { at } = CLOUD_TRACE_LAYOUT
  const { gpu } = clouds.part
  traceFloats.fill(0, at.jitter, at.jitter + 4)
  // The capture is a reflection with no late fog and no scene depth (`markCloudTraceCapture`).
  markCloudTraceCapture(traceWords, clouds.part)
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
  air: Air,
  clouds: Clouds,
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
  const pass = encoder.beginComputePass({ label: 'Trillion3D sky light clouds' })
  pass.setPipeline(made.cloudTrace.pipeline.get())
  pass.setBindGroup(0, holds.traceGroups[face].air)
  pass.setBindGroup(1, holds.traceGroups[face].cloud)
  const groups = workgroupCount(side, CLOUD_TRACE_GROUP_SIZE)
  pass.dispatchWorkgroups(groups, groups, 1)
  pass.end()
}

/** What a draw of faces puts in each: the atmosphere (and the fog over it), the clouds' composition
 *  and a clear of the colour. */
interface FaceWork {
  readonly atmosphereDrawn: boolean
  readonly composing: boolean
  readonly clearing: boolean
}

function faceWork(withSky: boolean, withClouds: boolean, input: SkyLightInputs): FaceWork {
  const atmosphereDrawn = withSky && input.atmosphere && input.air !== undefined
  const composing =
    withClouds && (input.part.light.lowerHemisphereIsSolidColor || input.clouds !== undefined)
  return { atmosphereDrawn, composing, clearing: withSky && !atmosphereDrawn }
}

/** The render pass of face `face`: the sky, the fog over it, then the clouds laid over. */
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
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D sky light face',
    colorAttachments: [
      {
        view: t.faceTargets[face],
        loadOp: work.clearing ? 'clear' : 'load',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      },
    ],
  })
  const offset = [face * BLOCK_STRIDE]
  if (work.atmosphereDrawn) {
    pass.setPipeline(pipelines.sky.get())
    pass.setBindGroup(0, holds.skyGroup!)
    pass.setBindGroup(1, holds.faceGroup!.group, offset)
    pass.draw(3)
    if (input.fog && input.fogShown) {
      pass.setPipeline(pipelines.fog.get())
      pass.setBindGroup(0, holds.fogGroup!)
      pass.setBindGroup(1, holds.faceGroup!.group, offset)
      pass.draw(3)
    }
  }
  if (work.composing) {
    pass.setPipeline(pipelines.compose.get())
    pass.setBindGroup(0, t.groups.clouds)
    pass.setBindGroup(1, holds.faceGroup!.group, offset)
    pass.draw(3)
  }
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
  if (!work.atmosphereDrawn && !work.composing && !work.clearing) return
  groupsFor(device, made, holds, t, input)
  const { air, clouds } = input
  for (let face = first; face < end; face++) {
    const traced =
      withClouds &&
      air !== undefined &&
      clouds?.part.settings.inSkyCapture === true &&
      input.fog !== undefined
    writeFace(device, t, face, input, traced)
    if (traced) traceFace(device, made, holds, encoder, t, face, input, air, clouds)
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
