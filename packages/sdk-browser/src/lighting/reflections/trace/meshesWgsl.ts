import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { FLAT_INDEX_WGSL } from '../../../gpu/dispatch/grid.ts'
import { MESH_TRACE_BINDING, meshTraceWgsl } from '../../rays/meshTrace/traceWgsl.ts'
import { meshGridCommonWgsl } from '../../rays/meshTrace/commonWgsl.ts'
import { TRACE_MESH_GROUP, TRACE_MESH_LIST } from '../../bounce/screen/traceMeshWgsl.ts'
import { spCompact, type SceneCompaction } from '../../bounce/screen/traceWgsl.ts'
import { REFLECTION_SIDE } from '../constants.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './traceBindings.ts'

/** The word a ray's entry in the list of the rays the screen missed takes once the meshes' fields stage answered it whole: the scene stage leaves it. It is a
 *  pattern no distance has (a NaN). */
export const REFLECTION_MESH_ANSWERED = '0xffffffffu'

/** The threads of a workgroup of the meshes' fields stage. */
const THREADS = REFLECTION_SIDE * REFLECTION_SIDE

/** The card interpolation radius a hit of the meshes' fields reads the surface cache over, in centimetres (10). */
const CARD_INTERPOLATION_RADIUS = 10

/** The list of the rays the screen missed as the first compaction reads it: it is the indirect arguments of that dispatch, so read alone. */
const PENDING_READ = listWgsl({
  name: 'pendingSeen',
  group: 0,
  binding: B.pendingMesh,
  entry: 'vec2u',
  append: false,
})

/** The same list as the trace binds it, to write: it rewrites the entry of a ray it answers or lets go on. */
const PENDING_WRITTEN = listWgsl({
  name: 'pendingMesh',
  group: 0,
  binding: B.pendingMesh,
  entry: 'vec2u',
  append: true,
})

/**
 * THE FIRST COMPACTION OF THE MESHES' FIELDS STAGE (`compactReflectionMeshes`), a thread a ray the screen missed: the rays whose pixel stands nearer the camera than the farthest a
 * mesh is traced at (`msdf.distances.x`) and whose screen miss reached no farther than the farthest a ray traces the meshes (`msdf.distances.y`) are listed, as their rank in the list of the
 * rays missed, in the order of their threads (`spCompact`), a workgroup taking its place in the list once (`meshRaysOutAppend`). The trace is dispatched over this list.
 */
const compactBlock = (compaction: SceneCompaction) =>
  wgslBlock(
    `REFLECTION_COMPACT_MESHES(${compaction})`,
    [
      meshGridCommonWgsl(TRACE_MESH_GROUP, MESH_TRACE_BINDING.params),
      PENDING_READ,
      listWgsl({
        name: 'meshRaysOut',
        group: TRACE_MESH_LIST,
        binding: 0,
        entry: 'u32',
        append: true,
      }),
      FLAT_INDEX_WGSL,
      spCompact(compaction, `${THREADS}u`),
    ],
    `var<workgroup> meshBase:u32;
@compute @workgroup_size(${THREADS})
fn compactReflectionMeshes(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) lane:u32){
 let at=flatIndex(id,groups,${THREADS}u);
 if(lane==0u){spCompactBegin();}
 workgroupBarrier();
 var wants=false;
 if(at<pendingSeen.count){
  let entry=pendingSeen.entries[at];
  let depth=bitcast<f32>(textureLoad(surfaceRays,vec2i(vec2u(entry.x&0xffffu,entry.x>>16u)),REFLECTION_RAY_DEPTH).r);
  wants=depth*100.0<msdf.distances.x&&bitcast<f32>(entry.y)*100.0<=msdf.distances.y;
 }
 let slot=spCompactRank(wants,lane);
 workgroupBarrier();
 let count=spCompactTotal();
 if(lane==0u&&count>0u){meshBase=meshRaysOutAppend(count,${THREADS}u);}
 workgroupBarrier();
 if(wants){meshRaysOut.entries[meshBase+slot]=at;}
}`,
  )

