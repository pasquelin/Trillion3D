import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { lightWordsWgsl } from '../../gpu/core/lightWords.ts'

/**
 * THE INDIRECT LIGHT'S LAYER IS READ AND WRITTEN IN PLACE (the radiosity blends the light of an image into what the layer held, in one pass), which a storage texture
 * grants only to the 32-bit one-channel formats (`r32uint`): the layer is a texture of those words whatever the format of the light, a texel of `lightWordsOf` of them
 * (`../../gpu/core/lightWords.ts`). A texel `(x, y)` of the layer is the words `(x * words + j, y)` of its texture.
 */

/** The format of the indirect layer's texture, whatever the format of the light. */
export const INDIRECT_FORMAT = 'r32uint'

/** The words of the vector `v` of three words as `n` loads `load(at)` laid at the texel `p`. */
const wordsOf = (words: number, load: (at: string) => string) =>
  `vec3u(${Array.from({ length: 3 }, (_, j) => (j < words ? load(`vec2i(p.x*${words}+${j},p.y)`) : '0u')).join(',')})`

/** The stores of the words `w` of a light at the texel `p` of `tex`. */
const storesOf = (words: number) =>
  Array.from(
    { length: words },
    (_, j) => ` textureStore(tex,vec2i(p.x*${words}+${j},p.y),vec4u(w[${j}],0u,0u,0u));\n`,
  ).join('')

/**
 * The reads and writes of an indirect layer of `words` words a texel (2 or 3: the layer of one word is read and written by the texts of the word format):
 * `indirectRead(tex, p)` and `indirectReadWrite(tex, p)` the light of the texel `p` of a sampled layer and of a layer read and written, `indirectWrite(tex, p, light)` and
 * `indirectWriteInPlace(tex, p, light)` the light stored in a layer written and in one read and written.
 */
export const indirectWordsWgsl = (words: 2 | 3): WgslDecl =>
  wgslBlock(
    `INDIRECT_WORDS_WGSL(${words})`,
    [lightWordsWgsl(words)],
    `fn indirectRead(tex:texture_2d<u32>,p:vec2i)->vec3f{
 return lightFloats(${wordsOf(words, (at) => `textureLoad(tex,${at},0).x`)});
}
fn indirectReadWrite(tex:texture_storage_2d<r32uint,read_write>,p:vec2i)->vec3f{
 return lightFloats(${wordsOf(words, (at) => `textureLoad(tex,${at}).x`)});
}
fn indirectWrite(tex:texture_storage_2d<r32uint,write>,p:vec2i,light:vec3f){
 let w=lightPack(light);
${storesOf(words)}}
fn indirectWriteInPlace(tex:texture_storage_2d<r32uint,read_write>,p:vec2i,light:vec3f){
 let w=lightPack(light);
${storesOf(words)}}`,
  )
