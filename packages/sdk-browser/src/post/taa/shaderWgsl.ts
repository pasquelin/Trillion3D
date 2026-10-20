import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts'
import * as layer from './layers.ts'
import { BINDINGS_WGSL, shareBindingsWgsl } from './bindingsWgsl.ts'
import { HISTORY_READ_WGSL, HISTORY_WEIGHTS_WGSL } from './historyWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { AS_IS_FLAG } from '../../materials/surface/surfaceModel.ts'
import { RANGE_BOUND } from '../../../../math/src/wgsl/constants.ts'
import { clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { ndcToUv, uvToNdc } from '../../../../math/src/wgsl/projection.ts'
import { COLOR_SPACES_WGSL, DITHER_WGSL } from './colorSpaceWgsl.ts'
import { REPROJECTION_VECTOR_WGSL } from './velocityWgsl.ts'
import { ANTI_ALIAS_OFFSET_WGSL } from './spatialAntiAliasingWgsl.ts'

/** How a resolve reads a render texel `at`: the colour and the as-is weight (a blended share's
 *  value, or whether the flags say as-is). */
export const texelReads = (blended: boolean) => ({
  color: (at: string) => `textureLoad(current,${at},0)`,
  flag: (at: string) =>
    blended ? `textureLoad(flags,${at},0).r` : `f32(textureLoad(flags,${at},0).r==${AS_IS_FLAG}u)`,
})

/** One kernel sample's as-is share, weighed like its colour, read through `read`; nothing in the
 *  flagless resolve. */
export const taaShareTap = (asIs: boolean, read: ReturnType<typeof texelReads>) =>
  asIs
    ? `  let asIs=${read.flag('at')};\n  share+=asIs*weight;shareLo=min(shareLo,asIs);shareHi=max(shareHi,asIs);\n`
    : ''

/** What the history update opens with: bindings, uniform, the full-screen triangle, the colour
 *  spaces, the history's read and weight laws (`historyWgsl.ts`), the reprojection vector's decoding
 *  and the anti-aliaser's offset (`spatialAntiAliasingWgsl.ts`), and the output (`taaOut`,
 *  `layers.ts`). */
export const taaPrelude = (asIs: boolean, blended: boolean, filtered = false) => {
  const at = (location: number) => `@location(${location}) `
  return wgslBlock(
    `taaPrelude(${asIs}, ${blended}, ${filtered})`,
    [
      BINDINGS_WGSL,
      ...(asIs ? [shareBindingsWgsl(blended)] : []),
      FULLSCREEN_VERTEX,
      COLOR_SPACES_WGSL,
      DITHER_WGSL,
      HISTORY_READ_WGSL,
      HISTORY_WEIGHTS_WGSL,
      REPROJECTION_VECTOR_WGSL,
      ANTI_ALIAS_OFFSET_WGSL,
      RANGE_BOUND,
      clampToExtent,
      ndcToUv,
      uvToNdc,
    ],
    `${layer.layerText(filtered, 'bindings')}
struct TaaOut{${at(0)}color:vec4f,${at(1)}share:vec4f,${filtered ? `${at(2)}tint:vec4f,${at(3)}add:vec4f,` : ''}}`,
  )
}
