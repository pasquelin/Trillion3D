import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { DAG_NO_CLIP_PLANE_WGSL } from './clipPlaneWgsl.ts'

/**
 * THE TESTS A VIEWS DESCENT LEAVES TO THE KERNEL THAT FOLLOWS IT: the camera's descent tests an object
 * by the main view's filter, its draw distances, the group above its root, its clip plane and the floor
 * of a leaf (`levelWgsl.ts`); a descent over other views (the shadow maps', the surface cache's cards')
 * keeps every leaf the view's own tests keep, and the kernel that culls the clusters after it makes the
 * tests an object needs, a cluster at a time. Each answers as a cut with no gate does, with the clip
 * plane's (`DAG_NO_CLIP_PLANE_WGSL`).
 */
export const DAG_NO_GATES_WGSL = wgslBlock(
  'DAG_NO_GATES_WGSL',
  [DAG_NO_CLIP_PLANE_WGSL],
  `fn filteredOut(w:u32)->bool{return false;}
fn outsideDrawDistance(w:u32,mark:u32,node:CullNode)->bool{return false;}
fn outsideRootParent(w:u32,mark:u32)->bool{return false;}
fn outsideGroupDrawDistance(t:u32,lo:vec3f,hi:vec3f)->bool{return false;}
fn outsideGroupRootParent(t:u32)->bool{return false;}
fn floorPrunes(open:u32,node:CullNode,e:mat4x4f)->bool{return false;}
fn openOf(w:u32,c:u32,open:u32)->u32{return open;}
`,
)
