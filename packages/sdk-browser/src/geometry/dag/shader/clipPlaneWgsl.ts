import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { boxBehindPlane } from '../../../../../math/src/wgsl/geometry.ts'
import { NODE_KIND } from '../nodeLayout.ts'

/**
 * THE VIEW'S CLIP PLANE: a view that has one (`Camera.clipPlane`, with the project switch
 * `cutClipPlane` on, `../../../../../sdk-core/src/contracts/viewOptions.ts`) draws only the side
 * its normal points to, and the cut culls, at every level, what lies wholly behind it: the objects
 * whose root box does (`outsideClipPlane`, `testRoot`), the groups of the placement tree
 * (`outsideGroupClipPlane`, `testCell`), the nodes (`testNode`) and the clusters (`dagWanted`).
 * What straddles the plane is kept: the raster cuts it.
 *
 * The plane is in the render frame, `dot(xyz, p) + w` at least 0 drawn, as the frustum's planes
 * are (`views[0u].clipPlane`); a box is tested in the space of its placement, the plane brought
 * into it as a frustum plane is (`placedPlane`, `primitiveWgsl.ts`), so the scale of the placement
 * enters once, in the plane. The cut holds none of it without the project switch
 * (`DAG_NO_CLIP_PLANE_WGSL`); with it, a view that has no plane — all zero, or the host turned the
 * cull off (`CULL_CLIP_PLANE_OFF`, `cutClipPlaneCulling`) — is one branch on the block.
 *
 * Where it is tested, and not: a placement's root in every pass but the post pass (what the post
 * pass holds passed it in the main pass), a group of the placement tree in the main pass of a cut in
 * two passes alone — a cell above the groups, and a cut in one pass, test none —, a node and a
 * cluster wherever the cut tests them. A placement no camera culls (`unculledOf`) is never culled,
 * as it is by the frustum: its box bounds none of what it draws.
 */
export const DAG_CLIP_PLANE_WGSL = wgslBlock(
  'DAG_CLIP_PLANE_WGSL',
  [boxBehindPlane],
  `/** Whether the view has a plane the cut tests: the host left the cull on, and the plane is none
 *  when its normal is zero. */
fn clipPlaneOn()->bool{
 if(cullOff(CULL_CLIP_PLANE_OFF)){return false;}
 return any(views[0u].clipPlane.xyz!=vec3f(0.0));
}
/** Whether the box \`lo\`–\`hi\` of placement \`w\`, in its space, lies wholly behind the plane. */
fn outsideClipPlane(w:u32,lo:vec3f,hi:vec3f)->bool{
 return clipPlaneOn()&&boxBehindPlane(placedPlane(w,views[0u].clipPlane),lo,hi);
}
/** Whether node \`t\` of the placement tree, a group, its world box \`lo\`–\`hi\` in the render frame,
 *  lies wholly behind the plane: the main pass of a cut in two passes alone. */
fn outsideGroupClipPlane(t:u32,lo:vec3f,hi:vec3f)->bool{
 if(!clipPlaneOn()||(views[0u].occlusion&OCCLUSION_TWO_PASS)==0u){return false;}
 if(treeWord(t,${NODE_KIND}u)!=TREE_GROUP){return false;}
 return boxBehindPlane(views[0u].clipPlane,lo,hi);
}
`,
)

/** What the cut answers in a module made without the project switch: no plane, nothing behind it. A
 *  program lists this or `DAG_CLIP_PLANE_WGSL`, never both (`dagSelectionShader`). */
export const DAG_NO_CLIP_PLANE_WGSL = wgslBlock(
  'DAG_NO_CLIP_PLANE_WGSL',
  [],
  `fn outsideClipPlane(w:u32,lo:vec3f,hi:vec3f)->bool{return false;}
fn outsideGroupClipPlane(t:u32,lo:vec3f,hi:vec3f)->bool{return false;}
`,
)
