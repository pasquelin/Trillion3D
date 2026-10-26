import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { DEFAULT_TRANSLUCENCY_LIGHTING } from '../../../../sdk-core/src/world/constants/index.ts'
import { GRAPH_SHADING_MODELS } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { PIXEL_MODEL } from './pixelModel.ts'
import { MODEL_SHIFT, SURFACE_MODEL_MASK } from './surfaceModelWord.ts'

/** How the lights light a blended surface (`VisMaterial.translucencyLighting`), as a code: each light
 *  read for the pixel, or the light read from the translucency lighting volume
 *  (`../../lighting/translucency/`) as a surface, as a medium, or as a medium with no direction.
 *  Forward, 0, is how a transmissive material is imported; the default is the last. */
export const TRANSLUCENCY_LIGHTING_CODE = {
  forward: 0,
  volume: 1,
  volumetric: 2,
  volumetricNonDirectional: 3,
} as const
/** Whether the lighting mode `mode` lights a layer as a medium, which reflects nothing: the two volumetric modes. The CPU's twin of
 *  `translucencyMedium`. */
export const lightsAsMedium = (mode: string | undefined) => {
  const code = translucencyLightingCode(mode)
  return (
    code === TRANSLUCENCY_LIGHTING_CODE.volumetric ||
    code === TRANSLUCENCY_LIGHTING_CODE.volumetricNonDirectional
  )
}
/** The shading model numbers the translucency lighting volume lights (`volumeLightsShading`, `volumeLightsNumber`). */
const VOLUME_LIT_MODELS: readonly number[] = [
  GRAPH_SHADING_MODELS.defaultLit,
  PIXEL_MODEL.subsurface,
]
/** Whether the translucency lighting volume lights a surface of shading model `shadingModel` (`VisMaterial.shadingModel`): the default
 *  lit and the thin subsurface alone; a surface of another model is lit by nothing in a volume mode. */
export const volumeLightsShading = (shadingModel: number | undefined) =>
  shadingModel === undefined || VOLUME_LIT_MODELS.includes(shadingModel)
/** The WGSL twin of `volumeLightsShading` over a shading model number `model` (a `u32`). */
export const volumeLightsNumber = (model: string) =>
  `(${VOLUME_LIT_MODELS.map((id) => `${model}==${id}u`).join('||')})`
/** The model lane's seventh rank, held by the record alone — never a page row's or a surface flag, where it would read as the physical model:
 *  a blended surface of the standard model that nothing lights (`blendLightSource`: `none`, in a mode other than forward). The blend
 *  fragment reads it from its flags and lights the layer with nothing (`blendLightsOf`, `lightlessLane`). */
export const LIGHTLESS_MODEL = 7
/** Whether the model lane of item flags `flags` holds the lightless rank (`LIGHTLESS_MODEL`). */
export const lightlessLane = wgslFn(
  'lightlessLane',
  [],
  `fn lightlessLane(flags:u32)->bool{return ((flags>>${MODEL_SHIFT}u)&${SURFACE_MODEL_MASK}u)==${LIGHTLESS_MODEL}u;}`,
)

/** The code of a surface's lighting mode (`TRANSLUCENCY_LIGHTING_CODE`), the default's for none given; a mode
 *  that is none of them is refused. */
export const translucencyLightingCode = (mode: string | undefined) => {
  const code = (TRANSLUCENCY_LIGHTING_CODE as Record<string, number | undefined>)[
    mode ?? DEFAULT_TRANSLUCENCY_LIGHTING
  ]
  if (code === undefined) throw new Error(`SURFACE_MODEL: no translucency lighting mode '${mode}'`)
  return code
}
