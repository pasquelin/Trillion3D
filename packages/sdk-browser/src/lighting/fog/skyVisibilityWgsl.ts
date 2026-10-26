import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { globalDistanceFieldReadWgsl } from '../distanceField/globalReadWgsl.ts'

/**
 * THE SKY'S VISIBILITY OF A SAMPLE (`fogSkyVisibility`, read by `fogLightAt` for each sample it lights): the share of
 * the sky that one 45 degree cone straight up from the sample sees through the global distance field
 * (`gdfSkyVisibility`), the sample carried to centimetres, the field's unit, and to its translated space
 * (`gdfTranslated`). The sky light's term of the sample is multiplied by it, so that a cell the samples of which
 * differ in what they see, as the cells a camera just uncovered take several, lights each by its own. The up of the
 * world is its +y. The program binds the field's six bindings from `field` in group 0
 * (`globalDistanceFieldReadWgsl`); the scatter that binds none reads the other block, which answers a wholly visible
 * sky (`FOG_NO_SKY_VISIBILITY_WGSL`).
 */
export const FOG_SKY_VISIBILITY_WGSL = (field: number): WgslDecl =>
  wgslBlock(
    `FOG_SKY_VISIBILITY_WGSL(${field})`,
    [globalDistanceFieldReadWgsl(0, field)],
    `fn fogSkyVisibility(P:vec3f)->f32{
 return gdfSkyVisibility(gdfTranslated(P*${CENTIMETRES_PER_METRE}.0),vec3f(0.0,1.0,0.0));
}`,
  )

/** The sky's visibility of a scatter with no distance field: the sky is wholly visible. */
export const FOG_NO_SKY_VISIBILITY_WGSL: WgslDecl = wgslBlock(
  'FOG_NO_SKY_VISIBILITY_WGSL',
  [],
  `fn fogSkyVisibility(P:vec3f)->f32{return 1.0;}`,
)
