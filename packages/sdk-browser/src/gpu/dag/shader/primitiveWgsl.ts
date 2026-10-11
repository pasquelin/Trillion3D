import { InvT3, invTranspose3Prep } from '../../../../../math/src/wgsl/inverseTranspose.ts'
import { worldMatrix3 } from '../../../../../math/src/wgsl/matrix.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { boxBehindPlane } from '../../../../../math/src/wgsl/geometry.ts'
import { outsidePlanesFn } from './outsidePlanesWgsl.ts'

/**
 * WHAT A CUT READS OF A PLACEMENT, made where it is read: no block is stored per placement beyond
 * the host's words and its pose (`../worlds.ts`, `worldPoseWgsl.ts`), so a placement no kept group
 * holds costs nothing, and one the descent visits pays for what it reads.
 *
 * A thread reads one placement at a time — a node's, a page's —, so its pose at the eye is made
 * once for it and kept in the thread (`placed`): the frustum planes brought into its space, one
 * plane at a time as the box test asks (`planeOf`), `view · world` for the screen error, and its
 * 3x3's normal matrix and conformity for the normal cone. Reading a stored block of these costs
 * more than making them from the 48 bytes of the pose (measured on Dawn, Metal: 0.25 ms read, 0.15
 * ms made, 2.8 M visits over 250 k placements). Each expression keeps its operands and order.
 */
export const DAG_PRIMITIVE_WGSL = wgslBlock(
  'DAG_PRIMITIVE_WGSL',
  [InvT3, worldMatrix3, invTranspose3Prep, boxBehindPlane],
  `/** The placement this thread reads, its world at the eye and that world transposed. */
var<private> placedW:u32=0xffffffffu;
var<private> placedPose:mat4x4f;
var<private> placedT:mat4x4f;
/** Placement \`w\`'s pose at the eye, made once for the thread (\`worldPose\`). */
fn placed(w:u32){if(placedW!=w){placedW=w;placedPose=worldPose(w);placedT=transpose(placedPose);}}
/** \`view · world\` of primitive \`w\` under the current view \`vi\`. */
fn viewWorld(w:u32)->mat4x4f{placed(w);return views[select(0u,AHEAD_VIEW,vi==AHEAD_VIEW)].view*placedPose;}
/** The normal matrix of primitive \`w\`, prepared: \`invTranspose3Apply\` of it is \`inverseTranspose3\`. */
fn normalOf(w:u32)->InvT3{placed(w);return invTranspose3Prep(worldMatrix3(placedPose));}
fn conformalOf(w:u32)->bool{placed(w);return isConformal(worldMatrix3(placedPose));}
/** Primitive \`w\`'s world at the eye (\`worldPose\`). */
fn preparedPose(w:u32)->mat4x4f{placed(w);return placedPose;}
/** Plane \`i\` of view \`v\` in placement \`w\`'s space, moved out by its deformation reach; a
 *  primitive no camera culls (\`unculledOf\`) takes a plane no box leaves. */
fn planeOf(w:u32,v:u32,i:u32)->vec4f{
 placed(w);
 return select(grownPlane(placedT*views[v].planes[i],reachOf(w)),vec4f(0.0,0.0,0.0,1.0),unculledOf(w));
}
/** Frustum planes are brought into the primitive's space, so no box is ever transformed. GPU
 *  mirror of \`frustumExcludesBox\` (sdk-core, packages/math/src/geometry/frustum/box.ts): same
 *  corners, same sum. An infinite far plane is not tested (\`farSkipOf\`): it rejects no box. */
${outsidePlanesFn('outsideFrustum', 'w:u32,', (i) => `planeOf(w,v,${i})`)}
`,
)
