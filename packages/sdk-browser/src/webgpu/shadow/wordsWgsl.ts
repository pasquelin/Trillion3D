import { SHADOW_DATA_WGSL } from '../../lighting/direct/shadowWgsl.ts';
import { SHADOW_DRAW_LIST_WGSL, SHADOW_POOL_WGSL } from './poolWgsl.ts';

/** Invocations of a workgroup of the table words pass. */
export const WORDS_GROUP = 64;
/** Words of the header of the words the host sends: their count, the pool's pages, the frame, one
 *  free. */
export const WORDS_HEADER = 4;

/**
 * THE HOST'S TABLE WORDS, WHEN THE GPU ALLOCATES (#1275): the words a frame's plan changed — a
 * page drawn (`pool.drew`), withdrawn (`pool.withdraw`) or adopted from a snapshot (`mirror.ts`) —,
 * sent as `(entry, word)` pairs after the frame's pages are drawn and before any is read. The GPU
 * maps, so the host's view of who owns a page may be frames old: a word is kept only for the entry
 * the GPU says owns its page. A draw into a page the GPU has since given another entry wrote that
 * page's depth for the wrong entry: the owner's word loses `PAGE_VALID`. A word that unmaps is not
 * sent: only the GPU unmaps. A word readable says a host draw landed (`DRAWN_HOST`); one mapped
 * and not readable, for a page the GPU drew itself (`DRAWN_GPU`), is the host adopting what it has
 * not drawn yet: the GPU's draw stands.
 *
 * A page that loses its depth here — withdrawn by the host, or overwritten for another entry —
 * while this frame asks for it (`POOL_REQUESTED`) joins the frame's draw list (`listDraw`): the GPU
 * draws it in this same frame, before anything reads it, and no read falls in a hole.
 */
export const SHADOW_WORDS_WGSL = `
${SHADOW_DATA_WGSL}
@group(0) @binding(0) var<storage,read_write> shadows:ShadowData;
@group(0) @binding(1) var<storage,read_write> shadowPool:ShadowPool;
struct ShadowWords{count:u32,pages:u32,frame:i32,pad0:u32,words:array<vec2u>,}
@group(0) @binding(2) var<storage,read> shadowWords:ShadowWords;
@group(0) @binding(3) var<storage,read_write> drawList:array<u32>;
${SHADOW_POOL_WGSL}
${SHADOW_DRAW_LIST_WGSL}
/** Page \`p\`'s depth is no longer its owner's: drawn again in this frame when the frame asks for
 *  it, listed once — a page already waiting for its draw is listed. */
fn loseDepth(p:u32){
 let by=POOL_DRAWNBY*shadowWords.pages+p;
 if(shadowPool.pages[by]==DRAWN_NONE){return;}
 shadowPool.pages[by]=DRAWN_NONE;
 if(shadowPool.pages[POOL_REQUESTED*shadowWords.pages+p]==shadowWords.frame){listDraw(p);}
}
fn applyShadowWord(i:u32){
 let pair=shadowWords.words[i];let e=pair.x;let word=pair.y;
 if((word&PAGE_MAPPED)==0u){return;}
 let p=word&PAGE_INDEX_MASK;
 let owner=shadowPool.pages[POOL_OWNER*shadowWords.pages+p];
 let by=POOL_DRAWNBY*shadowWords.pages+p;
 if(owner==i32(e)){
  if((word&PAGE_VALID)!=0u){shadowPool.pages[by]=DRAWN_HOST;}
  else if(shadowPool.pages[by]==DRAWN_GPU){return;}
  else{loseDepth(p);}
  shadows.table[e]=word;return;
 }
 if(owner<0||(word&PAGE_VALID)==0u){return;}
 shadows.table[u32(owner)]=shadows.table[u32(owner)]&(0xffffffffu^PAGE_VALID);
 loseDepth(p);
}
@compute @workgroup_size(${WORDS_GROUP}) fn applyShadowWords(@builtin(global_invocation_id) id:vec3u){
 if(id.x<shadowWords.count){applyShadowWord(id.x);}
}`;
