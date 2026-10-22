import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * THE VIEW'S FILTER: the objects a view does not draw (`Camera.hidden`, `Camera.showOnly`,
 * `cutViewFiltering`, `../../../../../sdk-core/src/contracts/viewOptions.ts`) are a bit a placement
 * in a region of `work` the host fills for the view's cut (`../../selection/viewFilter.ts`,
 * `../viewFilterRegion.ts`), set when the view does not draw the placement. A placement's root is
 * tested by it first, before its draw distance, its plane and its frustum (`testRoot`), in every
 * pass but the post pass, which holds only what passed it. A view with no filter has no region to
 * read: `filterBase` is 0, and the test is one branch on the block.
 */
export const DAG_VIEW_FILTER_WGSL = wgslBlock(
  'DAG_VIEW_FILTER_WGSL',
  [],
  `/** Whether the view does not draw placement \`w\`: its bit in the filter region of \`work\`. */
fn filteredOut(w:u32)->bool{
 let base=views[0u].filterBase;
 if(base==0u){return false;}
 return (atomicLoad(&work[base+(w>>5u)])&(1u<<(w&31u)))!=0u;
}
`,
)
