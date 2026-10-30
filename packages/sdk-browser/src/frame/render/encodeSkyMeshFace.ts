import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { litBlendPipelines } from '../../blend/draw.ts'
import { skyPass } from '../../blend/skyDraw.ts'
import { skyViewOf } from '../../blend/expand/expansionViews.ts'
import { writeBlendView } from '../../blend/uniforms.ts'
import { bindSkySurfaces, prepareBlend } from './encodeBlend.ts'
import { submitColorCopy, withRenderEncoder } from './encoder.ts'
import { fillDirectParams } from './encodeLights.ts'
import { directLightResources } from '../prepare/contractLight.ts'
import { followLobes } from '../prepare/lobesTarget.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

/**
 * A FACE OF THE SKY MESHES' CAPTURE (`ViewOverrides.skyMeshCapture`, `encodeSkyMeshes.ts`) as the light draw it is: the scene's sky surfaces,
 * and nothing else, drawn from the camera of the face by the blend pass's own plan — selected by the face's cut, culled, sorted and expanded
 * (`prepareBlend`), bound (`bindSkySurfaces`) and drawn (`skyPass`) like the main view's — into the face's colour and depth targets in a
 * single pass. No visibility pass, no lighting, shadow, global illumination, sky, fog, cloud, light shaft nor effect is encoded: the blend
 * view is an unlit one (`writeViewFrame`), whose surfaces show their colour and emission as they are, at a pre-exposure of one.
 *
 * With the depth buffer (`ViewOverrides.skyMeshCapture.depthBuffer`) the pass clears the depth to the far and writes the depth of each pixel
 * (`BlendModePipelines.skyFace`), so that the surfaces cover each other by their distance and the face's depth, handed to the reader
 * with the lit image, tells the distance of the mesh seen in each pixel; without it the surfaces are painted in the order of their sort.
 * A sky surface is opaque (`blendSurface`): its cutout alone reads the base alpha. The face draws the sky view of the plan
 * (`skyPass`, `blendState.skyItems`), the same runs the sky pass draws, never a layer of the translucency.
 *
 * The face prepares the sky view alone (`prepareBlend`'s `skyOnly`): no occlusion test of the main view's, no transparent layer, and the main
 * image's views, verdict counts and rejected count are not touched. The lit image is handed to the reader (`ViewOverrides.readLit`) once the face is drawn. A face whose plan holds no sky surface
 * (`empty`) draws nothing and hands nothing: its layer is not an image of the meshes, so the cube is not whole and the capture keeps the
 * atmosphere. While a program it needs compiles (`waiting`), nothing is handed either and the face is asked again at the next image, for as
 * long as it takes: the compile is the device's to refuse and say.
 */

const colour: GPURenderPassColorAttachment = {
  view: undefined as unknown as GPUTextureView,
  loadOp: 'clear',
  clearValue: { r: 0, g: 0, b: 0, a: 1 },
  storeOp: 'store',
}
const depth: GPURenderPassDepthStencilAttachment = {
  view: undefined as unknown as GPUTextureView,
  depthLoadOp: 'clear',
  depthClearValue: DEPTH_CLEAR,
  depthStoreOp: 'store',
}
const drawPass = skyPass('Trillion3D sky meshes face', colour, depth)

/** Encodes and submits the image of the drawn face. */
export function encodeSkyMeshFace(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, lights } = rt,
    capture = rt.views.active.overrides.skyMeshCapture
  const [width, height] = gpu.targetSize
  followLobes(rt)
  withRenderEncoder(rt, device, (encoder) => {
    // The pre-exposure of one the cube layer is kept at (`SkyMeshes.drawFace` multiplies it by the capture's), the tiles none.
    fillDirectParams(rt, cam, lights.store.environment)
    const state = drawSkySurfaces(
      rt,
      device,
      encoder,
      !!capture?.depthBuffer,
      prepareBlend(rt, encoder, cam, true),
    )
    if (state === 'drawn')
      rt.views.active.overrides.readLit?.(
        encoder,
        gpu.hdrView!,
        gpu.targetSize,
        gpu.allocatedSize,
        gpu.depthView,
      )
    // An image that waits for a program is no image to hold still: the face is drawn again at the next one.
    else if (state === 'waiting') rt.run.gate.viewReplaced()
    // A face with no sky surface in its cut holds no image of the meshes: the cube is not whole, the capture keeps the atmosphere.
    else capture?.empty()
    submitColorCopy(rt, device, encoder, height, width)
  })
}

/** What a face's draw came to: its sky surfaces drawn into the targets, a program they need still compiling (or the pass's resources
 *  not made), or no sky surface in the plan to draw. */
type FaceState = 'drawn' | 'waiting' | 'empty'

/** The sky surfaces drawn into the face's targets, `depthBuffer` writing their depth. `prepared`: the plan was prepared; it is not
 *  where the plan holds no item at all. */
function drawSkySurfaces(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  depthBuffer: boolean,
  prepared: boolean,
): FaceState {
  const { gpu, blendState } = rt
  if (!gpu.hdrView || !gpu.depthView) return 'waiting'
  if (!prepared) return blendState.blendGpu.length ? 'waiting' : 'empty'
  const view = skyViewOf(blendState, true)
  if (view < 0) return 'empty'
  // The pipelines first, as the sky pass does (`encodeSkyPass`): the groups are bound once the program that serves them is ready. The face
  // resolves the lights itself, the lit pass drawing none.
  const pipelines = litBlendPipelines(rt, device, directLightResources(rt))
  if (!pipelines || !blendState.argsBuffer) return 'waiting'
  // The blend view of the face's camera, and the groups of the sky surfaces: the cloud image and the volumes of the main image are not made yet.
  writeBlendView(rt, device)
  bindSkySurfaces(rt, device, true)
  colour.view = gpu.hdrView
  depth.view = gpu.depthView
  const { encoded, waiting } = drawPass(
    rt,
    device,
    encoder,
    depthBuffer ? pipelines.skyFace : pipelines,
    view,
  )
  // The pipelines a run needs are asked by the draw (`drawBlendRuns`): a face is handed over once every run of the view had its own, empty where the view keeps no run to draw.
  if (waiting > 0) return 'waiting'
  return depthBuffer || encoded > 0 ? 'drawn' : 'empty'
}
