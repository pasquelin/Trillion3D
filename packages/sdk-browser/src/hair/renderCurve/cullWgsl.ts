import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { RENDER_CURVE_HZB_LEVEL_WGSL } from './hzbWgsl.ts'
import {
  RENDER_CURVE_CLUSTER_WGSL,
  RENDER_CURVE_COUNTER,
  RENDER_CURVE_INSTANCE_WGSL,
  RENDER_CURVE_PARAMS_WGSL,
} from './paramsWgsl.ts'

/** The invocations of a cull's group. */
export const RENDER_CURVE_CULL_LANES = 64

/**
 * The cull of a box: `cullBox` projects the box of `center` and `extent` in the space `localToClip` takes to clip space (its eight
 * corners; an orthographic view takes the centre and the extents along the axes) and tells whether it is in the frustum and where it is
 * on the screen (the rectangle in clip space, the depth of its nearest and furthest corner); `hzbVisible` tells whether a rectangle that
 * does not cross the near plane lies in front of the scene's furthest depth over the pixels it covers (the nearest of 4 by 4 texels of
 * the level that covers it, from the buffer `hzb`).
 */
export const RENDER_CURVE_BOX_CULL_WGSL = wgslBlock(
  'RENDER_CURVE_BOX_CULL_WGSL',
  [RENDER_CURVE_PARAMS_WGSL, RENDER_CURVE_HZB_LEVEL_WGSL],
  `struct BoxCull{rectMin:vec3f,rectMax:vec3f,crossesNear:bool,visible:bool}
fn cullBox(center:vec3f,extent:vec3f,localToClip:mat4x4f)->BoxCull{
 var cull:BoxCull;
 if(curve.ortho!=0u){
  let c=(localToClip*vec4f(center,1.0)).xyz;
  let delta=abs(extent.x*localToClip[0].xyz)+abs(extent.y*localToClip[1].xyz)+abs(extent.z*localToClip[2].xyz);
  cull.rectMin=c-delta;
  cull.rectMax=c+delta;
  cull.crossesNear=cull.rectMax.z>1.0;
  cull.visible=cull.rectMax.z>0.0&&cull.rectMin.z<1.0;
  if(any(cull.rectMax.xy<vec2f(-1.0))||any(cull.rectMin.xy>vec2f(1.0))){cull.visible=false;}
  return cull;
 }
 let dx=(2.0*extent.x)*localToClip[0];
 let dy=(2.0*extent.y)*localToClip[1];
 let dz=(2.0*extent.z)*localToClip[2];
 let c000=localToClip*vec4f(center-extent,1.0);
 let c001=c000+dx;
 let c011=c001+dy;
 let c010=c011-dx;
 var corners=array<vec4f,8>(c000,c001,c011,c010,c000+dz,c001+dz,c011+dz,c010+dz);
 var minW=3.4e38;
 var maxW=-3.4e38;
 var planesMin=vec4f(1.0);
 cull.rectMin=vec3f(1.0);
 cull.rectMax=vec3f(-1.0);
 for(var k=0u;k<8u;k++){
  let p=corners[k];
  minW=min(minW,p.w);
  maxW=max(maxW,p.w);
  planesMin=min(planesMin,vec4f(p.xy,-p.xy)-p.w);
  let s=p.xy/p.w;
  cull.rectMin=vec3f(min(cull.rectMin.xy,s),cull.rectMin.z);
  cull.rectMax=vec3f(max(cull.rectMax.xy,s),cull.rectMax.z);
 }
 let minZ=maxW*curve.zScale+curve.zBias;
 let maxZ=minW*curve.zScale+curve.zBias;
 cull.crossesNear=minW<=maxZ;
 cull.visible=maxW>minZ&&0.0<maxZ;
 if(minW<=0.0&&maxW>0.0){
  cull.rectMin=vec3f(-1.0);
  cull.rectMax=vec3f(1.0);
 }else{
  cull.rectMin.z=minZ/maxW;
  cull.rectMax.z=maxZ/minW;
 }
 if(any(planesMin>vec4f(0.0))){cull.visible=false;}
 return cull;
}
fn hzbVisible(cull:BoxCull)->bool{
 let uv=saturate(vec4f(cull.rectMin.xy,cull.rectMax.xy)*vec4f(0.5,-0.5,0.5,-0.5)+0.5).xwzy;
 let size=vec2f(curve.resolution);
 var pixels=vec4i(uv*size.xyxy+vec4f(0.5,0.5,-0.5,-0.5));
 pixels=vec4i(max(pixels.xy,vec2i(0)),min(pixels.zw,vec2i(curve.resolution)-vec2i(1)));
 var texels=vec4i(pixels.xy,max(pixels.xy,pixels.zw))>>vec4u(1u);
 let bits=firstLeadingBit(texels.zw-texels.xy);
 var level=u32(max(max(bits.x,bits.y)-1,0));
 let reach=(texels.zw>>vec2u(level))-(texels.xy>>vec2u(level));
 if(any(reach>vec2i(3))){level+=1u;}
 level=min(level,curve.hzbLevels-1u);
 texels=texels>>vec4u(level);
 let last=hzbSize(level)-vec2u(1u);
 let offset=hzbOffset(level);
 var nearest=1.0;
 for(var y=0;y<4;y++){
  for(var x=0;x<4;x++){
   let at=vec2u(min(vec2i(min(texels.x+x,texels.z),min(texels.y+y,texels.w)),vec2i(last)));
   nearest=min(nearest,hzb[offset+at.y*(last.x+1u)+at.x]);
  }
 }
 return cull.rectMax.z>=nearest;
}
fn boxVisible(center:vec3f,extent:vec3f,localToClip:mat4x4f)->BoxCull{
 var cull=cullBox(center,extent,localToClip);
 if(cull.visible&&!cull.crossesNear){cull.visible=hzbVisible(cull);}
 return cull;
}`,
)

