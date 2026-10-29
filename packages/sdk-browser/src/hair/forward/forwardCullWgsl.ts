import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'
import { HAIR_RIBBON_WGSL } from '../ribbonWgsl.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COVERAGE_BITS,
  HAIR_COVERAGE_STEPS,
  HAIR_DEPTH_SCALE,
  HAIR_ID_BITS,
  HAIR_NODE_COUNTER_PLACED,
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_COUNTERS,
} from '../visibilityMath.ts'
import { FORWARD_THREADS } from './forwardMath.ts'
import { FORWARD_KIND_SHIFT, FORWARD_PARAMS_WGSL, forwardToPixel } from './forwardCommonWgsl.ts'

/** The binding, in group 1, of the cull's own resources (the view is binding 0 of the ribbons'). */
const FORWARD_CULL_BINDING = {
  params: 1,
  curves: 2,
  nodeVis: 3,
  nodeCoord: 4,
  counter: 5,
  points: 6,
} as const

const B = FORWARD_CULL_BINDING

/**
 * THE CULL OF THE SEGMENTS, by curves: a thread is a curve of the instance bound in group 0. Each curve of a group of threads takes its place
 * among the group's (the points it holds, counted in workgroup memory), the group takes its place among all (one add to the counter of the
 * samples placed), and the thread writes the curve's control points there, one sample each: the depth and the full share of the pixel with the
 * identifier (the instance's rank and the point's), the pixel the point falls on, held to the image, and the point itself (its position in the
 * world, its radius as a half float and its kind), which the passes over the tiles read. Every point is kept, none is dropped for lying outside the
 * view, so that a segment is always two neighbouring samples. A group whose points do not fit in the room (`params.capacity`) stores none, and
 * the samples stored are the first of the room, whole curves. A curve with no point, or whose first point is past the group's, adds none.
 */
export const FORWARD_CULL_WGSL = wgslProgram(
  `@group(1) @binding(${B.params}) var<uniform> params:ForwardParams;
@group(1) @binding(${B.curves}) var<storage,read> curves:array<u32>;
@group(1) @binding(${B.nodeVis}) var<storage,read_write> nodeVis:array<vec2u>;
@group(1) @binding(${B.nodeCoord}) var<storage,read_write> nodeCoord:array<u32>;
@group(1) @binding(${B.counter}) var<storage,read_write> nodeCounter:array<atomic<u32>,${HAIR_NODE_COUNTERS}>;
@group(1) @binding(${B.points}) var<storage,read_write> outPoints:array<vec4f>;
var<workgroup> validCount:atomic<u32>;
var<workgroup> placed:vec2u;
@compute @workgroup_size(${FORWARD_THREADS}) fn forwardCull(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&validCount,0u);}
 workgroupBarrier();
 let curve=flatIndex(id,groups,${FORWARD_THREADS}u);
 var first=0u;
 var count=0u;
 var offset=0u;
 if(curve<arrayLength(&curves)){
  let word=curves[curve];
  first=word&0xffffffu;
  if(first<inst.ids.y){
   count=min(word>>24u,inst.ids.y-first);
   offset=atomicAdd(&validCount,count);
  }
 }
 workgroupBarrier();
 if(lane==0u){
  let total=atomicLoad(&validCount);
  placed=vec2u(0u);
  if(total>0u){
   let base=atomicAdd(&nodeCounter[${HAIR_NODE_COUNTER_PLACED}],total);
   let fits=base+total<=params.capacity;
   if(fits){atomicAdd(&nodeCounter[${HAIR_NODE_COUNTER_STORED}],total);}
   placed=vec2u(base,select(0u,1u,fits));
  }
 }
 let at=workgroupUniformLoad(&placed);
 if(at.y==0u||count==0u){return;}
 var index=at.x+offset;
 let clampTo=vec2f(params.size)-vec2f(1.0);
 for(var k=0u;k<count;k++){
  let point=first+k;
  let s=spineAt(point);
  let px=forwardToPixel(view.viewProj*vec4f(s.position,1.0));
  let depth=u32(saturate(px.z)*${HAIR_DEPTH_SCALE}.0);
  let pixel=vec2u(clamp(px.xy,vec2f(0.0),clampTo));
  let kind=points[point].y>>30u;
  nodeVis[index]=vec2u((depth<<${HAIR_COVERAGE_BITS}u)|${HAIR_COVERAGE_STEPS - 1}u,(inst.ids.x<<${HAIR_ID_BITS}u)|point);
  nodeCoord[index]=pixel.x|(pixel.y<<${HAIR_COORD_BITS}u);
  outPoints[index]=vec4f(s.position,bitcast<f32>(pack2x16float(vec2f(s.radius,0.0))|(kind<<${FORWARD_KIND_SHIFT}u)));
  index++;
 }
}`,
  [HAIR_RIBBON_WGSL, FORWARD_PARAMS_WGSL, forwardToPixel, FLAT_INDEX_WGSL],
)
