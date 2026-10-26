import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PARENT_WORD, ROOT_PARENT_MARK } from '../frameTable.ts'
import {
  PARENT_ERROR,
  PARENT_SPHERE,
  TREE_PARENT_ERROR,
  TREE_PARENT_SPHERE,
} from '../nodeLayout.ts'

/**
 * THE PARENT OF AN INSTANCE OF AN ASSEMBLY: the levels above the instances' roots are the clusters of
 * the assembly's own primitive (`compiler/source/assembly.rs`, `dag/assembly.rs`), each instance's root
 * a child of one of their groups. An instance stands as its own placement — its part's pages, written
 * once —, and names the error and the ball of the group that replaces its root
 * (`DagRoot.rootParent`, in the space of its part): the node of the node table that holds them, its
 * frame word `PARENT_WORD` (`../pack/packParents.ts`, `NODE_PARENT`), shared by every placement that
 * reads the same group.
 *
 * The camera's cut tests a placement with it first of its root's tests (`levelWgsl.ts`, `testRoot`),
 * by its mark word's bit (`ROOT_PARENT_MARK`) before it reads a word: while the group's error shows
 * at the ball's distance — too coarse to draw — the instance opens as any placement; once it does
 * not, nothing of the instance is visited and the group's own clusters, in the assembly's primitive,
 * draw in its stead: the same comparison, on the same ball, as the cut rule's on those clusters
 * (`clusterRule`, `error.ts`), so that once the pages are in one or the other draws. The verdict reads
 * no page residency, as the reference's visit of an instance reads none: while the assembly's own
 * pages stream in, the merged cluster stands in beside the open instances — the reference's streaming
 * leaf does as well —, a transient only an assembly with triangles of its own has. A placement that is
 * no instance of an assembly costs no load.
 *
 * A group of the placement tree holds the world ball its instances' groups are tested at, and the
 * greatest error they name, fitted with its box (`../tree/treeRefitWgsl.ts`; `TREE_PARENT_ERROR`,
 * `TREE_PARENT_SPHERE`): `outsideGroupRootParent` is the same comparison on a ball that holds every
 * member's, at an error none exceeds, so a group it rejects holds no instance that would open — the
 * cut of the placements alone, a far facade's windows costing nothing. A group with a placement
 * that names no parent, and a cell, name none.
 */
export const DAG_ROOT_PARENT_WGSL = wgslBlock(
  'DAG_ROOT_PARENT_WGSL',
  [],
  `/** Whether placement \`w\`, its mark word \`mark\`, is an instance of an assembly whose group above its root
 *  does not show at the threshold: its error, at its ball's edge scale, is under it. None for a placement
 *  whose mark says it is not one. */
fn outsideRootParent(w:u32,mark:u32)->bool{
 if((mark&${ROOT_PARENT_MARK}u)==0u){return false;}
 let record=framesWord(w,${PARENT_WORD}u);
 let sphere=bitcast<vec4f>(nodesNode(record,${PARENT_SPHERE >> 2}u));
 return !errorShows(sphereEdges(sphere,viewWorld(w)).x,bitcast<f32>(nodesWord(record,${PARENT_ERROR}u)));
}
/** Whether node \`t\` of the placement tree, a group, holds no instance of an assembly whose parent
 *  group's error shows: the ball fitted over its placements' (\`TREE_PARENT_SPHERE\`, a world
 *  ball, the eye taken off it) at the greatest error they name (\`TREE_PARENT_ERROR\`) does not
 *  show it. None for a node that names none (an error under zero, or not a number), or in a cut
 *  made in one pass: the placements' own tests cull, as for the distances. */
fn outsideGroupRootParent(t:u32)->bool{
 if((cutView.occlusion&OCCLUSION_TWO_PASS)==0u){return false;}
 let error=bitcast<f32>(treeWord(t,${TREE_PARENT_ERROR}u));
 if(!(error>=0.0)){return false;}
 let centre=bitcast<vec3f>(vec3u(treeWord(t,${TREE_PARENT_SPHERE}u),treeWord(t,${TREE_PARENT_SPHERE + 1}u),treeWord(t,${TREE_PARENT_SPHERE + 2}u)))-cutView.cameraWorld;
 let radius=bitcast<f32>(treeWord(t,${TREE_PARENT_SPHERE + 3}u));
 let edge=edgeScales(transformPoint(cutView.view,centre),radius).x;
 return !(error>0.0&&edge*cutView.pixelError<=viewPixels()*error);
}
`,
)
