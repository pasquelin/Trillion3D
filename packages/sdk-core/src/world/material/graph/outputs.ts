import type { AlphaMode } from '../../../contracts/material.ts'
import { MATERIAL_DOMAINS, type MaterialDomain } from '../../../contracts/volumeMaterial.ts'
import { graphError, type ValueType } from './valueType.ts'

/** The outputs of a graph: one per input of the material, each with the type it is cast to and the
 *  value it takes where nothing is wired (or the output is inactive). */
export const GRAPH_OUTPUTS = {
  baseColor: { type: 'f3', fallback: [0, 0, 0] },
  metallic: { type: 'f1', fallback: [0] },
  specular: { type: 'f1', fallback: [0.5] },
  roughness: { type: 'f1', fallback: [0.5] },
  emissive: { type: 'f3', fallback: [0, 0, 0] },
  opacity: { type: 'f1', fallback: [1] },
  opacityMask: { type: 'f1', fallback: [1] },
  normal: { type: 'f3', fallback: [0, 0, 1] },
  ambientOcclusion: { type: 'f1', fallback: [1] },
  subsurfaceColor: { type: 'f3', fallback: [1, 1, 1] },
  anisotropy: { type: 'f1', fallback: [0] },
  tangent: { type: 'f3', fallback: [1, 0, 0] },
  clearCoat: { type: 'f1', fallback: [1] },
  clearCoatRoughness: { type: 'f1', fallback: [0.1] },
  refraction: { type: 'f1', fallback: [1] },
  worldPositionOffset: { type: 'f3', fallback: [0, 0, 0] },
  shadingModel: { type: 'f1', fallback: [1] },
  pixelDepthOffset: { type: 'f1', fallback: [0] },
  cloth: { type: 'f1', fallback: [0] },
  displacement: { type: 'f1', fallback: [0.5] },
  clearCoatBottomNormal: { type: 'f3', fallback: [0, 0, 1] },
  scatteringCoefficients: { type: 'f3', fallback: [0, 0, 0] },
  absorptionCoefficients: { type: 'f3', fallback: [0, 0, 0] },
  phaseG: { type: 'f1', fallback: [0] },
  colorScaleBehindWater: { type: 'f3', fallback: [1, 1, 1] },
  transmittanceColor: { type: 'f3', fallback: [0.5, 0.5, 0.5] },
  surfaceCoverage: { type: 'f1', fallback: [1] },
} as const satisfies Record<string, { type: ValueType; fallback: readonly number[] }>

/**
 * The shading models a graph's `shadingModel` output names, by the number it gives (the rounded
 * value): the reference's own enumeration, so a graph written for it reads the same. A pixel of a
 * lit surface takes its model from the output where the graph wires it, the
 * material's own where it does not. The cloth model (`cloth`) reads its fuzz colour from the
 * `subsurfaceColor` output and its amount from the `cloth` output, a pixel of any other model
 * reading `subsurfaceColor` as its thin transmission. The lighting has the physical model (`defaultLit`), the unlit
 * one (`unlit`: the emission alone), the thin subsurface (`subsurface`, `twoSidedFoliage`), the
 * clear coat (`clearCoat`), the cloth (`cloth`), the preintegrated skin (`preintegratedSkin`: its
 * `subsurfaceColor` and, as the opacity of the skin, its `opacity` output), the hair (`hair`: the
 * `normal` output is the fibre's direction, `metallic` the scatter amount) and the eye (`eye`: the
 * iris mask and distance are the `clearCoat` and `clearCoatRoughness` outputs, the iris normal the
 * `tangent` output in the world's axes, a dielectric whose metalness is not read): a pixel of any other
 * (`subsurfaceProfile`, `singleLayerWater`, `thinTranslucent`) is lit as `defaultLit`.
 */
export const GRAPH_SHADING_MODELS = {
  unlit: 0,
  defaultLit: 1,
  subsurface: 2,
  preintegratedSkin: 3,
  clearCoat: 4,
  subsurfaceProfile: 5,
  twoSidedFoliage: 6,
  hair: 7,
  cloth: 8,
  eye: 9,
  singleLayerWater: 10,
  thinTranslucent: 11,
} as const

/** The name of an output of a graph. */
export type GraphOutput = keyof typeof GRAPH_OUTPUTS

/** How the surface blends (`alphaModeOf`): what decides whether its opacity or its mask is read. */
export type GraphBlend = AlphaMode

/** The outputs each domain reads: a surface all of them; a light function its emission alone; a
 *  volume its albedo (`baseColor`), its extinction (`subsurfaceColor`) and its
 *  emission. A wire to any other output is refused. */
export const DOMAIN_OUTPUTS: Record<MaterialDomain, readonly GraphOutput[]> = {
  surface: Object.keys(GRAPH_OUTPUTS) as GraphOutput[],
  lightFunction: ['emissive'],
  volume: ['baseColor', 'subsurfaceColor', 'emissive'],
}

/** Whether `domain` accepts a graph (`'surface'`, `'lightFunction'` or `'volume'`). */
export const isGraphDomain = (value: unknown): value is MaterialDomain =>
  (MATERIAL_DOMAINS as readonly unknown[]).includes(value)

/** Whether `name` is the name of an output. */
const isGraphOutput = (name: unknown): name is GraphOutput =>
  typeof name === 'string' && Object.hasOwn(GRAPH_OUTPUTS, name)

