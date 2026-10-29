import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'
import { DF_CULL_HELPERS_WGSL, dfCullFrustumWgsl } from '../objectCullWgsl.ts'
import { DFSH_COMMON_WGSL } from './commonWgsl.ts'
import { DFSH_BINDING as B, DFSH_CULL_GROUP, DFSH_OFFSET_GROUP } from './layout.ts'

/**
 * THE MESHES CULLED TO THE VOLUME (`dfshCull`), a thread a mesh of the scene. A mesh is listed if it
 * casts a shadow (`dfshCasts`), shown or hidden — the meshes made of clusters too, which the shadow maps do not
 * reach on the cards. It is listed if its bounding sphere meets the hull of the volume (`dfCullInFrustum`: no
 * plane puts it wholly outside). It is listed if it is drawn at its distance from the eye (the
 * squared distance over `drawDistance2.x` if that is above 0.0001, under `.y` likewise). A place each
 * by an atomic add. The draw's arguments (the vertex count of the cube, the meshes listed, zeros) are
 * cleared to zero by the host before the pass; the first thread sets the vertex count.
 */
export const DFSH_CULL_WGSL = wgslProgram(
  `@group(0) @binding(${B.culledObjects}) var<storage,read_write> culledObjects:array<u32>;
@group(0) @binding(${B.objectArgs}) var<storage,read_write> objectArgs:array<atomic<u32>>;
fn dfshCasts(flags:u32)->bool{
 return (flags&FLAG_CAST_SHADOW)!=0u;
}
@compute @workgroup_size(${DFSH_CULL_GROUP})
fn dfshCull(@builtin(global_invocation_id) id:vec3u){
 if(id.x==0u){atomicStore(&objectArgs[0],dfsh.counts.y);}
 if(id.x>=dfsh.tiles.z){return;}
 let bounds=loadDfObjectBounds(id.x);
 if(!dfshCasts(bounds.flags)){return;}
 let centre=dfshFromEye(bounds.center);
 if(!dfCullInFrustum(centre,bounds.sphereRadius)){return;}
 let distanceSquared=dot(centre,centre);
 if(dfCullDrawn(loadDfObjectData(id.x).drawDistance2,distanceSquared)){
  culledObjects[atomicAdd(&objectArgs[1],1u)]=id.x;
 }
}`,
  [
    DFSH_COMMON_WGSL,
    meshFieldWgsl(0, B.objects),
    DF_CULL_HELPERS_WGSL,
    dfCullFrustumWgsl('dfsh.planes', 'dfsh.counts.x'),
  ],
)

/**
 * THE START OFFSETS OF THE TILES' LISTS (`dfshOffsets`), a thread a tile of the grid: the meshes the
 * scatter's first pass counted for the tile take a run of the lists, whose start is the sum of the
 * runs before it — a group's sum by an atomic add in its memory, the groups' by one atomic add on the
 * running total (so the order of the runs is not fixed, their sizes are).
 */
export const DFSH_OFFSETS_WGSL = wgslProgram(
  `@group(0) @binding(${B.tileCounts}) var<storage,read> tileCounts:array<u32>;
@group(0) @binding(${B.tileOffsets}) var<storage,read_write> tileOffsets:array<u32>;
@group(0) @binding(${B.nextOffset}) var<storage,read_write> nextOffset:array<atomic<u32>>;
var<workgroup> groupTotal:atomic<u32>;
var<workgroup> groupStart:u32;
@compute @workgroup_size(${DFSH_OFFSET_GROUP},${DFSH_OFFSET_GROUP})
fn dfshOffsets(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&groupTotal,0u);}
 workgroupBarrier();
 let side=dfsh.tiles.x;
 let valid=id.x<side&&id.y<side;
 let tile=id.y*side+id.x;
 var before=0u;
 if(valid){before=atomicAdd(&groupTotal,tileCounts[tile]);}
 workgroupBarrier();
 if(lane==0u){groupStart=atomicAdd(&nextOffset[0],atomicLoad(&groupTotal));}
 workgroupBarrier();
 if(valid){tileOffsets[tile]=before+groupStart;}
}`,
  [DFSH_COMMON_WGSL],
)
