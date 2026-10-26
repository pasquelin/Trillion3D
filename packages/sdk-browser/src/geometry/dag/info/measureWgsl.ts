import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../../visibility/shader/pageWgsl.ts'
import { PAGE_POINTS_WGSL } from '../../../visibility/shader/pageGeometryWgsl.ts'
import { CLUSTER_INFO } from './clusterInfoLayout.ts'

/** The measure's bindings, group 0, in their order: the geometry pool's words and floats, the
 *  cluster records, the edges the measure writes, the records to measure and their count. */
const MEASURE_BINDING = {
  indices: 0,
  positions: 1,
  info: 2,
  edges: 3,
  listed: 4,
  count: 5,
} as const
const B = MEASURE_BINDING

const MEASURE_INFO = wgslBlock('MEASURE_INFO', [], CLUSTER_INFO.wgsl)

/**
 * THE LONGEST EDGE OF A CLUSTER, measured once on the GPU: a workgroup a cluster record the host listed
 * (its page arrived, its record written, `../../clusters/clusterResidency.ts`), each of its lanes
 * some of the cluster's triangles, read from the pool as every pass reads them — the quantized
 * page in place, or the float geometry — at the rest pose, the longest of their three edges folded
 * by the workgroup and written to `edges` (`CLUSTER_EDGE_BYTES`). A cluster of no triangle is left
 * at zero, which the cut reads as unmeasured and hands to the hardware raster
 * (`../shader/visibleWgsl.ts`).
 */
export const measureSource = () =>
  wgslProgram(
    `@group(0) @binding(${B.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${B.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${B.info}) var<storage,read> info:array<ClusterInfo>;
@group(0) @binding(${B.edges}) var<storage,read_write> edges:array<f32>;
@group(0) @binding(${B.listed}) var<storage,read> listed:array<u32>;
@group(0) @binding(${B.count}) var<uniform> count:vec4u;
var<workgroup> longest:array<f32,WORKGROUP_THREADS>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn measure(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){
 let at=flatIndex(group,n,1u);
 if(at>=count.x){return;}
 let record=listed[at];
 let c=info[record];
 var page:PageInfo;
 page.flags=c.flags;page.pageOffset=c.pageOffset;page.indexCount=c.indexCount;page.vertexBase=c.vertexBase;
 page.deformOutput=0u;page.wpo=0u;
 let h=pageHeaderFor(page,false);
 let triangles=c.indexCount/3u;
 var edge=0.0;
 for(var t=lane;t<triangles;t+=WORKGROUP_THREADS){
  let p=pageTrianglePositions(page,h,pageTriangle(page,h,t));
  let a=p[1]-p[0];let b=p[2]-p[1];let d=p[0]-p[2];
  edge=max(edge,max(dot(a,a),max(dot(b,b),dot(d,d))));
 }
 longest[lane]=edge;
 for(var stride=WORKGROUP_THREADS/2u;stride>0u;stride=stride/2u){
  workgroupBarrier();
  if(lane<stride){longest[lane]=max(longest[lane],longest[lane+stride]);}
 }
 if(lane==0u){edges[record]=sqrt(longest[0]);}
}`,
    [
      PAGE_INFO_STRUCT_WGSL,
      MEASURE_INFO,
      PAGE_POINTS_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
