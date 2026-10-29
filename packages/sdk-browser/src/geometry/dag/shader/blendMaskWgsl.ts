import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bitWord } from '../../../../../math/src/wgsl/integer.ts'
import { DRAW_MASK_ACCESS_WGSL } from './drawMaskWgsl.ts'
import { BLOCK_MASK_WORDS_WGSL } from './floorWgsl.ts'

/**
 * THE MASKS OF THE BLENDED CLUSTERS THE CUT DRAWS, a bit a page, the one list the blended pass reads
 * of the cut (`../../../blend/transparent/compactPasses.ts`, which binds `work` at
 * `GpuSelection.maskOffset`): a blended cluster is drawn by the blend pass in source order, never by
 * the visibility rasters, so it has no place in the list of visible clusters' rasters (it takes
 * one, tagged `VIS_TAG_BLENDED`, only so that the drawn list and the totals count it). The frame's
 * mask holds the clusters of both passes, the post pass's the clusters it alone draws.
 *
 * The masks open `work` (`dagWorkLayout`): a block of `WORKGROUP_THREADS` pages takes
 * `BLOCK_MASK_WORDS` words of each, cleared by `dagPrepare` with the rest of the frame.
 */
export const DAG_BLEND_MASK_WGSL = wgslBlock(
  'DAG_BLEND_MASK_WGSL',
  [bitWord, DRAW_MASK_ACCESS_WGSL, BLOCK_MASK_WORDS_WGSL],
  `/** The frame's mask: the first word of \`work\`. The post pass's follows it. */
fn drawMaskBase()->u32{return 0u;}
fn postMaskBase()->u32{return blockCount()*BLOCK_MASK_WORDS;}
/** The first word behind both masks, where the frame counters start (\`listsWgsl.ts\`). */
fn counterBase()->u32{return postMaskBase()+blockCount()*BLOCK_MASK_WORDS;}
/** The mask word that holds page \`i\`'s bit, and that bit. */
fn postMaskWord(i:u32)->u32{return postMaskBase()+bitWord(i);}
/** Page \`i\` is a blended cluster the running pass draws: set in the frame's mask, and in the post
 *  pass's when the running pass is the post pass. */
fn markBlended(i:u32){
 atomicOr(&work[drawMaskWord(i)],drawBit(i));
 if(cutPass()==CUT_POST){atomicOr(&work[postMaskWord(i)],drawBit(i));}
}
`,
)
