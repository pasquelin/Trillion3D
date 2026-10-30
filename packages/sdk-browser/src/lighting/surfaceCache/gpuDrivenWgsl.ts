import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import {
  GROUP_FLAGS,
  GROUP_WORDS,
  NO_MESH_CARDS_WORD,
} from '../../../../sdk-core/src/lighting/surfaceCache/gpuDriven.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'

/**
 * THE GPU'S UPDATE OF THE SCENE (`surfaceCacheGpuDrivenUpdate`): one thread for each placement of the table
 * (`GROUP_WORDS` words each: the centre of its box and the index of its mesh cards, then the half sides and the flags),
 * which tests it as the CPU's cull does (`wantsCards`, `requests.ts`): the squared distance from the nearest eye to its box,
 * the resolution its greatest half side would have there, and the translucent surfaces the scene caches. A placement that
 * wants cards and has none appends itself to `addOps` with its squared distance; one that does not and has cards, to
 * `removeOps`. The first word of each list counts the appends, which may pass its room (`maxAddOps`, `maxRemoveOps`: the
 * words of `removeOps`, the pairs of `addOps`); the placements appended follow.
 *
 * The distance is the least over the eyes: the reference's pass keeps the last eye's (a bug, not ported).
 */

const CONSTANTS = wgslConsts({
  GROUP_WORDS,
  GROUP_PLACED: GROUP_FLAGS.placed,
  GROUP_VALID_MESH_CARDS: GROUP_FLAGS.validMeshCards,
  GROUP_EMISSIVE: GROUP_FLAGS.emissive,
  GROUP_OPAQUE_OR_MASKED: GROUP_FLAGS.opaqueOrMasked,
  NO_MESH_CARDS: NO_MESH_CARDS_WORD,
})

/** The most eyes the pass tests against: the main view's and one streaming view's. */
export const SCENE_UPDATE_EYES = 2

/** The bytes of the pass's uniform: eight words, then the eyes (`vec4`, centimetres). */
export const SCENE_UPDATE_PARAM_BYTES = 32 + SCENE_UPDATE_EYES * 16

/** The entry of the program. */
export const SCENE_UPDATE_ENTRY = 'updateSurfaceScene'

/** The bindings of the program after its uniform at 0. */
export const SCENE_UPDATE_BINDINGS = { groups: 1, addOps: 2, removeOps: 3 } as const

export const SCENE_UPDATE_WGSL = wgslProgram(
  `${CONSTANTS}
struct SceneUpdate{
 groups:u32,
 maxAddOps:u32,
 maxRemoveOps:u32,
 eyes:u32,
 maxDistanceSq:f32,
 texelDensity:f32,
 minResolution:f32,
 addTranslucent:u32,
 eye:array<vec4f,${SCENE_UPDATE_EYES}>,
}
@group(0) @binding(0) var<uniform> update:SceneUpdate;
@group(0) @binding(${SCENE_UPDATE_BINDINGS.groups}) var<storage,read> table:array<vec4f>;
@group(0) @binding(${SCENE_UPDATE_BINDINGS.addOps}) var<storage,read_write> addOps:array<atomic<u32>>;
@group(0) @binding(${SCENE_UPDATE_BINDINGS.removeOps}) var<storage,read_write> removeOps:array<atomic<u32>>;
/** The squared distance from a point to the box of a centre and half sides. */
fn boxDistanceSq(centre:vec3f,reach:vec3f,point:vec3f)->f32{
 let away=max(abs(point-centre)-reach,vec3f(0.0));
 return dot(away,away);
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn ${SCENE_UPDATE_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let rank=flatIndex(id,groups,WORKGROUP_THREADS);
 if(rank>=update.groups){return;}
 let first=table[rank*(GROUP_WORDS/4u)];
 let second=table[rank*(GROUP_WORDS/4u)+1u];
 let flags=bitcast<u32>(second.w);
 if((flags&GROUP_PLACED)==0u){return;}
 var distanceSq=3.4e38;
 for(var k=0u;k<update.eyes;k++){
  distanceSq=min(distanceSq,boxDistanceSq(first.xyz,second.xyz,update.eye[k].xyz));
 }
 let resolution=update.texelDensity*max(second.x,max(second.y,second.z))/sqrt(max(distanceSq,1.0))+0.01;
 var least=update.minResolution;
 if((flags&GROUP_EMISSIVE)!=0u){least=1.0;}
 let hasCards=bitcast<u32>(first.w)!=NO_MESH_CARDS;
 let wanted=distanceSq<=update.maxDistanceSq&&resolution>=least&&((flags&GROUP_OPAQUE_OR_MASKED)!=0u||update.addTranslucent!=0u);
 if(wanted){
  if(!hasCards&&(flags&GROUP_VALID_MESH_CARDS)!=0u){
   let at=atomicAdd(&addOps[0],1u)+1u;
   if(at<update.maxAddOps){
    atomicStore(&addOps[2u*at],rank);
    atomicStore(&addOps[2u*at+1u],bitcast<u32>(distanceSq));
   }
  }
 }else if(hasCards){
  let at=atomicAdd(&removeOps[0],1u)+1u;
  if(at<update.maxRemoveOps){atomicStore(&removeOps[at],rank);}
 }
}`,
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
)
