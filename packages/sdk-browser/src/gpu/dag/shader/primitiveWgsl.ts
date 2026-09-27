import { PRIMITIVE_VEC4 } from '../types.ts';

/**
 * What a camera cut derives once per primitive and frame, not once per node or page it visits.
 *
 * `dagPrepare` already brings the frustum planes into each primitive's space (`shader.ts`). Behind
 * the first row of slots of `frames`, it now also leaves, for each primitive of a camera cut:
 * - `view · world`, the matrix every screen error projects through (`projected`), for the camera
 *   and for the view ahead — a 4x4 product each node of the descent and each page used to redo;
 * - the normal matrix of the world's 3x3, prepared as `invTranspose3Prep` prepares it, and whether
 *   the 3x3 is conformal (`isConformal`), the two things the normal cone reads of the primitive;
 * - the view ahead's six planes in the primitive's space (`aheadWgsl.ts`), as the camera's own.
 * Each is the same expression on the same operands as the site that read it, so each verdict is
 * the one before. A light cut keeps computing them where it reads them: its frames hold one row
 * per view and nothing more (`../lightCut.ts`), its views have no cone and no view ahead.
 */
export const DAG_PRIMITIVE_WGSL = `const PRIMITIVE:u32=${PRIMITIVE_VEC4}u;
/** Offsets inside a primitive's values: the two \`view · world\`, the normal matrix, the planes ahead. */
const CAMERA_E:u32=0u;const AHEAD_E:u32=4u;const NORMAL:u32=8u;const AHEAD_PLANES:u32=11u;
/** First vec4 of primitive \`w\`'s values, behind the camera's row of slots. Camera cut only. */
fn primitiveBase(w:u32)->u32{return views[0u].worldCount*FRAME+w*PRIMITIVE;}
fn putMatrix(at:u32,m:mat4x4f){frames[at]=m[0];frames[at+1u]=m[1];frames[at+2u]=m[2];frames[at+3u]=m[3];}
/** \`view · world\` of primitive \`w\` under the current view \`vi\`. */
fn viewWorld(w:u32)->mat4x4f{
 if(isLightCut()){return views[vi].view*worlds[w];}
 let at=primitiveBase(w)+select(CAMERA_E,AHEAD_E,vi==AHEAD_VIEW);
 return mat4x4f(frames[at],frames[at+1u],frames[at+2u],frames[at+3u]);
}
/** The prepared normal matrix of primitive \`w\`: \`invTranspose3Apply\` of it is \`inverseTranspose3\`. */
fn normalOf(w:u32)->InvT3{
 let at=primitiveBase(w)+NORMAL;let a=frames[at];let b=frames[at+1u];let c=frames[at+2u];
 return InvT3(mat3x3f(a.xyz,b.xyz,c.xyz),a.w,b.w!=0.0);
}
fn conformalOf(w:u32)->bool{return frames[primitiveBase(w)+NORMAL+2u].w!=0.0;}
/** First of the view ahead's six planes in primitive \`w\`'s space. */
fn aheadPlanes(w:u32)->u32{return primitiveBase(w)+AHEAD_PLANES;}
/** \`dagPrepare\`'s share for primitive \`w\` of a camera cut, on its transposed world \`t\`. A
 *  primitive no camera culls (\`open\`) takes six planes ahead no box leaves, as its own. */
fn preparePrimitive(w:u32,t:mat4x4f,open:bool){
 let at=primitiveBase(w);let world=worlds[w];
 putMatrix(at+CAMERA_E,views[0u].view*world);
 let m=mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz);let n=invTranspose3Prep(m);
 frames[at+NORMAL]=vec4f(n.adj[0],n.scale);
 frames[at+NORMAL+1u]=vec4f(n.adj[1],select(0.0,1.0,n.regular));
 frames[at+NORMAL+2u]=vec4f(n.adj[2],select(0.0,1.0,isConformal(m)));
 if(!aheadOn()){return;}
 putMatrix(at+AHEAD_E,views[AHEAD_VIEW].view*world);
 putPlanes(at+AHEAD_PLANES,t,AHEAD_VIEW,open);
}
`;
