import { alphaHoldoutOf, readFilmSetting } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** Whether the alpha holdout is in effect this image: the engine supports it and the image carries
 *  an alpha channel (`primitiveAlphaHoldout`, `propagateAlpha`). Everything that holds out is drawn
 *  only while it is, so that an image without it draws what it always did. */
export const holdoutOn = (rt: WebgpuPagesRuntime) =>
  alphaHoldoutOf({
    propagateAlpha: readFilmSetting(rt, 'propagateAlpha'),
    primitiveAlphaHoldout: readFilmSetting(rt, 'primitiveAlphaHoldout'),
  })

/** Whether the height fog `fog` holds its light out of the image's alpha this image: it says so
 *  (`SceneHeightFog.holdout`) and the alpha holdout is in effect (`holdoutOn`). */
export const fogHoldout = (rt: WebgpuPagesRuntime, fog: { holdout: boolean } | undefined) =>
  !!fog?.holdout && holdoutOn(rt)

/** Whether the translucent layers' holdout is accumulated this image: the alpha holdout is in effect, or the
 *  image carries an alpha channel and draws a layer of blending `'alphaHoldout'`, which raises the alpha
 *  behind it without any switch of the holdout, as the reference's blend does: the accumulation lays the
 *  same alpha, the layers' own opacities alone, without the primitive flags, the sky, the clouds and the fog
 *  (`holdoutOn`). */
export const holdoutPassOn = (rt: WebgpuPagesRuntime) =>
  holdoutOn(rt) ||
  (readFilmSetting(rt, 'propagateAlpha') && rt.blendState.planModes.includes('alphaHoldout'))
