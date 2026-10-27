import type { BlendedSurface } from '../../blend/pipelines.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { GRAPH_SHADING_MODELS } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { SURFACE_MODEL } from './surfaceModelWord.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ranksOf } from '../../../../math/src/sequence/ranks.ts'
import {
  TRANSLUCENCY_LIGHTING_CODE,
  translucencyLightingCode,
  volumeLightsShading,
} from './translucencyLighting.ts'

/** Where a blended layer gets its light: `forward`, the declared lights read for the pixel; `volume`, the translucency lighting volume
 *  at its point; `none`, nothing; `own`, a stage of its own (the single-layer water, a transmissive layer). */
type BlendLightSource = 'forward' | 'volume' | 'none' | 'own'

/**
 * THE ONE TRUTH TABLE OF A BLENDED LAYER'S LIGHT: where the layer of lighting mode `mode` (`TRANSLUCENCY_LIGHTING_CODE`'s names),
 * blending `blending`, shading model `shadingModel` and surface model `model` is lit from; `lit` whether its material is lit, `own` whether
 * it is the water or a transmissive layer. The translucency lighting volume's scene
 * test (`translucencyVolumeOf`), the record's model lane (`laneModelOf`) and the blend fragment (`blendLightsOf`) all follow it.
 * - the water and a transmissive layer have a stage of their own;
 * - an unlit surface, or the unlit shading model, is lit by nothing;
 * - the forward mode, and the shadow catcher in any mode, read the declared lights;
 * - a volume mode lights a normal or additive layer from the volume where the volume lights its shading model
 *   (`volumeLightsShading`: the default lit and the thin subsurface), whatever its surface model; every other layer has no light.
 */
export function blendLightSource(
  mode: string | undefined,
  blending: Blending | undefined,
  shadingModel: number | undefined,
  model: number | undefined,
  lit: boolean,
  own: boolean,
): BlendLightSource {
  if (own) return 'own'
  if (!lit || shadingModel === GRAPH_SHADING_MODELS.unlit) return 'none'
  if (
    model === SURFACE_MODEL.shadow ||
    translucencyLightingCode(mode) === TRANSLUCENCY_LIGHTING_CODE.forward
  )
    return 'forward'
  return (blending === 'normal' || blending === 'additive') && volumeLightsShading(shadingModel)
    ? 'volume'
    : 'none'
}

/** What `blendLightSource` reads of a layer: the fields of a blended surface that name its lighting (`water` false when absent). */
type SourceFacts = Pick<
  BlendedSurface['surface'],
  'translucencyLighting' | 'blending' | 'shadingModel' | 'model' | 'lit' | 'water'
>

/** Where a layer of `surface` is lit from (`blendLightSource`), the one reading of its facts; `transmissive` for a layer of the
 *  transmissive stage. */
const sourceOf = (surface: SourceFacts, transmissive = false) =>
  blendLightSource(
    surface.translucencyLighting,
    surface.blending,
    surface.shadingModel,
    surface.model,
    surface.lit,
    surface.water === true || transmissive,
  )

/** Whether a blended surface is lit from the translucency lighting volume (`blendLightSource`: `volume`). */
export const readsVolume = ({ surface, transmissive }: BlendedSurface) =>
  sourceOf(surface, transmissive) === 'volume'

/** Whether a material asks for contact shadows (`VisMaterial.contactShadows`): it says so and it is no single-layer water. */
export const asksContact = (surface: Pick<VisMaterial, 'contactShadows' | 'water'>) =>
  surface.contactShadows === true && surface.water !== true

/** Whether a blended surface casts contact shadow rays: its material asks (`asksContact`), and each pixel walks the declared
 *  lights, the transmissive layers' stage or the forward lighting's (`blendLightSource`), where the rays are cast. A volume-lit
 *  layer has no light to cast a ray toward. */
const asksContactShadows = ({ surface, transmissive }: BlendedSurface) =>
  asksContact(surface) && (transmissive || sourceOf(surface) === 'forward')

/** Whether a surface of `items` casts contact shadow rays (`asksContactShadows`): the programs then hold their code. */
export const contactShadowsOf = (items: readonly BlendedSurface[]) => items.some(asksContactShadows)

/** Whether a surface of `items` is lit from the translucency lighting volume: the programs then read it, and the frame builds it
 *  for as long as some item does. */
export const translucencyVolumeOf = (items: readonly BlendedSurface[]) => items.some(readsVolume)

/** THE LIGHTING PROGRAMS of the blend fragment, one per way a layer is lit (`blendLightingOf`), each a pipeline of its own:
 *  `forward` reads the declared lights, `volume` the translucency lighting volume (no declared light, no shadow trace), `lightless` is lit
 *  by neither (its bounce and reflection only) and `unlit` shows its emission alone. The plan ranks them (`../../blend/plan/planCull.ts`)
 *  and the fragment folds the rest away by the pipeline constant `BLEND_LIGHTING` (`blendLightingConstant`). */
export const BLEND_LIGHTINGS = ['forward', 'volume', 'lightless', 'unlit'] as const
export type LightingProgram = (typeof BLEND_LIGHTINGS)[number]
export const LIGHTING_RANK = ranksOf(BLEND_LIGHTINGS)

/** The pipeline constant naming the lighting a blend pipeline draws (`BLEND_LIGHTINGS`' rank). */
export const BLEND_LIGHTING = 'BLEND_LIGHTING'
/** The pipeline constant of a pipeline that draws lighting `lighting`. */
export const blendLightingConstant = (lighting: LightingProgram) => ({
  [BLEND_LIGHTING]: LIGHTING_RANK[lighting],
})
/** The WGSL constants of the lightings, named as the fragment's branches read them. */
export const BLEND_LIGHTING_CODES_WGSL = wgslBlock(
  'BLEND_LIGHTING_CODES_WGSL',
  [],
  BLEND_LIGHTINGS.map(
    (lighting) => `const L_${lighting.toUpperCase()}:u32=${LIGHTING_RANK[lighting]}u;`,
  ).join('\n'),
)

/** The lighting program that draws a blended surface, from the table above: forward where it reads the declared lights, the
 *  water's and a transmissive layer's own stage the forward one's (no plan rank of the blend modes draws them); where nothing lights
 *  it, `unlit` if its lit flag is cleared (`!lit` or the unlit shading model, which a graph's model never sets again) else `lightless`
 *  — but `volume` for a normal or additive layer whose graph wires its shading model, which may bring the volume's light back
 *  per pixel (`blendGraphFlags`). */
export function blendLightingOf({ surface, transmissive }: BlendedSurface): LightingProgram {
  const source = sourceOf(surface, transmissive)
  if (source === 'volume') return 'volume'
  if (source !== 'none') return 'forward'
  if (!surface.lit || surface.shadingModel === GRAPH_SHADING_MODELS.unlit) return 'unlit'
  const pixelModel = surface.modelFromGraph !== false && !!surface.graph?.outputs.shadingModel
  return pixelModel && (surface.blending === 'normal' || surface.blending === 'additive')
    ? 'volume'
    : 'lightless'
}
