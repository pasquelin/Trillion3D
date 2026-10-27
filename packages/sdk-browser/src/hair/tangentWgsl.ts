import {
  HAIR_STRANDS_CONTROL_POINT_END,
  HAIR_STRANDS_CONTROL_POINT_INSIDE,
  HAIR_STRANDS_CONTROL_POINT_START,
} from '../../../sdk-core/src/contracts/hairStrandsAbi.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { frameAround } from '../../../math/src/wgsl/basis.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'

/**
 * THE TANGENTS OF A GROUP OF STRANDS: for each point, the direction its strand runs through it and
 * a second axis across it, two normals of four signed bytes. A point's direction is the normalized
 * sum of the unit vectors from the point before to it and from it to the point after, each counted
 * only when the neighbour is on the same strand (a strand's first point has none before it, its last
 * none after); the second axis is the first row of the orthonormal frame built about that
 * direction (`frameAround`: Duff et al., "Building an Orthonormal Basis, Revisited"). The groom is
 * at rest, so they are written once, at load.
 */
export const TANGENT_WGSL = wgslProgram(
  `@group(0) @binding(0) var<storage,read> points:array<vec2u>;
@group(0) @binding(1) var<storage,read_write> tangents:array<u32>;
const POINT_INSIDE=${HAIR_STRANDS_CONTROL_POINT_INSIDE}u;
const POINT_START=${HAIR_STRANDS_CONTROL_POINT_START}u;
const POINT_END=${HAIR_STRANDS_CONTROL_POINT_END}u;
struct ControlPoint{position:vec3f,kind:u32}
// A point: three half floats (x, y in the first word, z in the low half of the second), its kind in
// the top two bits of the second.
fn controlPoint(i:u32)->ControlPoint{
 let word=points[i];
 return ControlPoint(vec3f(unpack2x16float(word.x),unpack2x16float(word.y).x),word.y>>30u);
}
fn packNormal(v:vec3f)->u32{return pack4x8snorm(vec4f(clamp(v,vec3f(-1.0),vec3f(1.0)),1.0));}
@compute @workgroup_size(WORKGROUP_THREADS) fn hairTangents(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let count=arrayLength(&points);
 let at=flatIndex(id,groups,WORKGROUP_THREADS);
 if(at>=count){return;}
 let here=controlPoint(at);
 var before=vec3f(0.0);
 if(at>0u){
  let other=controlPoint(at-1u);
  if(other.kind==POINT_INSIDE||other.kind==POINT_START){before=normalize(here.position-other.position);}
 }
 var after=vec3f(0.0);
 if(at+1u<count){
  let other=controlPoint(at+1u);
  if(other.kind==POINT_INSIDE||other.kind==POINT_END){after=normalize(other.position-here.position);}
 }
 let frame=frameAround(normalize(before+after));
 tangents[at*2u]=packNormal(frame.x);
 tangents[at*2u+1u]=packNormal(frame.z);
}`,
  [frameAround, WORKGROUP_THREADS_WGSL, FLAT_INDEX_WGSL],
)