/** Refuses an output the domain does not read. */
export function assertDomainOutput(
  domain: MaterialDomain,
  name: string,
): asserts name is GraphOutput {
  if (!isGraphOutput(name)) throw graphError(`'${name}' is not an output`, { output: name })
  if (!DOMAIN_OUTPUTS[domain].includes(name))
    throw graphError(`the ${domain} domain does not read '${name}'`, { domain, output: name })
}

/** The outputs a surface that is not lit reads: its emission, its opacity or mask, whichever its
 *  blend reads, the offset that moves its vertices and the depth offset of its pixels; the others take
 *  their fallbacks. */
const UNLIT_OUTPUTS: readonly GraphOutput[] = [
  'emissive',
  'opacity',
  'opacityMask',
  'worldPositionOffset',
  'pixelDepthOffset',
  'displacement',
]

/** The outputs of the single-layer water's volume, per centimetre for the two coefficients: a surface
 *  whose graph wires any of them is a body of water (`isWaterGraph`). */
export const WATER_OUTPUTS = [
  'scatteringCoefficients',
  'absorptionCoefficients',
  'phaseG',
  'colorScaleBehindWater',
] as const satisfies readonly GraphOutput[]

/** Whether a graph's wired outputs make its surface single-layer water: it wires one of the water outputs. */
export const isWaterGraph = (outputs: Partial<Record<GraphOutput, unknown>> | undefined) =>
  !!outputs && WATER_OUTPUTS.some((name) => outputs[name] !== undefined)

/** The outputs of the thin translucent model: the colour the background is multiplied by for a view
 *  perpendicular to the surface (0.5 by default) and the coverage of the surface, thin part and
 *  material over it (1 by default); the layer's `opacity` output is the coverage of the material over
 *  the thin part. A surface whose graph wires one is thin translucent (`isThinTranslucentGraph`). */
export const THIN_TRANSLUCENT_OUTPUTS = [
  'transmittanceColor',
  'surfaceCoverage',
] as const satisfies readonly GraphOutput[]

/** Whether a graph's wired outputs make its surface thin translucent: it wires one of its outputs. */
export const isThinTranslucentGraph = (
  outputs: Partial<Record<GraphOutput, unknown>> | undefined,
) => !!outputs && THIN_TRANSLUCENT_OUTPUTS.some((name) => outputs[name] !== undefined)

/** The outputs only the opaque or masked passes read (`outputActive`). */
const OPAQUE_PASS_OUTPUTS: readonly GraphOutput[] = [
  'cloth',
  'displacement',
  'clearCoatBottomNormal',
]

/** What a surface says of how its outputs are read: how it blends, whether it is lit and whether the
 *  transparent pass draws it (a blended or transmissive surface). */
export interface GraphReading {
  readonly blend: GraphBlend
  readonly lit?: boolean
  readonly translucent?: boolean
  /** Whether the graph wires the shading model: an opaque lit surface then reads its opacity. */
  readonly models?: boolean
  /** Whether the surface is single-layer water: it reads the water outputs, its refraction and, as the
   *  coverage of its base material over the water, its opacity. */
  readonly water?: boolean
  /** Whether the surface is thin translucent: it reads the thin translucent outputs and its opacity. */
  readonly thin?: boolean
}

/** Whether a surface reads `name` under `reading`: opacity only translucent (blended), the mask only
 *  masked, the shading model where the opaque, masked or transparent pass lights by it, the refraction only
 *  where the transparent pass draws it, the opacity of an opaque lit surface only where its graph wires the
 *  shading model, and — where the surface is not
 *  lit — nothing but the emission, the opacity, the mask, the offset and the pixel depth offset; an inactive output takes
 *  its fallback.
 *  The other domains read what they list. */
export function outputActive(domain: MaterialDomain, name: GraphOutput, reading: GraphReading) {
  if (!DOMAIN_OUTPUTS[domain].includes(name)) return false
  if (domain !== 'surface') return true
  return surfaceOutputActive(name, reading)
}

/** `outputActive` on a surface. */
function surfaceOutputActive(
  name: GraphOutput,
  {
    blend,
    lit = true,
    translucent = true,
    models = false,
    water = false,
    thin = false,
  }: GraphReading,
) {
  if ((WATER_OUTPUTS as readonly string[]).includes(name)) return water && lit
  if ((THIN_TRANSLUCENT_OUTPUTS as readonly string[]).includes(name)) return thin && lit
  if (!lit && !UNLIT_OUTPUTS.includes(name)) return false
  // The pixel depth offset is read by the rasters and, in the transparent pass, by the mark the layer
  // leaves in the responsiveness, at the depth it moves the pixel to.
  if (name === 'pixelDepthOffset') return true
  // The outputs of the opaque or masked passes alone: the depth a pixel is written at (the visibility rasters'; the
  // transparent pass writes none), the cloth model's amount (the lobes are the opaque resolve's; the
  // fuzz colour is the `subsurfaceColor` output, as the cloth model reads it) and the height the
  // tessellation pushes a surface's points by (the dicing draws them).
  if (OPAQUE_PASS_OUTPUTS.includes(name)) return !translucent && blend !== 'blend'
  // The shading model a pixel picks: the opaque passes shade by it and the transparent pass lights and reflects by it (unlit, hair,
  // the models the translucency lighting volume lights).
  if (name === 'shadingModel') return translucent || blend !== 'blend'
  if (name === 'refraction') return translucent || water
  // The opacity of an opaque lit surface is read where its shading model may be another than the
  // default lit one: the skin reads it.
  if (name === 'opacity')
    return blend === 'blend' || water || thin || (models && lit && !translucent)
  return name !== 'opacityMask' || blend === 'mask'
}
