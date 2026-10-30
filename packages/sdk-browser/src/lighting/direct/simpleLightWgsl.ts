import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SIMPLE_WORD } from '../../../../sdk-core/src/scene/light/fields.ts'

/**
 * What a program reads of a simple light's word (`LIGHT_FIELD.simpleWord`, `SIMPLE_WORD`): the simple lights follow the scene's lights in rank (`directLights.count` is the rank of the first), a
 * scene light's word is 0. Which pass lights the light (`sampledTakes`: the sampled lighting, or the classic pass alone), whether the sampled lighting traces a shadow ray for it, whether the translucency
 * lighting volume takes it. The rank a light had in the image before, by which the sampling reads its history, is not here: it is per view (`../manyLightsSampled/previousRanks.ts`).
 */
export const SIMPLE_LIGHT_WGSL = wgslBlock(
  'SIMPLE_LIGHT_WGSL',
  [],
  `const SIMPLE_CLASSIC:u32=${SIMPLE_WORD.classic}u;
const SIMPLE_SAMPLED_SHADOW:u32=${SIMPLE_WORD.sampledShadow}u;
const SIMPLE_TRANSLUCENCY:u32=${SIMPLE_WORD.translucency}u;
fn simpleWordOf(rank:u32)->u32{
 if(rank<directLights.count){return 0u;}
 return u32(directLights.items[rank].traits.w);
}
/** Whether the sampled lighting takes light rank: every light of the scene, and the simple lights the setting sampledSimpleLights hands it; the others are the classic pass's. */
fn sampledTakes(rank:u32)->bool{return (simpleWordOf(rank)&SIMPLE_CLASSIC)==0u;}
/** Whether the sampled lighting traces a shadow ray for the simple light rank, which holds no shadow map. */
fn simpleCastsSampled(rank:u32)->bool{return (simpleWordOf(rank)&SIMPLE_SAMPLED_SHADOW)!=0u;}
/** Whether the translucency lighting volume takes light rank: every light of the scene, and the simple lights whose entry says so. */
fn simpleInjected(rank:u32)->bool{return rank<directLights.count||(simpleWordOf(rank)&SIMPLE_TRANSLUCENCY)!=0u;}
`,
)
