import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../../../frame/prepare/lit.ts'

/** Whether any light takes a shadow: the one gate of every light, the sun's included
 *  (`shadowQuality` above 0). Off, the frame plans no map and the lit programs drop their shadow
 *  code (`planVsmFrame`, `directLightResources`). */
export const shadowsOn = (rt: Pick<WebgpuPagesRuntime, 'context'>) =>
  readShadowSetting(rt, 'shadowQuality') > 0

/** Whether the shadowed local lights are lit in the one pass of the lights' grid, their shadows projected into the packed mask
 *  (`shadowOnePassProjection`) and the pass shared by every light of a cell (`clusteredDeferredShading`); else each is lit by a draw of its own. */
export const shadowsOnePass = (rt: WebgpuPagesRuntime) =>
  readShadowSetting(rt, 'shadowOnePassProjection') &&
  readShadowSetting(rt, 'clusteredDeferredShading')

/** Whether the project traces the translucent surfaces' shadow (`shadowTranslucentQuality` above 0). */
export const tracesTranslucent = (rt: WebgpuPagesRuntime) => rt.setup.translucentShadow.quality > 0

/** Whether a sun's shadow pages are marked in this image: a lit view, the shadow maps' plan of an
 *  earlier image in place, a sun that casts. */
export const marksSunPages = (rt: WebgpuPagesRuntime) => {
  const { lights, views } = rt
  return (
    wantsContractLighting(rt) &&
    views.active.overrides.lighting &&
    shadowsOn(rt) &&
    !!lights.vsm &&
    !!lights.buffer &&
    lights.store.shadowedSuns > 0
  )
}
