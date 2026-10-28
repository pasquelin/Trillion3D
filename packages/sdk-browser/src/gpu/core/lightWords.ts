import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { LightAtlasFormat } from './lightAtlasFormat.ts'

/**
 * THE WORDS A LIGHT IS KEPT IN where a texture of its format cannot be written, or read and written, as a texel of floats: a layer read and written in place
 * (a storage texture grants that only to the 32-bit one-channel formats) or a texel that also holds a distance beside it (the radiance cache's raw atlas) is a texture of
 * 32-bit words, a light of `lightWordsOf` of them. The 11-11-10 format, native or not, is one word (`packLight`, the value the native format would hold); the half floats
 * are two (`pack2x16float`: the red and green, then the blue), the single floats three (their bits), so that what a texel of floats holds is kept, with no rounding to
 * the 11-11-10 floats' mantissas.
 */

/** The words a light stored in `light` is kept in. */
export const lightWordsOf = (light: LightAtlasFormat): 1 | 2 | 3 =>
  light === 'rgba16float' ? 2 : light === 'rgba32float' ? 3 : 1

/** `lightFloats(words)`: the light of the words `words` (a vector of three, the unused ones zero), `lightPack(light)`: the words of a light, for a light kept in `words` words (2 or 3). */
export const lightWordsWgsl = (words: 2 | 3): WgslDecl =>
  wgslBlock(
    `LIGHT_WORDS_WGSL(${words})`,
    [],
    words === 3
      ? `fn lightFloats(w:vec3u)->vec3f{return bitcast<vec3f>(w);}
fn lightPack(v:vec3f)->vec3u{return bitcast<vec3u>(v);}`
      : `fn lightFloats(w:vec3u)->vec3f{return vec3f(unpack2x16float(w.x),unpack2x16float(w.y).x);}
fn lightPack(v:vec3f)->vec3u{return vec3u(pack2x16float(v.xy),pack2x16float(vec2f(v.z,0.0)),0u);}`,
  )
