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
}`;

/** PCSS: Myers, Fernando and Bavoil (2008), blocker search then similar-triangle
 * penumbra filtering. The existing PCF tap budget is used for each stage, as the
 * paper's 16+16 setting. Actual frame cost remains for the acceptance session.
 * https://developer.download.nvidia.com/whitepapers/2008/PCSS_Integration.pdf
 * Each tap projects its own cube face and requests its virtual page. Receiver-plane
 * intersection, instead of a kernel-wide bias, keeps sloping surfaces from shadowing
 * themselves. This changes only point lights with a positive declared radius.
 * A filter tap is a bilinear comparison (`lampSoftCompare`), not one texel's: each tap's share
 * fades over a texel as the edge crosses it, and the penumbra is a ramp, never sixteen steps. The
 * disk turns each jitter phase (`shadowRotated`) and the TAA's history averages the turns, as
 * Unreal's SMRT leaves its rays to the temporal filter (#1363). */
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
 let ray=normalize(P-light.positionRange.xyz+delta);
 let plane=dot(N,P-light.positionRange.xyz);let cosine=dot(N,ray);
 if(abs(cosine)<1e-6||plane*cosine<=0.0){return LampSample(0.0,false,vec3f(1.0));}
 let distance=plane/cosine;
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
fn pointSoftShadow(index:u32,light:DirectLight,P:vec3f,N:vec3f,mip:u32)->f32{
 let d=lampSoftDisk(index,light,P);
 var blockers=0u;var total=0.0;
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let disk=shadowRotated(POISSON[tap]);let delta=(d.T*disk.x+d.B*disk.y)*d.search;
  let found=lampDiskSample(index,light,P,N,delta,mip,false);
  if(found.blocked){total+=found.distance;blockers++;}
 }
 if(blockers==0u){return -1.0;}
 let blocker=total/f32(blockers);
 // Every blocker lies past the emitter's sphere and the near plane, at least \`closest\`: the
 // penumbra is never wider than the search, the disk the demand marks (\`demandSoftLamp\`).
 let penumbra=light.shape.x*max(d.distance-blocker,0.0)/max(blocker,d.closest);
 var through=vec3f(0.0);
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let disk=shadowRotated(POISSON[tap]);let delta=(d.T*disk.x+d.B*disk.y)*penumbra;
  through+=lampDiskSample(index,light,P,N,delta,mip,true).through;
 }
 shadowTransmission=through/f32(PCF_TAPS);
 return 1.0;
}`;
