import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { boxBehindPlane } from '../../../../../math/src/wgsl/geometry.ts'
import { outsidePlanesFn } from './outsidePlanesWgsl.ts'

/** The smallest and the largest scale of a placement's three axes — the lengths of the columns of
 *  its linear part `l`: the level of detail scales an error by the first and a radius by the second
 *  (`placedScale`, `error.ts`), the camera's cut and the shadow views' descent and casters alike. A
 *  length is the root of a square and the root is monotone, so the extremes are taken on the
 *  squares and rooted once (`axisScales`), or the smallest alone (`minAxisScale`). */
export const DAG_AXIS_SCALES_WGSL = wgslBlock(
  'DAG_AXIS_SCALES_WGSL',
  [],
  `fn axisSquares(l:mat3x3f)->vec3f{return vec3f(dot(l[0],l[0]),dot(l[1],l[1]),dot(l[2],l[2]));}
fn axisScales(l:mat3x3f)->vec2f{
 let s=axisSquares(l);
 return vec2f(sqrt(min(s.x,min(s.y,s.z))),sqrt(max(s.x,max(s.y,s.z))));
}
fn minAxisScale(l:mat3x3f)->f32{
 let s=axisSquares(l);
 return sqrt(min(s.x,min(s.y,s.z)));
}
`,
)

/**
 * WHAT A CUT READS OF A PLACEMENT, made where it is read: no block is stored per placement beyond
 * the host's words and its pose (`../worlds/worlds.ts`, `worldPoseWgsl.ts`), so a placement no kept group
 * holds costs nothing, and one the descent visits pays for what it reads.
 *
 * A thread reads one placement at a time — a node's, a page's —, so its pose at the eye is made
 * once for it and kept in the thread (`placed`): the frustum planes brought into its space, one
 * plane at a time as the box test asks (`planeOf`), `view · world` for the screen error, and its
 * axes' smallest and largest scales, which the level of detail reads (`error.ts`). Reading a stored
 * block of these costs more than making them from the 48 bytes of the pose (measured on Dawn,
 * Metal: 0.25 ms read, 0.15 ms made, 2.8 M visits over 250 k placements). Each expression keeps its
 * operands and order. The pose the previous image drew it at, which the main pass's occlusion alone
 * reads (`occlusionWgsl.ts`), is made the same way, apart, at its first read (`placedBefore`).
 */
export const DAG_PRIMITIVE_WGSL = wgslBlock(
  'DAG_PRIMITIVE_WGSL',
  [boxBehindPlane, NO_INDEX, DAG_AXIS_SCALES_WGSL],
  `/** The placement this thread reads, its world at the eye, that world transposed, and its axes'
 *  smallest and largest scales — the lengths of its matrix's three first columns. */
var<private> placedW:u32=NO_INDEX;
var<private> placedPose:mat4x4f;
var<private> placedT:mat4x4f;
var<private> placedScale:vec2f;
/** Placement \`w\`'s pose at the eye, made once for the thread (\`worldPose\`). */
fn placed(w:u32){
 if(placedW==w){return;}
 placedW=w;placedPose=worldPose(w);placedT=transpose(placedPose);
 placedScale=axisScales(mat3x3f(placedPose[0].xyz,placedPose[1].xyz,placedPose[2].xyz));
}
/** \`view · world\` of primitive \`w\`. */
fn viewWorld(w:u32)->mat4x4f{placed(w);return cutView.view*placedPose;}
/** Primitive \`w\`'s world at the eye (\`worldPose\`). */
fn preparedPose(w:u32)->mat4x4f{placed(w);return placedPose;}
/** The placement whose pose before this thread read, and that pose. */
var<private> beforeW:u32=NO_INDEX;
var<private> beforePose:mat4x4f;
/** Primitive \`w\`'s world at the eye as the previous image drew it (\`previousPose\`), made once for
 *  the thread. */
fn placedBefore(w:u32)->mat4x4f{
 if(beforeW!=w){beforeW=w;beforePose=previousPose(w);}
 return beforePose;
}
/** The world plane \`plane\` in placement \`w\`'s space, moved out by its deformation reach; a
 *  primitive no camera culls (\`unculledOf\`) takes a plane no box leaves. */
fn placedPlane(w:u32,plane:vec4f)->vec4f{
 placed(w);
 return select(grownPlane(placedT*plane,reachOf(w)),vec4f(0.0,0.0,0.0,1.0),unculledOf(w));
}
/** Plane \`i\` of the view's frustum in placement \`w\`'s space (\`placedPlane\`). */
fn planeOf(w:u32,i:u32)->vec4f{return placedPlane(w,cutView.planes[i]);}
/** Frustum planes are brought into the primitive's space, so no box is ever transformed. GPU
 *  mirror of \`frustumExcludesBox\` (sdk-core, packages/math/src/geometry/frustum/box.ts): same
 *  corners, same sum. A view with no far plane sends the plane every box passes (\`frustum.ts\`). */
${outsidePlanesFn('outsideFrustum', 'w:u32,', (i) => `planeOf(w,${i})`)}
`,
)
