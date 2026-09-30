/** The PCSS disk at \`P\`: its tangent frame, the lamp's distance, the nearest blocker distance and
 *  the blocker search's radius. One copy, read by the shading (\`pointSoftShadow\`) and by the
 *  per-pixel demand that marks the pages its taps read (\`../../webgpu/shadow/demandWgsl.ts\`). */
export const LAMP_SOFT_DISK_WGSL = `
struct LampDisk{T:vec3f,B:vec3f,distance:f32,closest:f32,search:f32,}
fn lampSoftDisk(index:u32,light:DirectLight,P:vec3f)->LampDisk{
 let info=shadows.records[index].info;let D=P-light.positionRange.xyz;
 let distance=length(D);let R=D/distance;
 var axis=vec3f(0.0,0.0,1.0);if(abs(R.z)>0.999){axis=vec3f(0.0,1.0,0.0);}
 let T=normalize(cross(axis,R));let B=cross(R,T);
 let source=light.shape.x;
 let closest=max(info.z,source);
 return LampDisk(T,B,distance,closest,source*max(distance-closest,0.0)/closest);
}
/** The mip a PCSS disk of scale \`scale\` metres reads, never finer than \`least\`: the finest whose
 *  texel at the point, \`texel0·2^mip\`, holds the scale within \`LAMP_SOFT_TEXELS\` texels, as a
 *  mipmapped filter reads the level of its kernel. Its taps then lie a few texels apart — each a
 *  bilinear comparison, the ramp smooth — and the pages they read are the few around the disk,
 *  whatever the lamp's size (\`demandSoftLamp\`). */
const LAMP_SOFT_TEXELS:f32=8.0;
fn lampSoftMip(scale:f32,texel0:f32,least:u32)->u32{
 let coarser=u32(ceil(log2(max(scale/(LAMP_SOFT_TEXELS*texel0),1.0))));
 return min(max(least,coarser),LAMP_MIP_COUNT-1u);
}
/** The point \`P\` read at \`mip\`: moved along its normal by \`offset\` texels of that mip, as
 *  \`lampReadAt\` moves it. */
fn lampSoftCentre(P:vec3f,N:vec3f,offset:f32,texel0:f32,mip:u32)->vec3f{return P+N*(texel0*exp2(f32(mip))*offset);}`;

/** PCSS: Myers, Fernando and Bavoil (2008), blocker search then similar-triangle
 * penumbra filtering. The existing PCF tap budget is used for each stage, as the
 * paper's 16+16 setting.
 * https://developer.download.nvidia.com/whitepapers/2008/PCSS_Integration.pdf
 * Each stage reads the mip its disk calls for (`lampSoftMip`): the search the mip of the lamp's
 * whole disk, the filter the mip of the penumbra found, at least the pixel's own. So a tap costs
 * the same whatever the lamp's radius, and its pages are the few the demand marks around the disk
 * (#1363), as Unreal's virtual shadow maps bound a filter's reach to the pages a pixel marks.
 * Each tap projects its own cube face and reads its own page, a coarser mip where that one is
 * not readable. Receiver-plane intersection, instead of a kernel-wide bias, keeps sloping
 * surfaces from shadowing themselves; it stops at the disk's width past the receiver, where a
 * plane steeper than 45° or behind the ray — a curved receiver near its terminator — would send
 * the tap across the map. A filter tap is a bilinear comparison (`lampSoftCompare`): the penumbra
 * is a ramp, never sixteen steps. The taps are the same every image: no per-frame pattern for the
 * TAA to average. This changes only point lights with a positive declared radius. */
