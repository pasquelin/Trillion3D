import { AS_IS_FLAG, MODEL_FLAG, UNLIT_FLAG } from '../../../materials/surface/surfaceModelWord.ts'
import { PIXEL_MODEL } from '../../../materials/surface/pixelModel.ts'

/**
 * THE TEXT OF THE MATERIAL PROPERTIES VIEW (`materialProperties.ts`): the words its kernel wrote for the pixel under the cursor, as the table the view prints. The header names the
 * pixel's material mode and its closure count; a line gives the ambient occlusion and the top layer's roughness; the closure follows with its type, its basis, its diffuse colour, its
 * specular colour at normal incidence, its roughness, its anisotropy, its clear coat (weight, roughness, normal), its cloth (fuzz colour and weight) and its emission. A field the surface
 * does not carry is not printed. No GPU: the words as read back.
 */

/** The words the kernel writes: ten vectors of four (`MATERIAL_VECTORS`), each at its place below. */
export const MATERIAL_VECTORS = 10
export const MATERIAL_WORDS = MATERIAL_VECTORS * 4

/** Where each vector sits in the words. */
export const AT = {
  /** Base colour (rgb), metalness. */
  base: 0,
  /** Unit normal (xyz), roughness. */
  normal: 4,
  /** Emission (rgb), occlusion. */
  emission: 8,
  /** Surface model, pixel model, kind of lobes (0 none, 1 anisotropy and coat, 2 cloth), 1 where the pixel was read. */
  model: 12,
  /** Anisotropy strength, coat weight, coat roughness. */
  lobes: 16,
  /** Cloth: fuzz colour (rgb), cloth amount. */
  cloth: 20,
  /** Anisotropy direction (xyz). */
  axis: 24,
  /** Coat normal (xyz). */
  coatNormal: 28,
  /** The pixel read (xy). */
  pixel: 32,
  /** Specular colour at normal incidence (rgb), the specular. */
  f0: 36,
} as const

const SURFACE_MODEL_NAMES: Readonly<Record<number, string>> = {
  0: 'None',
  [UNLIT_FLAG]: 'Unlit',
  [MODEL_FLAG.physical]: 'Physical',
  [AS_IS_FLAG]: 'Debug view',
  [MODEL_FLAG.diffuse]: 'Diffuse',
  [MODEL_FLAG.shadow]: 'Shadow catcher',
}

/** The names of the shading models a physical pixel can carry (`PIXEL_MODEL`). */
const PIXEL_MODEL_NAMES: Readonly<Record<number, string>> = {
  [PIXEL_MODEL.subsurface]: 'Subsurface',
  [PIXEL_MODEL.skin]: 'Preintegrated skin',
  [PIXEL_MODEL.profile]: 'Subsurface profile',
  [PIXEL_MODEL.hair]: 'Hair',
  [PIXEL_MODEL.eye]: 'Eye',
  [PIXEL_MODEL.toon]: 'Toon',
}

const LOBES_NONE = 0
const LOBES_CLOTH = 2

const small = (value: number) => value.toFixed(3)
const colour = (words: ArrayLike<number>, at: number) =>
  [0, 1, 2].map((k) => small(words[at + k]!)).join(' ')

/** The lines of the table of the pixel the words describe; none before the first read. */
export function materialPropertiesLines(words: ArrayLike<number>): readonly string[] {
  if (words[AT.model + 3] !== 1) return []
  const surface = words[AT.model]!
  const physical = surface === MODEL_FLAG.physical
  const named = physical ? PIXEL_MODEL_NAMES[words[AT.model + 1]!] : undefined
  const lobeKind = words[AT.model + 2]!
  const cloth = lobeKind === LOBES_CLOTH
  const coat = lobeKind !== LOBES_NONE && !cloth && words[AT.lobes + 1]! > 0
  let mode = SURFACE_MODEL_NAMES[surface] ?? 'Unknown material mode'
  if (physical) {
    if (named) mode += ` - ${named}`
    if (coat) mode += ' - Legacy Clear Coat'
    if (cloth) mode += ' - Legacy Cloth'
  }
  const lines = [
    `Pixel: ${words[AT.pixel]} ${words[AT.pixel + 1]}`,
    `Closure Count = ${surface === 0 ? 0 : 1}   Material Mode = ${mode}`,
  ]
  if (surface === 0) return lines
  const rough = words[AT.normal + 3]!
  lines.push(
    `AO ${small(words[AT.emission + 3]!)}   TopRoughness ${small(coat ? words[AT.lobes + 2]! : rough)}`,
  )
  const base = [0, 1, 2].map((k) => words[AT.base + k]!)
  const metal = words[AT.base + 3]!
  if (surface === UNLIT_FLAG || surface === AS_IS_FLAG) {
    lines.push('Unlit', `  Colour ${colour(words, AT.base)}`)
  } else {
    const anisotropy = lobeKind === LOBES_NONE || cloth ? 0 : words[AT.lobes]!
    lines.push(
      named === 'Hair' || named === 'Eye' ? named : 'Slab',
      `  BasisType ${anisotropy > 0 ? 'Nor+Tan' : 'Normal'}   Normal ${colour(words, AT.normal)}`,
      `  Diffuse ${base.map((channel) => small(channel * (1 - metal))).join(' ')}`,
      `  F0 ${colour(words, AT.f0)}   Specular ${small(words[AT.f0 + 3]!)}`,
      `  Roughness ${small(rough)}`,
    )
    if (anisotropy > 0)
      lines.push(`  Anisotropy ${small(anisotropy)}   Direction ${colour(words, AT.axis)}`)
    if (coat)
      lines.push(
        '  Clear coat',
        `   - Weight ${small(words[AT.lobes + 1]!)}`,
        `   - Roughness ${small(words[AT.lobes + 2]!)}`,
        `   - Normal ${colour(words, AT.coatNormal)}`,
      )
    if (cloth)
      lines.push(
        '  Fuzz',
        `   - Colour ${colour(words, AT.cloth)}`,
        `   - Weight ${small(words[AT.cloth + 3]!)}`,
      )
  }
  const emission = [0, 1, 2].map((k) => words[AT.emission + k]!)
  if (emission.some((channel) => channel > 0))
    lines.push(`  Emissive ${emission.map(small).join(' ')}`)
  return lines
}