/**
 * THE MESHES' FIELDS STAGE (`traceReflectionMeshes`), a thread a ray of the list the first compaction made, before the scene stage: the ray is marched through the meshes the cell of its pixel in
 * the view's grid lists (`msdfTraceCell`, the cell of the pixel and the depth of its surface), from where the screen stopped knowing it (the bias back) to the farthest a ray traces the meshes,
 * not past the longest ray, the surface expanded by the largest distance read (`expandByTime` false). A hit takes the light of its mesh's cards at the point (`scMeshHit`, over the radius of the card
 * interpolation and the footprint of the ray's cone), fogged along the ray, with the sky light that leaks onto it, held to the ceiling of a ray. The hit fades out with the pixel's distance from the
 * camera (a quarter of the farthest a mesh is traced at, to the whole of it) and with its own distance (the last third of the trace); it answers where the fade is under the pixel's noise: the fresh
 * grid is written whole and the ray's entry in the list of the rays missed is marked answered (`REFLECTION_MESH_ANSWERED`), which the scene stage leaves. A ray it does not answer goes on to the
 * scene stage from where this one left it: its entry holds the distance of the hit it faded out of, or the farthest it traced.
 */
const traceBlock = () =>
  wgslBlock(
    'REFLECTION_TRACE_MESHES',
    [
      meshTraceWgsl(TRACE_MESH_GROUP, 0),
      PENDING_WRITTEN,
      listWgsl({
        name: 'meshRaysIn',
        group: TRACE_MESH_LIST,
        binding: 0,
        entry: 'u32',
        append: false,
      }),
      FLAT_INDEX_WGSL,
      interleavedGradientNoise,
    ],
    `const MESH_CARD_RADIUS:f32=${CARD_INTERPOLATION_RADIUS}.0;
/** The distance from the camera of the point P (centimetres): its depth under an orthographic view. */
fn reflectionMeshEyeDistance(P:vec3f,depth:f32)->f32{
 return 100.0*select(depth,length(view.camera.xyz-P),view.camera.w!=0.0);
}
@compute @workgroup_size(${THREADS})
fn traceReflectionMeshes(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let rank=flatIndex(thread,groups,${THREADS}u);
 if(rank>=meshRaysIn.count){return;}
 let slot=meshRaysIn.entries[rank];
 let entry=pendingMesh.entries[slot];
 let g=vec2u(entry.x&0xffffu,entry.x>>16u);
 let coord=vec2i(reflectionPickedPixel(g));
 let own=reflectingPixelAt(REFLECTION_LAYER,coord,surfaceFlagsAt(coord));
 let stored=reflectionStoredRay(vec2i(g));
 let R=stored.ray.R;
 let bias=reflectionView.reach.x;
 let begin=max(bitcast<f32>(entry.y)-bias,0.0);
 let farthest=min(msdf.distances.y*0.01,reflectionFar()-bias);
 let start=(own.P+R*bias)*100.0;
 let traced=MsdfRay(start,R,begin*100.0,farthest*100.0,false,0.0,false,vec2f(g));
 let hit=msdfTraceCell(traced,msdfCellIndex(vec2u(coord),own.z*100.0));
 var left=max(farthest,begin);
 if(hit.distance<traced.maxTrace){
  left=hit.distance*0.01;
  let derived=msdfTraceDerived(traced,hit);
  var face=derived.normal;
  if(dot(face,R)>0.0){face=-face;}
  var fade=saturate(4.0*reflectionMeshEyeDistance(own.P,own.z)/msdf.distances.x-3.0);
  fade=max(fade,saturate((hit.distance-msdf.distances.y*0.7)/(msdf.distances.y*0.3)));
  if(fade<interleavedGradientNoise(vec2f(g)+vec2f(0.5),0.0)){
   let surface=scMeshHit(start+R*hit.distance,face,derived.instance,reflectionHitSpread(stored.cone)*hit.distance,MESH_CARD_RADIUS,reflectionDone(REFLECTION_HI_RES_SURFACE),g);
   let lit=select(vec3f(0.0),surface.radiance,surface.valid);
   let radiance=reflectionClampRay(reflectionFogged(lit,own.P,R*(bias+left))+reflectionSkylightLeak(vec3f(0.0)));
   textureStore(traceOut,vec2i(g),freshPack(radiance,bias+left));
   pendingMesh.entries[slot]=vec2u(entry.x,${REFLECTION_MESH_ANSWERED});
   return;
  }
 }
 pendingMesh.entries[slot]=vec2u(entry.x,bitcast<u32>(left));
}`,
  )

/** The kernels of the meshes' fields stage — the first compaction and the trace — as the reflection's program lists them (`reflectionTraceShader`). */
export const reflectionMeshesWgsl = (compaction: SceneCompaction) =>
  [compactBlock(compaction), traceBlock()] as const
