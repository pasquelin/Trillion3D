import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLOAT32_MAX } from '../../../../../math/src/wgsl/constants.ts'
import { casterReachWgsl } from '../../../deformation/halfFloat.ts'

/** The sections of the placements' buffer (`rootWords.ts`), a word a placement each, in the order
 *  they lie: the mobility words, the instances' state per view (`castDiffWgsl.ts`,
 *  `castInstanceState`), the squares of the offsets' distances and the reach of the deformations. */
export const ROOT_SECTION = { word: 0, state: 1, distance: 2, reach: 3 } as const
// The word section lies first: a placement's word is `rootWords[w]`.
export const ROOT_SECTIONS = Object.keys(ROOT_SECTION).length

/**
 * What a program reads of the placements' buffer `rootWords`, which it declares (read, or read and
 * written): the one place that knows its sections. `vsmRootWords(w)` is placement `w`'s words;
 * the defaults for a placement the buffer does not hold are no word, no view bits, no distance and a
 * deformation that reaches as far as anything, so that it caps nothing (`vsmBareReach`).
 * `vsmBareReach` is the reach that grows the bounds of a placement where the offsets do not: the
 * mark's whole reach, held to its deformation's.
 */
export const ROOT_WORDS_WGSL = wgslBlock(
  'ROOT_WORDS_WGSL',
  [FLOAT32_MAX, casterReachWgsl],
  `struct VsmRootWords{word:u32,viewBits:u32,disableSq:f32,deformReach:f32,}
fn vsmRootCount()->u32{return arrayLength(&rootWords)/${ROOT_SECTIONS}u;}
/** Placement \`w\`'s words in a buffer of \`count\` placements (\`vsmRootCount\`). */
fn vsmRootWordsIn(w:u32,count:u32)->VsmRootWords{
 if(w>=count){return VsmRootWords(0u,0u,0.0,FLOAT32_MAX);}
 return VsmRootWords(rootWords[w],rootWords[${ROOT_SECTION.state}u*count+w],bitcast<f32>(rootWords[${ROOT_SECTION.distance}u*count+w]),bitcast<f32>(rootWords[${ROOT_SECTION.reach}u*count+w]));
}
fn vsmRootWords(w:u32)->VsmRootWords{return vsmRootWordsIn(w,vsmRootCount());}
fn vsmBareReach(roots:VsmRootWords,whole:f32)->f32{return min(whole,casterReach(roots.deformReach));}
`,
)
