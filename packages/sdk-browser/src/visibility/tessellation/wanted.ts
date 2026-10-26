import { readTessellationSetting } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { WebgpuTileStreamer } from '../../materials/virtual/streamer/streamer.ts'
import type { TessellationInput } from './input.ts'
import { recordRoom, type TessellationCapacity } from './uniform.ts'
import { warmDisplacements } from './warm.ts'
import { cutPyramid, previousPyramid } from '../../frame/render/pyramidSources.ts'

/**
 * Whether the image tessellates: the setting is on and the scene holds a surface that is displaced
 * (`materialTable.displaced`). Otherwise nothing of the tessellation is allocated, bound or drawn,
 * and the visibility uniform's `tessellation` word is zero (`../passes/uniforms.ts`).
 */
export const tessellationWanted = (rt: WebgpuPagesRuntime) =>
  readTessellationSetting(rt, 'tessellation') && rt.vis.materialTable.displaced.count > 0

/** The capacity the settings name and the room the displaced surfaces' records need, in a record held
 *  from one image to the next. */
const asked: TessellationCapacity = { candidate: 0, visible: 0, records: 0 }
export function tessellationAsked(rt: WebgpuPagesRuntime) {
  asked.candidate = readTessellationSetting(rt, 'tessellationMaxCandidatePatches')
  asked.visible = readTessellationSetting(rt, 'tessellationMaxVisiblePatches')
  asked.records = recordRoom(rt.vis.materialTable.displaced.ints.length)
  return asked
}

/** What the image gives the raster, held from one image to the next and rewritten at each. */
const input: TessellationInput = {
  displaced: { ints: new Uint32Array(0), version: 0 },
  view: { projection: 1, height: 1, threshold: 1 },
  settings: { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 5 },
  occlusion: {
    previous: undefined,
    current: () => (runtime ? cutPyramid(runtime) : undefined),
    uniforms: {
      prevViewProj: undefined,
      depthMap: [0, 0],
      prevDepthMap: undefined,
      prevSize: undefined,
    },
  },
}
/** The runtime the post pass's pyramid is read from (`TessellationOcclusion.current`): the one whose
 *  image the input was written for. */
let runtime: WebgpuPagesRuntime | undefined

/**
 * The image's input to the raster, `undefined` where it does not tessellate (`tessellationWanted`):
 * the surfaces' records, the view's projection and the pixels it draws (`size`), the cut's threshold
 * in pixels an edge may span, and the settings; the height maps' tiles asked for
 * (`warmDisplacements`). The one object, rewritten here.
 */
export function tessellationInput(
  rt: WebgpuPagesRuntime,
  textures: Pick<WebgpuTileStreamer, 'warm'>,
  size: readonly number[],
) {
  if (!tessellationWanted(rt)) return (runtime = undefined)
  const { settings, view } = input
  input.displaced = rt.vis.materialTable.displaced
  view.projection = rt.run.gate.cam.projection[5]!
  view.height = size[1]!
  view.threshold = rt.run.selectionUniforms.pixelError
  settings.tessellationDicingRate = readTessellationSetting(rt, 'tessellationDicingRate')
  settings.tessellationMaxPatchesPerGroup = readTessellationSetting(
    rt,
    'tessellationMaxPatchesPerGroup',
  )
  runtime = rt
  input.occlusion.previous = previousPyramid(rt)
  input.occlusion.uniforms = rt.run.selectionUniforms
  warmDisplacements(
    textures,
    input.displaced,
    Math.max(size[0]!, size[1]!),
    settings.tessellationDicingRate,
    rt.run.frame,
  )
  return input
}
