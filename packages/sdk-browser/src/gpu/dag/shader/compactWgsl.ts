import { SELECTION_HEADER_WORDS } from '../layout.ts';

/**
 * Compaction of the drawable-page list, done by the GPU.
 *
 * `dagMask` leaves one flag per page behind `flags[nodeCount + i]`. The CPU reread it whole —
 * a hundred thousand words per snapshot, of which fifteen thousand useful — to extract the
 * increasing list of pages to draw. These two kernels return it already compacted: the snapshot
 * now reports only a count and that many identifiers.
 *
 * Order is that of the old walk, page by increasing page, not that of an atomic counter: each
 * block of sixty-four pages knows how many of its pages are drawn, a two-pass sweep gives each
 * block its offset, then each page finds its rank in its own block. Sum in u32, associative;
 * a block's offset depends only on the blocks before it. The returned list is therefore term
 * for term the one the CPU built.
 *
 * A block's count is no longer reread afterwards: `dagMask`, alone in setting a draw flag,
 * accumulates it in its own page's block. One fewer dispatch, and two million fewer flags
 * reread — the sum remains that of the same terms, integer addition being commutative.
 *
 * No new buffer: a stage's ceiling is eight storage buffers, already reached. Block counts, block
 * offsets and draw masks live behind the `work` thresholds, the list behind the wanted pages of
 * `out` — a count, seven padding words, then the ranks — so the snapshot remains one contiguous
 * copy.
 */
export const DAG_COMPACT_WGSL = `const BLOCK:u32=64u;
const HEAD:u32=${SELECTION_HEADER_WORDS}u;
fn drawFlag(i:u32)->u32{return flags[views[0u].queueCap+i];}
fn blockCount()->u32{return (views[0u].clusterCount+BLOCK-1u)/BLOCK;}
/** First word of the block zone in \`work\`, after the thresholds and coverage flags. */
fn blockBase()->u32{return 0u;}
/** Two words per block behind the block offsets: bit \`i & 31\` of word \`i >> 5\` is page \`i\`'s draw
 *  flag, set by \`dagMask\` with the flag itself, cleared by \`dagPrepare\` with the block count. */
fn drawMaskBase()->u32{return blockCount()*2u;}
/** The mask word that holds page \`i\`'s bit, and that bit. */
fn drawMaskWord(i:u32)->u32{return drawMaskBase()+(i>>5u);}
fn drawBit(i:u32)->u32{return 1u<<(i&31u);}
/** The drawn pages of \`mask\`, page \`i\`'s word, below page \`i\`. */
fn drawnBefore(i:u32,mask:u32)->u32{return countOneBits(mask&(drawBit(i)-1u));}
var<workgroup> laneTotals:array<u32,64>;
@compute @workgroup_size(64)
fn dagDrawPrefix(@builtin(local_invocation_id) lid:vec3u){
 let lane=lid.x;let count=blockCount();let base=blockBase();
 let chunk=(count+63u)/64u;
 let begin=min(lane*chunk,count);let end=min(begin+chunk,count);
 var total=0u;
 for(var b=begin;b<end;b++){total=total+atomicLoad(&work[base+b]);}
 laneTotals[lane]=total;
 workgroupBarrier();
 var cursor=0u;
 for(var l=0u;l<lane;l++){cursor=cursor+laneTotals[l];}
 for(var b=begin;b<end;b++){
  let n=atomicLoad(&work[base+b]);
  atomicStore(&work[base+count+b],cursor);
  cursor=cursor+n;
 }
 // The last thread has summed every total again, empty slice or not: that is the total.
 if(lane==63u){out.pages[views[0u].listCap]=cursor;if(cursor>views[0u].listCap){atomicOr(&out.overflow,1u);}}
}
@compute @workgroup_size(64)
fn dagDrawScatter(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()){return;}
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
`;
