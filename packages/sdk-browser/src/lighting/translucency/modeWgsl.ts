import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import {
  TRANSLUCENCY_LIGHTING_FLAG_HIGH,
  TRANSLUCENCY_LIGHTING_FLAG_LOW,
  TRANSLUCENCY_LIGHTING_MODEL_SHIFT,
} from '../../materials/surface/surfaceModelWord.ts'
import { TRANSLUCENCY_LIGHTING_CODE } from '../../materials/surface/translucencyLighting.ts'

/**
 * HOW A BLENDED SURFACE IS LIT, carried from its record to its fragments (`TRANSLUCENCY_LIGHTING_CODE`):
 * the vertex stage turns the two bits of the record's model word into two bits of the item's flags
 * (`translucencyLightingFlags`, which sit where no flag, model lane or frame flag of the blend pass is),
 * and a fragment reads the code back (`translucencyLightingOf`).
 */
export const translucencyLightingFlags = wgslFn(
  'translucencyLightingFlags',
  [],
  `fn translucencyLightingFlags(model:u32)->u32{
 let mode=(model>>${TRANSLUCENCY_LIGHTING_MODEL_SHIFT}u)&3u;
 return ((mode&1u)<<${TRANSLUCENCY_LIGHTING_FLAG_LOW}u)|(((mode>>1u)&1u)<<${TRANSLUCENCY_LIGHTING_FLAG_HIGH}u);
}`,
)

/** The code of the lighting mode an item's flags carry (`TRANSLUCENCY_LIGHTING_CODE`). */
export const translucencyLightingOf = wgslFn(
  'translucencyLightingOf',
  [],
  `fn translucencyLightingOf(flags:u32)->u32{
 return ((flags>>${TRANSLUCENCY_LIGHTING_FLAG_LOW}u)&1u)|(((flags>>${TRANSLUCENCY_LIGHTING_FLAG_HIGH}u)&1u)<<1u);
}`,
)

/** Whether the lighting mode of an item's flags lights the layer as a medium (`translucencyMediumCode`): a medium reflects nothing. */
export const translucencyMedium = wgslFn(
  'translucencyMedium',
  [translucencyLightingOf],
  `fn translucencyMedium(flags:u32)->bool{
 let mode=translucencyLightingOf(flags);
 return mode==${TRANSLUCENCY_LIGHTING_CODE.volumetric}u||mode==${TRANSLUCENCY_LIGHTING_CODE.volumetricNonDirectional}u;
}`,
)

/** The codes as WGSL constants, named for a fragment's branches. */
export const TRANSLUCENCY_LIGHTING_CODES_WGSL = wgslBlock(
  'TRANSLUCENCY_LIGHTING_CODES_WGSL',
  [],
  `const TL_FORWARD:u32=${TRANSLUCENCY_LIGHTING_CODE.forward}u;
const TL_VOLUME:u32=${TRANSLUCENCY_LIGHTING_CODE.volume}u;
const TL_VOLUMETRIC:u32=${TRANSLUCENCY_LIGHTING_CODE.volumetric}u;
const TL_NON_DIRECTIONAL:u32=${TRANSLUCENCY_LIGHTING_CODE.volumetricNonDirectional}u;`,
)
