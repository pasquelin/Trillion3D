import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { VISIBLE_LAYOUT_WGSL } from '../visible/layout.ts'
import { DEPTH_BUCKETS } from '../../../visibility/raster/contract.ts'
import { UNTESSELLATED } from '../../../visibility/tessellation/rowWgsl.ts'
import {
  FLAG_DISPLACED,
  FLAG_DYNAMIC,
  FLAG_LINE,
  FLAG_SPRITE,
  FLAG_VOXEL,
} from '../../../visibility/types.ts'
import { CLUSTER_TRANSPARENT } from '../clusterFlags.ts'
import { DAG_INF } from './infDecl.ts'

/**
 * THE CLUSTERS THE CUT DRAWS, appended where it decides them: the cluster cull (`wantedWgsl.ts`, and
 * the post pass's clusters, `postPassWgsl.ts`) writes a record — the page, its placement and a tag —
 * for each cluster that passed its tests to the list of visible clusters (`../visible/layout.ts`),
 * the software raster's clusters from the bottom of its records and the hardware raster's from the
 * top, by an atomic add on one counter each, once the room is taken from the count of asks they
 * share. Nothing reads the list while the cut runs; the
 * visibility passes decode it, bin it and raster it once the pass is done
 * (`../../../visibility/decode/`, `../../../visibility/bins/`).
 *
 * WHICH RASTER takes a cluster is the reference's rule, judged here with what the cut holds of it
 * and of its placement (`rasteredInHardware`): the software raster off, a line, a sprite or a voxel
 * brick (which the hardware vertex stage widens, turns or traces), a cluster whose longest edge has
 * not been measured yet (its slot of `edges`, zero), a cluster with no box, a box that crosses
 * the near or the far plane or reaches behind the view's clip plane (the hardware stages cut it,
 * the software raster cannot), or an edge that, seen at the nearest point of the cluster's
 * level-of-detail sphere, spans `hardwareRasterEdgePixels` or more:
 * `projected < scale · edge · hardwareEdge`, `projected` the sphere's smallest edge scale
 * (`sphereEdges`), `scale` the placement's greatest axis scale, `hardwareEdge` the view's pixels per
 * unit at depth one over that threshold. A cluster whose vertices move — a dynamic geometry, a
 * deformation, an offset — is judged at the sphere around its box grown by its reach, with its rest
 * edge, as the reference judges a skinned mesh. A cluster whose surface is displaced and which the
 * frame tessellates is written to the software list with `VIS_TAG_TESSELLATED`: neither raster
 * takes it, the tessellation seeds its patches from the list.
 */