const COUNTER = RENDER_CURVE_COUNTER

/**
 * THE CULL OF THE INSTANCES: one invocation an instance, which stays when its box is in the frustum and in front of the scene's
 * depth; the first invocation sets the arguments of the cluster cull's dispatch (one group an instance) and the depth range to empty.
 * Group 0: the shared block (0), the instances (1), the arguments (2), the visible instances (3), the counters (4), the pyramid (5).
 */
export const RENDER_CURVE_INSTANCE_CULL_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> curve:RenderCurveParams;
@group(0) @binding(1) var<storage,read> instances:array<u32>;
@group(0) @binding(2) var<storage,read_write> instanceArgs:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> visibleInstances:array<u32>;
@group(0) @binding(4) var<storage,read_write> counters:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read> hzb:array<f32>;
@compute @workgroup_size(${RENDER_CURVE_CULL_LANES})
fn instanceCulling(@builtin(global_invocation_id) id:vec3u){
 if(id.x==0u){
  atomicStore(&instanceArgs[1],1u);
  atomicStore(&instanceArgs[2],1u);
  atomicStore(&counters[${COUNTER.minZ}],0xFFFFFFFFu);
  atomicStore(&counters[${COUNTER.maxZ}],0u);
 }
 if(id.x>=curve.instanceCount){return;}
 let instance=loadInstance(id.x);
 let cull=boxVisible(instance.center,instance.extent,curve.toClip*instance.localToWorld);
 if(cull.visible){
  let at=atomicAdd(&instanceArgs[0],1u);
  visibleInstances[at]=id.x;
 }
}`,
  [RENDER_CURVE_PARAMS_WGSL, RENDER_CURVE_INSTANCE_WGSL, RENDER_CURVE_BOX_CULL_WGSL],
)

/**
 * THE CULL OF THE CLUSTERS: a group an instance that stayed (the dispatch the instance cull set), its invocations taking the
 * instance's clusters in turn; a cluster whose box is in the frustum and in front of the scene's depth is named (instance, cluster)
 * in the visible clusters, and widens the depth range of the visible clusters (the ones left out do not).
 * Group 0: the shared block (0), the instances (1), the arguments (2), the visible instances (3), the visible clusters (4), the
 * counters (5), the clusters (6), the pyramid (7).
 */
export const RENDER_CURVE_CLUSTER_CULL_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> curve:RenderCurveParams;
@group(0) @binding(1) var<storage,read> instances:array<u32>;
@group(0) @binding(2) var<storage,read> instanceArgs:array<u32>;
@group(0) @binding(3) var<storage,read> visibleInstances:array<u32>;
@group(0) @binding(4) var<storage,read_write> visibleClusters:array<vec2u>;
@group(0) @binding(5) var<storage,read_write> counters:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read> clusterData:array<u32>;
@group(0) @binding(7) var<storage,read> hzb:array<f32>;
@compute @workgroup_size(${RENDER_CURVE_CULL_LANES})
fn clusterCulling(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 if(group.x>=instanceArgs[0]){return;}
 let index=visibleInstances[group.x];
 let instance=loadInstance(index);
 let localToClip=curve.toClip*instance.localToWorld;
 for(var it=lane;it<instance.clusterCount;it+=${RENDER_CURVE_CULL_LANES}u){
  let cluster=instance.clusterOffset+it;
  let header=loadClusterHeader(cluster);
  let cull=boxVisible(header.boundCenter,header.boundExtent,localToClip);
  if(cull.visible){
   let at=atomicAdd(&counters[${COUNTER.clusterCount}],1u);
   if(at<curve.maxVisibleClusters){visibleClusters[at]=vec2u(index,cluster);}
   atomicMin(&counters[${COUNTER.minZ}],bitcast<u32>(max(cull.rectMin.z,0.0)));
   atomicMax(&counters[${COUNTER.maxZ}],bitcast<u32>(min(cull.rectMax.z,1.0)));
  }
 }
}`,
  [
    RENDER_CURVE_PARAMS_WGSL,
    RENDER_CURVE_INSTANCE_WGSL,
    RENDER_CURVE_CLUSTER_WGSL,
    RENDER_CURVE_BOX_CULL_WGSL,
  ],
)
