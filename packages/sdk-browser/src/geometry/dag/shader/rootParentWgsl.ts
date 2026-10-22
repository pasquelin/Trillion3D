import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ROOT_PARENT_MARK, ROOT_PARENT_WORD } from '../frameTable.ts'

/**
 * THE PARENT OF AN INSTANCE OF AN ASSEMBLY: the levels above the instances' roots are the clusters of
 * the assembly's own primitive (`compiler/source/assembly.rs`, `dag/assembly.rs`), each instance's root
 * a child of one of their groups. An instance stands as its own placement — its part's pages, written
 * once —, and carries the error and the ball of the group that replaces its root
 * (`DagRoot.rootParent`, its five frame words from `ROOT_PARENT_WORD`, in the space of its part).
 *
 * The camera's cut tests a placement with it first of its root's tests (`levelWgsl.ts`, `testRoot`),
 * by its mark word's bit (`ROOT_PARENT_MARK`) before it reads a word: while the group's error shows
 * at the ball's distance — too coarse to draw — the instance opens as any placement; once it does
 * not, nothing of the instance is visited and the group's own clusters, in the assembly's primitive,
 * draw in its stead: the same comparison, on the same ball, as the cut rule's on those clusters
 * (`clusterRule`, `error.ts`), so that one or the other draws, never both nor neither. A placement
 * that is no instance of an assembly costs no load.
 */
export const DAG_ROOT_PARENT_WGSL = wgslBlock(
  'DAG_ROOT_PARENT_WGSL',
  [],
  `/** Whether placement \`w\`, its mark word \`mark\`, is an instance of an assembly whose group above its root
 *  does not show at the threshold: its error, at its ball's edge scale, is under it. None for a placement
 *  whose mark says it is not one. */
fn outsideRootParent(w:u32,mark:u32)->bool{
 if((mark&${ROOT_PARENT_MARK}u)==0u){return false;}
 let sphere=vec4f(bitcast<f32>(framesWord(w,${ROOT_PARENT_WORD + 1}u)),bitcast<f32>(framesWord(w,${ROOT_PARENT_WORD + 2}u)),bitcast<f32>(framesWord(w,${ROOT_PARENT_WORD + 3}u)),bitcast<f32>(framesWord(w,${ROOT_PARENT_WORD + 4}u)));
 return !errorShows(sphereEdges(sphere,viewWorld(w)).x,bitcast<f32>(framesWord(w,${ROOT_PARENT_WORD}u)));
}
`,
)
