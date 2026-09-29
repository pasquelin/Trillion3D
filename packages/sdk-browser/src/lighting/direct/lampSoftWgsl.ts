/** PCSS: Myers, Fernando and Bavoil (2008), blocker search then similar-triangle
 * penumbra filtering. The existing PCF tap budget is used for each stage, as the
 * paper's 16+16 setting. Actual frame cost remains for the acceptance session.
 * https://developer.download.nvidia.com/whitepapers/2008/PCSS_Integration.pdf
 * Each tap projects its own cube face and requests its virtual page. Receiver-plane
 * intersection, instead of a kernel-wide bias, keeps sloping surfaces from shadowing
 * themselves. This changes only point lights with a positive declared radius. */
export const LAMP_SOFT_WGSL = `
struct LampSample{distance:f32,blocked:bool,through:vec3f,}
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
  let t=clamp(r.at.t,vec2f(0.5),vec2f(r.side-0.5));let word=shadowPageWord(map,home,t);
  if(word==0u){continue;}
  let offset=shadowOffset(word,home);
  let z=textureLoad(shadowAtlas,vec2i(floor(offset.xy+t)),i32(offset.z),0);
  let blocked=z>reference;
  // Reverse perspective depth: z=k/w-near/(far-near); convert axial w to ray distance.
  let axial=near*far/(near+z*(far-near));
  var through=vec3f(select(1.0,0.0,blocked));
  if(filtering&&!blocked&&textureDimensions(shadowTransmittance).x>1u){
   let first=vec2f(home)*SHADOW_PAGE;
   through*=shadowThrough(offset+vec3f(first,0.0),t-first,reference);
  }
  return LampSample(axial*distance/clip.w,blocked,through);
 }
 return LampSample(0.0,false,vec3f(1.0));
}
fn pointSoftShadow(index:u32,light:DirectLight,P:vec3f,N:vec3f,mip:u32)->f32{
 let info=shadows.records[index].info;let D=P-light.positionRange.xyz;
 let distance=length(D);let R=D/distance;
 var axis=vec3f(0.0,0.0,1.0);if(abs(R.z)>0.999){axis=vec3f(0.0,1.0,0.0);}
 let T=normalize(cross(axis,R));let B=cross(R,T);
 let source=light.shape.x;
 let closest=max(info.z,source);
 let search=source*max(distance-closest,0.0)/closest;
 var blockers=0u;var total=0.0;
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let disk=POISSON[tap];let delta=(T*disk.x+B*disk.y)*search;
  let found=lampDiskSample(index,light,P,N,delta,mip,false);
  if(found.blocked){total+=found.distance;blockers++;}
 }
 if(blockers==0u){return -1.0;}
 let blocker=total/f32(blockers);
 let penumbra=source*max(distance-blocker,0.0)/max(blocker,closest);
 var through=vec3f(0.0);
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let disk=POISSON[tap];let delta=(T*disk.x+B*disk.y)*penumbra;
  through+=lampDiskSample(index,light,P,N,delta,mip,true).through;
 }
 shadowTransmission=through/f32(PCF_TAPS);
 return 1.0;
}`;
