import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ROW_BURST, SELECTION_HEADER_WORDS } from '../readoutWords.ts'

/**
 * SNAPSHOT write: what the GPU reports to the CPU, and the ceiling that bounds it.
 *
 * The snapshot is the only thing a frame brings back down from the GPU. The draw mask stays
 * in place — compute raster reads it where `dagMask` put it —, so what passes here never
 * serves to draw: it serves to BROADCAST. From it the host takes the pages it must load, pin
 * or return to the cache.
 *
 * Each rank is a REQUEST: its page, a whole word, so any packed instance is named, in the
 * snapshot's first list, and its priority at the same rank of the priority list behind the rows'
 * queue (`../request/request.ts`, `priorityWord`), in the order the threads won the counter: the
 * host orders them.
 *
 * The ceiling (`SELECTION_LIST_CAP`, `../layout.ts`) bounds what the frame copy takes, for the
 * cut's life. A refused rank sets bit 0: the snapshot is then TRUNCATED, and adopted by its head
 * (`../../cut/adoption/adoption.ts`). Frame totals lose nothing — they describe the cut, not the
 * list that reports it (`totalsWgsl.ts`).
 */
export const DAG_READING_WGSL = wgslBlock(
  'DAG_READING_WGSL',
  [],
  `/** A request: page \`page\` asked for at priority word \`priority\`, at the rank its thread wins in
 *  the sample's first list, its priority at the same rank of the priority list; past the cap it is
 *  dropped, and the sample says it is truncated. */
fn requestPage(page:u32,priority:u32){
 let slot=atomicAdd(&out.count,1u);
 if(slot>=views[0u].listCap){atomicOr(&out.overflow,1u);return;}
 out.pages[slot]=page;
 out.pages[priorityAt(slot)]=priority;
}
/** Words of the rows' queue behind the difference: its header and its burst (\`rowBurst\`). */
fn rowQueueWords()->u32{return ${SELECTION_HEADER_WORDS}u+min(${ROW_BURST}u,views[0u].listCap);}
/** Rank \`s\` of the priority list, behind the cut's two lists' differences and the rows' queue
 *  (\`priorityWord\`, \`../readoutWords.ts\`, less \`out\`'s header: an index of \`out.pages\`). */
fn priorityAt(s:u32)->u32{return differenceAt(2u*views[0u].listCap+rowQueueWords()+s);}
`,
)
