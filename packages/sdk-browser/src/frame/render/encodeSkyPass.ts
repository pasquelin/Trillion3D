import { litBlendPipelines } from '../../blend/draw.ts'
import { blendDepth } from '../../blend/drawColour.ts'
import { skyPass } from '../../blend/skyDraw.ts'
import { skyViewOf } from '../../blend/expand/expansionViews.ts'
import { SKY_SURFACES_PASS } from '../../diagnostic/stage/passLabels.ts'
import { heldDirectLightResources } from '../prepare/contractLight.ts'
import { bindSkySurfaces } from './encodeBlend.ts'
import { setSkyDrawn } from './skyRoots.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * THE SKY PASS: the surfaces whose material is a sky material (`MATERIAL_FLAG.sky`), drawn into the lit image right after the opaque
 * surfaces are lit and before the atmosphere, the fog and the clouds are laid over the image (`encodeSkyAndClouds`) — the sky pass of
 * the base pass, ahead of the atmosphere, the clouds and the fog. They show their colour and emission as they are (an unlit surface),
 * at an alpha of one — a cutout keeps its mask —, tested against the depth of the opaque scene and writing none, so the dome lies behind
 * every surface: they are in no layer of the translucency, no front pass, no hierarchical depth, no shadow page marking, no screen
 * trace, no card and no shadow (the plan's sky view, `expansionViews.ts`). They take no fog of their own (`FLAG_FOG_FREE`): the fog
 * composition lays it over the image once, the dome in it. `prepared`: the transparents were prepared (`prepareBlend`), the lights are held. The pass says whether it
 * drew this image (`skyDrawn`): the atmosphere leaves the pixels of the dome alone only when it did (`encodeSkyAndClouds`), the sky pass and
 * the atmosphere of one image taking the same relevance.
 */
const colour: GPURenderPassColorAttachment = {
  view: undefined as unknown as GPUTextureView,
  loadOp: 'load',
  storeOp: 'store',
}
const drawPass = skyPass(SKY_SURFACES_PASS, colour, blendDepth)
export function encodeSkyPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  prepared: boolean,
) {
  setSkyDrawn(rt, false)
  const { gpu, blendState } = rt
  const view = skyViewOf(blendState)
  if (!prepared || view < 0) return
  if (!blendState.runCount || !blendState.argsBuffer || !gpu.hdrView || !gpu.depthView) return
  // The lights are those the lit pass just resolved (`bindSkySurfaces`): the groups are bound once the program that serves them is ready.
  const pipelines = litBlendPipelines(rt, device, heldDirectLightResources())
  if (!pipelines) return
  bindSkySurfaces(rt, device, true)
  colour.view = gpu.hdrView
  blendDepth.view = gpu.depthView
  // The atmosphere skips the pixels of the dome only when every sky run of the view was drawn: a run waiting for its program is drawn at a later image.
  const { encoded, waiting } = drawPass(rt, device, encoder, pipelines, view)
  setSkyDrawn(rt, encoded > 0 && waiting === 0)
}
