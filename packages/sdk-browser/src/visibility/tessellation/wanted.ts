import { TESSELLATION_RULES } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { TessellationInput } from './input.ts'
import type { TessellationCapacity } from './uniform.ts'

/** The tessellation's setting `field` the session holds (`tessellationOptions.ts`), read at each
 *  image. */
const tessellationSetting = contextReader(TESSELLATION_RULES)

/**
 * Whether the image tessellates: the setting is on and the scene holds a surface that is displaced
 * (`materialTable.displaced`). Otherwise nothing of the tessellation is allocated, bound or drawn,
 * and the visibility uniform's `tessellation` word is zero (`../passes/uniforms.ts`).
 */
export const tessellationWanted = (rt: WebgpuPagesRuntime) =>
  tessellationSetting(rt, 'tessellation') && rt.vis.materialTable.displaced.count > 0

/** The capacity the settings name, in a record held from one image to the next. */
const asked: TessellationCapacity = { candidate: 0, visible: 0 }
export function tessellationAsked(rt: WebgpuPagesRuntime) {
  asked.candidate = tessellationSetting(rt, 'tessellationMaxCandidatePatches')
  asked.visible = tessellationSetting(rt, 'tessellationMaxVisiblePatches')
  return asked
}

/** What the image gives the raster, held from one image to the next and rewritten at each. */
const input: TessellationInput = {
  displaced: { ints: new Uint32Array(0), version: 0 },
  view: { projection: 1, height: 1, threshold: 1 },
  settings: { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 5 },
}

/**
 * The image's input to the raster, `undefined` where it does not tessellate (`tessellationWanted`):
 * the surfaces' records, the view's projection and the pixels it draws, the cut's threshold in
 * pixels an edge may span, and the settings. The one object, rewritten here.
 */
export function tessellationInput(rt: WebgpuPagesRuntime, cam: EngineCamera, height: number) {
  if (!tessellationWanted(rt)) return undefined
  input.displaced = rt.vis.materialTable.displaced
  input.view.projection = cam.projection[5]!
  input.view.height = height
  input.view.threshold = rt.run.selectionUniforms.pixelError
  input.settings.tessellationDicingRate = tessellationSetting(rt, 'tessellationDicingRate')
  input.settings.tessellationMaxPatchesPerGroup = tessellationSetting(
    rt,
    'tessellationMaxPatchesPerGroup',
  )
  return input
}
