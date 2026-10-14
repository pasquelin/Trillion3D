import { FLAG_DYNAMIC } from '../visibility/types.ts'
import { VIS_CARD_BASE, visPageIndex } from '../visibility/visWords.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * The test, as WGSL text, that visibility identifier `id` names no page: the background (0) or a
 * card's pixel (`VIS_CARD_BASE | slot`, `visibility/visWords.ts`). The temporal passes read both as
 * they read the background — no row, no motion of a placement —, as they read a card before it was
 * tagged. Text, not a function: each pass's block keeps to its own declarations.
 */
export const NO_PAGE_ID = `id==0u||id>=${VIS_CARD_BASE}u`

/**
 * What a pixel takes of the page record its identifier names, which it reads once: the identity
 * the geometry history keeps it by — its placement plus one, none for the background — and whether
 * its geometry is dynamic: changing vertices with no tracked deformation cannot reuse placement
 * motion. The background (`id` 0) names no row: nothing is read, and it is neither.
 */
export const PAGE_OF_WGSL = wgslBlock(
  'PAGE_OF_WGSL',
  [visPageIndex],
  `
struct TaaPage{identity:u32,animated:f32}
fn pageOf(id:u32)->TaaPage{
 if(${NO_PAGE_ID}){return TaaPage(0u,0.0);}
 let page=pages[visPageIndex(id)];
 return TaaPage(page.placement+1u,select(0.0,1.0,(page.flags&${FLAG_DYNAMIC}u)!=0u&&page.deformOutput==0u));
}`,
)