export const DAG_VISIBLE_WGSL = wgslBlock(
  'DAG_VISIBLE_WGSL',
  [DAG_INF, VISIBLE_LAYOUT_WGSL],
  `${wgslConsts({
    DEPTH_BUCKETS,
    FORCE_HARDWARE: FLAG_LINE | FLAG_SPRITE | FLAG_VOXEL,
    FLAG_DISPLACED,
    FLAG_DYNAMIC,
    UNTESSELLATED,
  })}
/** The list of visible clusters made empty, no post pass opened (\`dagPrepare\`). */
fn resetVisible(){
 atomicStore(&visible[VIS_SW],0u);atomicStore(&visible[VIS_HW],0u);atomicStore(&visible[VIS_ASKED],0u);
 atomicStore(&visible[VIS_SW_SPLIT],NO_SPLIT);atomicStore(&visible[VIS_HW_SPLIT],NO_SPLIT);
}
/** The post pass opens: the clusters it writes follow, in each list, the counts so far
 *  (\`dagPostPrepare\`). */
fn splitVisible(){
 atomicStore(&visible[VIS_SW_SPLIT],atomicLoad(&visible[VIS_SW]));
 atomicStore(&visible[VIS_HW_SPLIT],atomicLoad(&visible[VIS_HW]));
}
/** The tag of a record: the depth bucket of its box and the flags of a cluster the rasters leave to
 *  others. */
fn visibleTag(bucket:u32,flags:u32)->u32{return bucket|flags;}
/** Page \`page\` of placement \`w\` appended to the hardware list or the software one; false past the
 *  list's room, the count of asks counting it still (the peak the readback brings back). The room is
 *  taken from that one count first, so that the records of the two lists, which grow towards each
 *  other, never meet and none is written by two clusters. */
fn visibleAppend(page:u32,w:u32,tag:u32,hardware:bool)->bool{
 let cap=cutView.visCap;
 if(atomicAdd(&visible[VIS_ASKED],1u)>=cap){return false;}
 var v:u32;
 if(hardware){v=cap-1u-atomicAdd(&visible[VIS_HW],1u);}else{v=atomicAdd(&visible[VIS_SW],1u);}
 let at=VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*v;
 atomicStore(&visible[at],page);atomicStore(&visible[at+1u],w);atomicStore(&visible[at+2u],tag);
 return true;
}
/** Whether the box \`c\` ± \`e\` of placement \`w\` needs clipping: a corner on or behind the near plane,
 *  or past the far one — through the render matrix the raster draws with — or behind the view's
 *  clip plane. */
fn needsClipping(w:u32,c:vec3f,e:vec3f)->bool{
 placed(w);
 let m=cutView.viewProj*placedPose;
 var nearest=INF;var deepest=INF;
 for(var k=0u;k<8u;k++){
  let corner=c+e*(vec3f(f32(k&1u),f32((k>>1u)&1u),f32((k>>2u)&1u))*2.0-1.0);
  let clip=m*vec4f(corner,1.0);
  nearest=min(nearest,clip.w-clip.z);deepest=min(deepest,clip.z);
 }
 return nearest<=0.0||deepest<=0.0||straddlesClipPlane(w,c,e);
}
/** Whether cluster \`r\` of placement \`w\`, whose cluster record is \`n\`, goes to the hardware raster
 *  (see above); \`flags\` are its page-table flags, its box grown by the deformation's reach
 *  (\`deformReach\`) where it moves. */
fn rasteredInHardware(w:u32,n:u32,r:u32,cluster:Cluster,flags:u32)->bool{
 if(cutView.softwareRaster==0u||(flags&FORCE_HARDWARE)!=0u){return true;}
 let edge=edges[n];
 if(!(edge>0.0)||hasBox(r)==0.0||info[n].indexCount==0u){return true;}
 let c=0.5*(boxMin(r)+boxMax(r));let e=0.5*(boxMax(r)-boxMin(r))+vec3f(deformReach);
 if(needsClipping(w,c,e)){return true;}
 var sphere=cluster.sphere;
 let moving=(flags&FLAG_DYNAMIC)!=0u||deformReach>0.0||info[n].wpo!=0u;
 if(moving||!(sphere.w>0.0)){sphere=vec4f(c,length(e));}
 return sphereEdges(sphere,viewWorld(w)).x<placedScale.y*edge*cutView.hardwareEdge;
}
/** The depth bucket of the box of cluster \`r\` of placement \`w\`: the view depth of its centre,
 *  clamped to the buckets' span and spread over \`DEPTH_BUCKETS\` by its logarithm, the nearest
 *  first; zero while the buckets are off (\`depthBuckets\`). */
fn depthBucketOf(w:u32,r:u32)->u32{
 if(cutView.depthBuckets==0u){return 0u;}
 let z=-(viewWorld(w)*vec4f(0.5*(boxMin(r)+boxMax(r)),1.0)).z;
 let lowest=cutView.bucketMinZ;let highest=cutView.bucketMaxZ;
 let a=1.0/(log2(highest)-log2(lowest));
 let t=log2(clamp(z,lowest,highest))*a-log2(lowest)*a;
 return u32(clamp(i32(floor(t*f32(DEPTH_BUCKETS))),0,i32(DEPTH_BUCKETS)-1));
}
/** Cluster \`r\`, page \`page\` of placement \`w\`, drawn by the running pass: appended to the list of
 *  visible clusters, a blended one to the blend pass's mask too, and its triangles counted. A
 *  cluster the list has no room for is not drawn, nor counted. */
fn drawCluster(page:u32,w:u32,r:u32,cluster:Cluster){
 if((cluster.flags&${CLUSTER_TRANSPARENT}u)!=0u){
  if(visibleAppend(page,w,visibleTag(0u,VIS_TAG_BLENDED),false)){markBlended(page);tallyDrawn(r,cluster.flags);}
  return;
 }
 let n=infoOf(page,w);
 let flags=info[n].flags;
 var tag=visibleTag(depthBucketOf(w,r),0u);
 var hardware=rasteredInHardware(w,n,r,cluster,flags);
 if(cutView.tessellation!=0u&&(flags&FLAG_DISPLACED)!=0u&&(flags&UNTESSELLATED)==0u){
  tag|=VIS_TAG_TESSELLATED;hardware=false;
 }
 if(visibleAppend(page,w,tag,hardware)){tallyDrawn(r,cluster.flags);}
}
`,
)
