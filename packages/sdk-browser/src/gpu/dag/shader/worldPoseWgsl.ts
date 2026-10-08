import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { TO_F32_WGSL } from '../../../placement/f32Wgsl.ts'

/**
 * A primitive's world pose at the cut's eye, and its frustum planes' first vec4 in `frames`, per
 * view slot. The matrices hold the linear part; the translation is read where the cut reads it:
 * the exact one behind the range's matrices — three doubles (`../worldOrigins.ts`) — less the
 * eye's (`eye`, the view's `cameraWorld` in doubles), in double, then rounded once to single
 * precision: the bits the host's `Math.fround(t - eye)` writes (`worldToRenderOrigin`). No pass
 * brings every placement to a moving eye: the work follows the placements a cut reads.
 */
export const DAG_WORLD_POSE_WGSL = wgslBlock(
  'DAG_WORLD_POSE_WGSL',
  [TO_F32_WGSL],
  `
/** One coordinate of a translation at the eye: the exact double \`t\` less the eye's \`e\`, as a
 *  single-precision word. */
fn atEye(t:vec2u,e:vec2u)->u32{return toF32(dSub(t,e));}
fn worldPose(w:u32)->mat4x4f{
 let row=rowOf(w);let at=row*4u;let o=rangeCount()*4u+row*2u;
 let a=bitcast<vec4u>(worlds[o]);let b=bitcast<vec4u>(worlds[o+1u]);
 let e0=views[0u].eye[0];let e1=views[0u].eye[1];
 let t=vec3f(bitcast<f32>(atEye(a.xy,e0.xy)),bitcast<f32>(atEye(a.zw,e0.zw)),bitcast<f32>(atEye(b.xy,e1.xy)));
 return mat4x4f(worlds[at],worlds[at+1u],worlds[at+2u],vec4f(t,worlds[at+3u].w));
}
fn planesOf(w:u32)->u32{return slotOf(w)*FRAME;}
`,
)