export const LAMP_SOFT_WGSL = `${LAMP_SOFT_DISK_WGSL}
struct LampSample{distance:f32,blocked:bool,through:vec3f,}
/** \`shadowCompare\` at texel \`t\` of page \`home\` (\`word\`, at \`offset\` from \`first\`), its bilinear
 *  footprint split along the one or two seams it crosses as \`shadowPcf\` splits a tap
 *  (\`shadowSplitTap\`): a neighbour not readable read at the home page's nearest texel. */
fn lampSoftCompare(m:ShadowMap,t:vec2f,home:vec2i,word:u32,offset:vec3f,first:vec2f,reference:f32)->f32{
 let step=vec2i(shadowPcfStep(t.x,first.x),shadowPcfStep(t.y,first.y));let up=step>vec2i(0);
 let seam=first+select(vec2f(0.0),vec2f(SHADOW_PAGE),up);
 let edge=saturate(0.5+(seam-t)*vec2f(step))<vec2f(1.0);
 return shadowSplitTap(offset,shadowNeighbours(m,home,step,edge,offset,word),edge,up,first,t,reference);
}
fn lampDiskSample(index:u32,light:DirectLight,P:vec3f,N:vec3f,delta:vec3f,mip0:u32,filtering:bool)->LampSample{
 let info=shadows.records[index].info;
 let toward=P-light.positionRange.xyz+delta;let along=length(toward);let ray=toward/along;
 let plane=dot(N,P-light.positionRange.xyz);let cosine=dot(N,ray);
 // The receiver's plane along the tap's ray, no farther than the disk's width past the disk.
 var distance=along+length(delta);
 if(plane*cosine>0.0){distance=min(plane/cosine,distance);}
 let Q=light.positionRange.xyz+ray*distance;
 let near=info.z;let far=max(near*1.001,light.positionRange.w);
 for(var mip=mip0;mip<LAMP_MIP_COUNT;mip++){
  // The shading's own lookup (\`lampReadAt\`), at the tap's point itself: its face, map and page.
  let r=lampReadAt(index,light.positionRange.xyz,Q,N,0.0,1.0,mip);
  let clip=r.clip;let reference=r.ndc.z+SHADOW_DEPTH_ROUNDING;
  let map=r.at.map;let home=r.at.home;
  let t=clamp(r.at.t,vec2f(0.5),vec2f(r.side-0.5));let word=shadowPageWord(map,home);
  if(word==0u){continue;}
  let offset=shadowOffset(word,home);let first=vec2f(home)*SHADOW_PAGE;
  if(filtering){
   let lit=lampSoftCompare(map,t,home,word,offset,first,reference);
   var through=vec3f(lit);
   if(lit>0.0&&textureDimensions(shadowTransmittance).x>1u){through*=shadowThrough(offset+vec3f(first,0.0),t-first,reference);}
   return LampSample(0.0,lit<1.0,through);
  }
  let z=textureLoad(shadowAtlas,vec2i(floor(offset.xy+t)),i32(offset.z),0);
  // Reverse perspective depth: z=k/w-near/(far-near); convert axial w to ray distance.
  let axial=near*far/(near+z*(far-near));
  return LampSample(axial*distance/clip.w,z>reference,vec3f(1.0));
 }
 return LampSample(0.0,false,vec3f(1.0));
}
/** The soft shadow of point lamp \`index\` at receiver \`P\` (normal \`N\`, moved \`offset\` texels
 *  along it at the mip it reads), \`texel0\` its finest texel there, \`mip\` the pixel's; -1 when
 *  the search finds no blocker, the PCF then answering. */
fn pointSoftShadow(index:u32,light:DirectLight,P:vec3f,N:vec3f,offset:f32,texel0:f32,mip:u32)->f32{
 let d=lampSoftDisk(index,light,lampSoftCentre(P,N,offset,texel0,mip));
 let searchMip=lampSoftMip(d.search,texel0,mip);
 let S=lampSoftCentre(P,N,offset,texel0,searchMip);
 var blockers=0u;var total=0.0;
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let disk=POISSON[tap];let delta=(d.T*disk.x+d.B*disk.y)*d.search;
  let found=lampDiskSample(index,light,S,N,delta,searchMip,false);
  if(found.blocked){total+=found.distance;blockers++;}
 }
 if(blockers==0u){return -1.0;}
 let blocker=total/f32(blockers);
 // Every blocker lies past the emitter's sphere and the near plane, at least \`closest\`: the
 // penumbra is never wider than the search, its mip never coarser (\`demandSoftLamp\`).
 let penumbra=light.shape.x*max(d.distance-blocker,0.0)/max(blocker,d.closest);
 let filterMip=lampSoftMip(penumbra,texel0,mip);
 let F=lampSoftCentre(P,N,offset,texel0,filterMip);
 var through=vec3f(0.0);
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let disk=POISSON[tap];let delta=(d.T*disk.x+d.B*disk.y)*penumbra;
  through+=lampDiskSample(index,light,F,N,delta,filterMip,true).through;
 }
 shadowTransmission=through/f32(PCF_TAPS);
 return 1.0;
}`;
