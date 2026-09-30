/**
 * Which page of a map a shadow read takes, and whether it may: the one way every pass that
 * lights a surface reads the page table (`directShadowWgsl`), so every one of them — opaque
 * resolve, reflections, blend and water — reads through the same check. Requires `shadows`,
 * `requestShadowPage`, `PAGE_VALID` and the page model (`PAGE_MODEL_WGSL`).
 *
 * A map is `ShadowMap`: its first table entry, whether it is a ring — a sun level, whose pages
 * are addressed by absolute page modulo the window, `(ox, oy)` its origin — or a lamp face mip,
 * clamped at its edge, and its pages per side. Texel coordinates are relative to the map's first
 * page, texel centres at `+0.5`.
 */
export const SHADOW_PAGE_WORD_WGSL = `
struct ShadowMap{base:u32,ring:u32,pages:i32,ox:i32,oy:i32,}
/** Table entry of page \`p\` of the map, or -1 outside a ring's window: a lamp face mip clamps
 *  \`p\` at its edge. What the shading reads and the demand pass marks alike. */
fn shadowPageEntry(m:ShadowMap,p:vec2i)->i32{
 if(m.ring!=0u){
  if(any(p<vec2i(0))||any(p>=vec2i(m.pages))){return -1;}
  return i32(m.base)+shadowRingPageEntry(m.pages,p.x+m.ox,p.y+m.oy);
 }
 let q=clamp(p,vec2i(0),vec2i(m.pages-1));
 return i32(m.base)+shadowFacePageEntry(m.pages,q.x,q.y);
}
/** Word of page \`p\` of the map — asked for —, or zero when it holds nothing readable: unmapped,
 *  not drawn yet, or withdrawn while its depth is wrong — asked for again, never read. */
fn shadowPageWord(m:ShadowMap,p:vec2i)->u32{
 let e=shadowPageEntry(m,p);
 if(e<0){return 0u;}
 requestShadowPage(u32(e));
 let word=shadows.table[u32(e)];
 return select(0u,word,(word&PAGE_VALID)!=0u);
}`;
