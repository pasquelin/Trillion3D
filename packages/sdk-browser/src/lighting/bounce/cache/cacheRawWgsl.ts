import type { WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { lightWordsOf, lightWordsWgsl } from '../../../gpu/core/lightWords.ts'

/**
 * THE TEXT A PROGRAM READS A TEXEL OF THE RAW ATLAS (and of the trace atlas, laid as it is) WITH, by the format its light is stored in (`radianceRawFormat`): where the
 * light is one word the texel is two (`vec2u`: the light's word, the ray's distance word), else four (`vec4u`: the light's words, the distance word last). The texels are
 * read with the spelling of the program (`names`: `xy` or `rg` for the two-word texel), so that the word format writes the text it always wrote.
 */

/** The channels a program names a two-word texel's by: its light's word first, its distance word second. */
type Names = 'xy' | 'rg'

/** The type of the texel a program holds of the raw atlas. */
export const rawTexelType = (light: LightAtlasFormat) =>
  lightWordsOf(light) === 1 ? 'vec2u' : 'vec4u'

/** The channels of a texel a program loads from the raw atlas. */
export const rawChannels = (light: LightAtlasFormat) => (lightWordsOf(light) === 1 ? 'rg' : 'rgba')

/** The light of the texel `texel` of the raw atlas. */
export const rawLightOf = (light: LightAtlasFormat, texel: string, names: Names = 'xy') =>
  lightWordsOf(light) === 1
    ? `unpackLight(${texel}.${names[0]})`
    : `lightFloats(${texel}.${names === 'xy' ? 'xyz' : 'rgb'})`

/** The distance word of the texel `texel` of the raw atlas. */
export const rawWordOf = (light: LightAtlasFormat, texel: string, names: Names = 'xy') =>
  `${texel}.${rawWordChannel(light, names)}`

/** The channel of the raw atlas's distance word. */
export const rawWordChannel = (light: LightAtlasFormat, names: Names = 'xy') =>
  lightWordsOf(light) === 1 ? names[1] : names === 'xy' ? 'w' : 'a'

/** What a program that reads or writes the raw atlas declares beside the word format's functions: the light's words, where there are several. */
export const rawDeps = (light: LightAtlasFormat): WgslDecl[] => {
  const words = lightWordsOf(light)
  return words === 1 ? [] : [lightWordsWgsl(words as 2 | 3)]
}
