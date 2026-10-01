import { SHADOW_DATA_WGSL } from '../../lighting/direct/shadowWgsl.ts';
import {
  PAGE_VALID,
  PAGE_WITHDRAWN,
  SUN_WINDOW,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import type { ShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import { SHADOW_DRAW_LIST_WGSL, shadowPoolWgsl } from './poolWgsl.ts';

/** Invocations of a workgroup of the table words pass. */
export const WORDS_GROUP = 64;
/** Words of the header of the words the host sends: their count, the pool's pages, the frame, and
 *  1 when every page the GPU drew itself is withdrawn (`every`, a list too short for the marks). */
export const WORDS_HEADER = 4;

/** The word the host sends for `entry`: its table's, marked `PAGE_WITHDRAWN` when the plan
 *  withdrew it whoever drew it (`table.withdraw`) and no host draw has landed since. */
export const sentShadowWord = (table: ShadowTable, entry: number) => {
  const word = table.words[entry];
  return word & PAGE_VALID || !table.withdrawn(entry) ? word : (word | PAGE_WITHDRAWN) >>> 0;
};

/**
 * THE HOST'S TABLE WORDS, WHEN THE GPU ALLOCATES (#1275): the words a frame's plan changed — a
 * page drawn (`pool.drew`), withdrawn (`pool.withdraw`) or adopted from a snapshot (`mirror.ts`) —,
 * sent as `(entry, word)` pairs after the frame's pages are drawn and before any is read. The GPU
 * maps, so the host's view of who owns a page may be frames old: a word is kept only for the entry
 * the GPU says owns its page. A draw into a page the GPU has since given another entry wrote that
 * page's depth for the wrong entry: the owner's word loses `PAGE_VALID`. A word that unmaps is not
 * sent: only the GPU unmaps. A word readable says a host draw landed (`DRAWN_HOST`); one mapped
 * and not readable, for a page the GPU drew itself (`DRAWN_GPU`), is the host adopting what it has
 * not drawn yet: the GPU's draw stands — unless the word says `PAGE_WITHDRAWN` (#1345): what the
 * page holds moved in the world, and the GPU's draw loses its depth as a host one does. The mark
 * never enters the table: the word kept is the one without it, and no reader of the table
 * (`shadowPageWgsl.ts`, `allocWgsl.ts`, `freshWgsl.ts`) ever sees it.
 *
 * A word that does not map and says \`PAGE_WITHDRAWN\` is an entry the host has not adopted yet,
 * covered by a mover (\`invalidate.ts\`): a page the GPU drew for it loses its depth (\`withdrawGpuDraw\`).
 * Those marks the host's list cannot hold withdraw every page the GPU drew itself (\`every\`,
 * \`withdrawGpuPages\`), dispatched before the words.
 *
 * A page that loses its depth here — withdrawn by the host, or overwritten for another entry —
 * while this frame asks for it (`POOL_REQUESTED`) joins the frame's draw list (`listDraw`): the GPU
 * draws it in this same frame, before anything reads it, and no read falls in a hole. The pool's
 * constants are the session's window (`referenceMode.ts`), the ordinary constant by default.
 */
export const shadowWordsWgsl = (pages = SUN_WINDOW) => `
${SHADOW_DATA_WGSL}
@group(0) @binding(0) var<storage,read_write> shadows:ShadowData;
@group(0) @binding(1) var<storage,read_write> shadowPool:ShadowPool;
struct ShadowWords{count:u32,pages:u32,frame:i32,every:u32,words:array<vec2u>,}
@group(0) @binding(2) var<storage,read> shadowWords:ShadowWords;
@group(0) @binding(3) var<storage,read_write> drawList:array<u32>;
${shadowPoolWgsl(pages)}
const PAGE_WITHDRAWN:u32=${PAGE_WITHDRAWN}u;
fn shadowPoolPages()->u32{return shadowWords.pages;}
${SHADOW_DRAW_LIST_WGSL}
/** Page \`p\`'s depth is no longer its owner's: drawn again in this frame when the frame asks for
 *  it, listed once — a page already waiting for its draw is listed. */
fn loseDepth(p:u32){
 let by=poolAt(POOL_DRAWNBY,p);
 if(shadowPool.pages[by]==DRAWN_NONE){return;}
 shadowPool.pages[by]=DRAWN_NONE;
 if(shadowPool.pages[poolAt(POOL_REQUESTED,p)]==shadowWords.frame){listDraw(p);}
}
/** Page \`p\`, if the GPU drew it itself: its entry's depth is lost, drawn again this frame when
 *  the frame asks. */
fn withdrawGpuPage(p:u32){
 let e=shadowPool.pages[poolAt(POOL_OWNER,p)];
 if(e<0||shadowPool.pages[poolAt(POOL_DRAWNBY,p)]!=DRAWN_GPU){return;}
 shadows.table[u32(e)]=shadows.table[u32(e)]&(0xffffffffu^PAGE_VALID);
 loseDepth(p);
}
/** An entry the host does not map yet, withdrawn (#831): a mover covered it after the GPU drew
 *  its page itself. */
fn withdrawGpuDraw(e:u32){
 let word=shadows.table[e];let p=word&PAGE_INDEX_MASK;
 if((word&PAGE_MAPPED)!=0u&&shadowPool.pages[poolAt(POOL_OWNER,p)]==i32(e)){withdrawGpuPage(p);}
}
fn applyShadowWord(i:u32){
 let pair=shadowWords.words[i];let e=pair.x;let word=pair.y;
 if((word&PAGE_MAPPED)==0u){withdrawGpuDraw(e);return;}
 let p=word&PAGE_INDEX_MASK;
 let owner=shadowPool.pages[poolAt(POOL_OWNER,p)];
 let by=poolAt(POOL_DRAWNBY,p);
 if(owner==i32(e)){
  let withdrawn=(word&(PAGE_VALID|PAGE_WITHDRAWN))==PAGE_WITHDRAWN;
  if((word&PAGE_VALID)!=0u){shadowPool.pages[by]=DRAWN_HOST;}
  else if(shadowPool.pages[by]==DRAWN_GPU&&!withdrawn){return;}
  else{loseDepth(p);}
  shadows.table[e]=select(word,word^PAGE_WITHDRAWN,withdrawn);return;
 }
 if(owner<0||(word&PAGE_VALID)==0u){return;}
 shadows.table[u32(owner)]=shadows.table[u32(owner)]&(0xffffffffu^PAGE_VALID);
 loseDepth(p);
}
@compute @workgroup_size(${WORDS_GROUP}) fn applyShadowWords(@builtin(global_invocation_id) id:vec3u){
 if(id.x<shadowWords.count){applyShadowWord(id.x);}
}
/** Every page the GPU drew itself withdrawn (\`every\`), in its own dispatch before the words: a
 *  word that lands a host draw on such a page is applied after, never raced (#831). */
@compute @workgroup_size(${WORDS_GROUP}) fn withdrawGpuPages(@builtin(global_invocation_id) id:vec3u){
 if(shadowWords.every!=0u&&id.x<shadowWords.pages){withdrawGpuPage(id.x);}
}`;
