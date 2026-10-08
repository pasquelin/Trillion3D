import { LANE_SCAN_WGSL } from '../../core/laneScanWgsl.ts'
import { SELECTION_HEADER_WORDS } from '../layout.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL } from '../../dispatch/grid.ts'
import { bitMask, bitWord, ceilDiv } from '../../../../../math/src/wgsl/integer.ts'

/**
 * Compaction of the drawable-page list, done by the GPU.
 *
 * `dagMask` leaves one flag per page behind `flags[nodeCount + i]`. The CPU reread it whole —
 * a hundred thousand words per snapshot, of which fifteen thousand useful — to extract the
 * increasing list of pages to draw. These two kernels return it already compacted: the snapshot
 * now reports only a count and that many identifiers.
 *
 * Order is that of a serial walk, page by increasing page, not that of an atomic counter: each
 * block of sixty-four pages knows how many of its pages are drawn, the shared lane scan
 * (`../../core/laneScanWgsl.ts`) gives each block its offset, then each page finds its rank in its
 * own block. Sum in u32, associative; a block's offset depends only on the blocks before it. The
 * returned list is therefore term for term the one the CPU built.
 *
 * A block's count is not reread afterwards: `dagMask`, alone in setting a draw flag,
 * accumulates it in its own page's block. No extra dispatch and no flag reread —
 * the sum remains that of the same terms, integer addition being commutative.
 *
 * No new buffer: a stage's ceiling is eight storage buffers, already reached. Block counts, block
 * offsets and draw masks live behind the `work` thresholds, the list behind the wanted pages of
 * `out` — a count, seven padding words, then the ranks — so the snapshot remains one contiguous
 * copy.
 */
export const DAG_COMPACT_WGSL = wgslBlock(
  'DAG_COMPACT_WGSL',
  [LANE_SCAN_WGSL, ceilDiv, bitWord, bitMask, FLAT_INDEX_WGSL],
  `const BLOCK:u32=64u;
const HEAD:u32=${SELECTION_HEADER_WORDS}u;
fn drawFlag(i:u32)->u32{return flagAt(views[0u].queueCap+i);}
fn blockCount()->u32{return ceilDiv(views[0u].clusterCount,BLOCK);}
/** First word of the block zone in \`work\`, after the thresholds and coverage flags. */
fn blockBase()->u32{return 0u;}
/** Two words per block behind the block offsets: bit \`i & 63\` of block \`i / 64\` is page \`i\`'s draw
 *  flag, set by \`dagMask\` with the flag itself, cleared by \`dagPrepare\` with the block count. */
fn drawMaskBase()->u32{return blockCount()*2u;}
/** The mask word that holds page \`i\`'s bit, and that bit. */
fn drawMaskWord(i:u32)->u32{return drawMaskBase()+bitWord(i);}
fn drawBit(i:u32)->u32{return bitMask(i);}
/** The drawn pages of \`mask\`, page \`i\`'s word, below page \`i\`. */
fn drawnBefore(i:u32,mask:u32)->u32{return countOneBits(mask&(drawBit(i)-1u));}
/** Each lane totals its run of blocks; the shared lane scan gives the run its offset. */
@compute @workgroup_size(64)
fn dagDrawPrefix(@builtin(local_invocation_index) lane:u32){
 let count=blockCount();let base=blockBase();
 let run=laneRun(lane,count);
 var total=0u;
 for(var b=run.x;b<run.y;b++){total=total+atomicLoad(&work[base+b]);}
 var cursor=laneScan(lane,total)-total;
 for(var b=run.x;b<run.y;b++){
  let n=atomicLoad(&work[base+b]);
  atomicStore(&work[base+count+b],cursor);
  cursor=cursor+n;
 }
 // The last lane's run ends the list, empty or not: its cursor is the total.
 if(lane==63u){out.pages[views[0u].listCap]=cursor;armList(1u,min(cursor,views[0u].listCap));if(cursor>views[0u].listCap){atomicOr(&out.overflow,1u);}}
}
@compute @workgroup_size(64)
fn dagDrawScatter(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let s=flatIndex(id,n,64u);if(s>=liveCount()){return;}
 // Only live clusters carry a non-zero draw flag; those of the block that are not in the list
 // are zero and add nothing to the rank, exactly as in yesterday's full walk.
 let i=entryIndex(liveAt(s));if(drawFlag(i)==0u){return;}
 // Rank in the block: the drawn pages before \`i\`, read off the block's mask — the sum of the
 // same 0/1 flags, in one or two words instead of up to sixty-three. A page of the block's second
 // half counts the whole first word too.
 let word=drawMaskWord(i);
 var rank=drawnBefore(i,atomicLoad(&work[word]));
 if((i&32u)!=0u){rank=rank+countOneBits(atomicLoad(&work[word-1u]));}
 let off=atomicLoad(&work[blockBase()+blockCount()+i/BLOCK]);
 let at=off+rank;if(at>=views[0u].listCap){atomicOr(&out.overflow,1u);return;}
 out.pages[views[0u].listCap+HEAD+at]=i;
}
`,
)
