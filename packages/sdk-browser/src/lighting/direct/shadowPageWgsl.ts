import {
  PAGE_FOOTPRINT_EDGE_BITS,
  PAGE_FOOTPRINT_SHIFT,
  PAGE_FOOTPRINT_STEP,
} from '../../../../sdk-core/src/scene/light-shadow/footprint.ts';

/**
 * Which page of a map a shadow read takes, and whether it may: the one way every pass that
 * lights a surface reads the page table (`directShadowWgsl`), so every one of them — opaque
 * resolve, reflections, blend and water — reads through the same check. Requires `shadows`,
 * `requestShadowPage`, `requestShadowMiss`, `SHADOW_PAGE` and `PAGE_VALID`.
 *
 * A map is `ShadowMap`: its first table entry, whether it is a ring — a sun level, whose pages
 * are addressed by absolute page modulo the window, `(ox, oy)` its origin — or a lamp face mip,
 * clamped at its edge, and its pages per side. Texel coordinates are relative to the map's first
 * page, texel centres at `+0.5`.
 *
 * A page carries the footprint it was drawn for (`footprint.ts`): a read whose texel lies outside
 * it takes the page as not drawn — asked for, never read —, as a page not drawn yet, and says it
 * missed (`requestShadowMiss`): the scheduler draws the page whole (`demandFootprint.ts`).
 */
export const SHADOW_PAGE_WORD_WGSL = `
const PAGE_FOOTPRINT_SHIFT:u32=${PAGE_FOOTPRINT_SHIFT}u;
const PAGE_FOOTPRINT_BITS:u32=${PAGE_FOOTPRINT_EDGE_BITS}u;
const PAGE_FOOTPRINT_EDGE:u32=${2 ** PAGE_FOOTPRINT_EDGE_BITS - 1}u;
const PAGE_FOOTPRINT_STEP:f32=${PAGE_FOOTPRINT_STEP}.0;
/** The word's bits below its footprint: what every reader of a drawn page decodes. */
const PAGE_DRAWN_BITS:u32=${2 ** PAGE_FOOTPRINT_SHIFT - 1}u;
struct ShadowMap{base:u32,ring:u32,pages:i32,ox:i32,oy:i32,}
fn shadowRing(v:i32,n:i32)->i32{return ((v%n)+n)%n;}
/** Whether page-local texel \`l\` lies in the footprint of \`word\`, edges included: its low
 *  edges' steps in from the page's first texel, its high ones' in from its last. A full page
 *  (footprint word zero, every page until one is drawn narrowed) covers every texel undecoded. */
fn shadowFootprintCovers(word:u32,l:vec2f)->bool{
 let f=word>>PAGE_FOOTPRINT_SHIFT;if(f==0u){return true;}
 let b=PAGE_FOOTPRINT_BITS;let m=PAGE_FOOTPRINT_EDGE;
 let low=vec2f(f32(f&m),f32((f>>b)&m))*PAGE_FOOTPRINT_STEP;
 let high=SHADOW_PAGE-vec2f(f32((f>>(2u*b))&m),f32(f>>(3u*b)))*PAGE_FOOTPRINT_STEP;
 return !(any(l<low)||any(l>high));
}
/** Word of page \`p\` of the map — asked for —, or zero when it holds nothing readable at map
 *  texel \`t\`: unmapped, not drawn yet, withdrawn while its depth is wrong, or drawn for a
 *  footprint that misses the page's texel nearest \`t\` — asked for again, never read. */
fn shadowPageWord(m:ShadowMap,p:vec2i,t:vec2f)->u32{
 var e=0;var q=p;
 if(m.ring!=0u){
  if(any(p<vec2i(0))||any(p>=vec2i(m.pages))){return 0u;}
  e=i32(m.base)+shadowRing(p.y+m.oy,m.pages)*m.pages+shadowRing(p.x+m.ox,m.pages);
 }else{
  q=clamp(p,vec2i(0),vec2i(m.pages-1));
  e=i32(m.base)+q.y*m.pages+q.x;
 }
 requestShadowPage(u32(e));
 let word=shadows.table[u32(e)];
 let covered=shadowFootprintCovers(word,clamp(t-vec2f(q)*SHADOW_PAGE,vec2f(0.0),vec2f(SHADOW_PAGE)));
 if(!covered){requestShadowMiss(u32(e));}
 return select(0u,word&PAGE_DRAWN_BITS,(word&PAGE_VALID)!=0u&&covered);
}`;
