import { SHADOW_DATA_WGSL } from '../../lighting/direct/shadowWgsl.ts';
import { POOL_COUNTS, SHADOW_POOL_WGSL } from './poolWgsl.ts';

/** Invocations of a workgroup of the table words pass. */
export const WORDS_GROUP = 64;
/** Words of the header of the words the host sends: their count, the pool's pages, two free. */
export const WORDS_HEADER = 4;

/**
 * THE HOST'S TABLE WORDS, WHEN THE GPU ALLOCATES (#1275): the words a frame's plan changed — a
 * page drawn (`pool.drew`), withdrawn (`pool.withdraw`) or adopted from a snapshot (`mirror.ts`) —,
 * sent as `(entry, word)` pairs after the frame's pages are drawn and before any is read. The GPU
 * maps, so the host's view of who owns a page may be frames old: a word is kept only for the entry
 * the GPU says owns its page. A draw into a page the GPU has since given another entry wrote that
 * page's depth for the wrong entry: the owner's word loses `PAGE_VALID` — read no more, it is
 * drawn again by the GPU's next draw list, or once the host knows it. A word that unmaps is not
 * sent: only the GPU unmaps. A word readable says a host draw landed (`DRAWN_HOST`); one mapped
 * and not readable, for a page the GPU drew itself (`DRAWN_GPU`), is the host adopting what it has
 * not drawn yet: the GPU's draw stands.
 */
export const SHADOW_WORDS_WGSL = `
${SHADOW_DATA_WGSL}
@group(0) @binding(0) var<storage,read_write> shadows:ShadowData;
struct ShadowPoolWords{counts:array<u32,${POOL_COUNTS.length}>,pages:array<i32>,}
@group(0) @binding(1) var<storage,read_write> shadowPool:ShadowPoolWords;
struct ShadowWords{count:u32,pages:u32,pad0:u32,pad1:u32,words:array<vec2u>,}
@group(0) @binding(2) var<storage,read> shadowWords:ShadowWords;
${SHADOW_POOL_WGSL}
fn applyShadowWord(i:u32){
 let pair=shadowWords.words[i];let e=pair.x;let word=pair.y;
 if((word&PAGE_MAPPED)==0u){return;}
 let p=word&PAGE_INDEX_MASK;
 let owner=shadowPool.pages[POOL_OWNER*shadowWords.pages+p];
 let by=POOL_DRAWNBY*shadowWords.pages+p;
 if(owner==i32(e)){
  if((word&PAGE_VALID)!=0u){shadowPool.pages[by]=DRAWN_HOST;}
  else if(shadowPool.pages[by]==DRAWN_GPU){return;}
  shadows.table[e]=word;return;
 }
 if(owner<0||(word&PAGE_VALID)==0u){return;}
 shadows.table[u32(owner)]=shadows.table[u32(owner)]&(0xffffffffu^PAGE_VALID);
 shadowPool.pages[by]=DRAWN_NONE;
}
@compute @workgroup_size(${WORDS_GROUP}) fn applyShadowWords(@builtin(global_invocation_id) id:vec3u){
 if(id.x<shadowWords.count){applyShadowWord(id.x);}
}`;
