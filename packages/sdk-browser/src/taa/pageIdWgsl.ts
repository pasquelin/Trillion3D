import { FLAG_DYNAMIC, HISTORY_SHARE_MASK, HISTORY_SHARE_SHIFT } from '../visibility/types.ts'
import { visPageIndex } from '../visibility/visWords.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * The test, as WGSL text, that visibility identifier `id` names no page: the background (0), which
 * the temporal passes read as no row, no motion of a placement. Text, not a function: each pass's
 * block keeps to its own declarations.
 */
export const NO_PAGE_ID = `id==0u`

/**
 * Whether a pixel's geometry is dynamic, from the page record its identifier names, read once:
 * changing vertices with no tracked deformation cannot reuse placement motion; and the code of the
 * most of its history its surface keeps (`HISTORY_SHARE_SHIFT`), from the same read. The
 * background (`id` 0) names no row: nothing is read, it is not animated and keeps its whole
 * history (code 0).
 */
export const PAGE_OF_WGSL = wgslBlock(
  'PAGE_OF_WGSL',
  [visPageIndex],
  `
struct TaaPage{animated:f32,share:u32}
fn pageOf(id:u32)->TaaPage{
 if(${NO_PAGE_ID}){return TaaPage(0.0,0u);}
 let page=pages[visPageIndex(id)];
 return TaaPage(select(0.0,1.0,(page.flags&${FLAG_DYNAMIC}u)!=0u&&page.deformOutput==0u),(page.flags>>${HISTORY_SHARE_SHIFT}u)&${HISTORY_SHARE_MASK}u);
}`,
)
