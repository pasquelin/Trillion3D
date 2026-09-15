export const DAG_SELECTION_SHADER = `struct Cluster{sphere:vec4f,parentSphere:vec4f,lodError:f32,parentError:f32,worldIndex:u32,level:u32,nodeIndex:u32,flags:u32,pad0:u32,pad1:u32,}
struct CullNode{minimum:vec3f,pad0:f32,maximum:vec3f,maxParentError:f32,sphere:vec4f,worldIndex:u32,firstPage:u32,pageCount:u32,childCount:u32,}
struct Uniforms{planes:array<vec4f,6>,view:mat4x4f,pixelScale:vec2f,pixelError:f32,near:f32,clusterCount:u32,nodeCount:u32,worldCount:u32,residentCut:u32,cameraWorld:vec3f,cameraStretch:f32,}
struct Output{count:atomic<u32>,frustumRejected:atomic<u32>,lodLevel:atomic<u32>,overflow:atomic<u32>,pages:array<u32>,}
struct PageCone{cone:vec4f,minimum:vec3f,hasBox:f32,maximum:vec3f,resident:f32,}
@group(0) @binding(0) var<storage, read> clusters:array<Cluster>;
@group(0) @binding(1) var<storage, read> nodes:array<CullNode>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
@group(0) @binding(3) var<storage, read_write> flags:array<u32>;
@group(0) @binding(4) var<storage, read_write> out:Output;
@group(0) @binding(5) var<storage, read_write> work:array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> worlds:array<mat4x4f>;
@group(0) @binding(7) var<storage, read_write> frames:array<vec4f>;
@group(0) @binding(8) var<storage, read> pageCones:array<PageCone>;
/** A WGSL const-expression may not be infinite, so the unreachable band uses the largest f32:
 *  every comparison below behaves exactly as the CPU cut's Infinity for any finite threshold. */
const INF:f32=3.4e38;
const FRAME:u32=7u;
/** Same projection as clusterErrorPixels: error x stretch x focal over the distance to the sphere.
 *  Miroir GPU de \`projectedError\` (gpuDagOracleMath.ts) : memes gardes, meme ordre, deux langages. */
fn projected(error:f32,sphere:vec4f,e:mat4x4f,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)){return INF;}
 let v=(e*vec4f(sphere.xyz,1.0)).xyz;
 let distance=length(v)-sphere.w*stretch;
 if(!(distance>uni.near)){return INF;}
 return (error*stretch*focal)/distance;
}
/** Frustum planes live in the primitive's own space, so no box is ever transformed.
 *  Miroir GPU de \`frustumExcludesBox\` (sdk-core, mathFrustumBox.ts) : memes coins, meme somme. */
fn outsideFrustum(base:u32,bmin:vec3f,bmax:vec3f)->bool{
 for(var i=0u;i<6u;i++){
  let plane=frames[base+i];
  let px=select(bmin.x,bmax.x,plane.x>0.0);let py=select(bmin.y,bmax.y,plane.y>0.0);let pz=select(bmin.z,bmax.z,plane.z>0.0);
  if(dot(plane.xyz,vec3f(px,py,pz))+plane.w<0.0){return true;}
 }
 return false;
}
fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{
 let a=m[0];let b=m[1];let c=m[2];
 let det=dot(a,cross(b,c));
 if(abs(det)<1e-20){return v;}
 return (1.0/det)*(mat3x3f(cross(b,c),cross(c,a),cross(a,b))*v);
}
/** Miroir GPU de \`isConformal\` (pageCone.ts) : 3x3 divisee par la somme de ses valeurs absolues,
 *  tolerances relatives seules ; somme nulle, infinie ou NaN (lue au bit) : cluster conserve. */
fn isConformal(m:mat3x3f)->bool{
 let s=abs(m[0])+abs(m[1])+abs(m[2]);let t=s.x+s.y+s.z;
 if(!(t>0.0)||(bitcast<u32>(t)&0x7f800000u)==0x7f800000u){return false;}
 let a=m[0]/t;let b=m[1]/t;let c=m[2]/t;
 let lx2=dot(a,a);let ly2=dot(b,b);let lz2=dot(c,c);
 let maxl=max(lx2,max(ly2,lz2));let minl=min(lx2,min(ly2,lz2));
 if(maxl>minl*1.0001){return false;}
 let eps=maxl*1e-4;
 return abs(dot(a,b))<=eps&&abs(dot(a,c))<=eps&&abs(dot(b,c))<=eps;
}
/** Miroir GPU de \`coneCullsPageWith\` (pageCone.ts) : memes tolerances, memes operandes. */
fn coneRejectsBox(cone:vec4f,bmin:vec3f,bmax:vec3f,world:mat4x4f)->bool{
 if(cone.w>=1.57079632679){return false;}
 let m=mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz);
 if(!isConformal(m)){return false;}
 let c=0.5*(bmin+bmax);let e=0.5*(bmax-bmin);
 let center=(world*vec4f(c,1.0)).xyz;
 let we=abs(world[0].xyz)*e.x+abs(world[1].xyz)*e.y+abs(world[2].xyz)*e.z;
 let toCam=uni.cameraWorld-center;
 let dist=length(toCam);
 if(dist==0.0){return false;}
 let view=toCam/dist;
 let axis=inverseTranspose3(m,cone.xyz);
 let al=length(axis);
 if(!(al>0.0)){return false;}
 let axisWorld=axis/al;
 let radius=length(we);
 if(dist<=radius){return false;}
 let spread=asin(clamp(radius/dist,0.0,1.0));
 let d=dot(axisWorld,view);
 return d<-sin(cone.w+spread)&&(cone.w+spread)<1.57079632679;
}
fn coneRejects(index:u32,cluster:Cluster)->bool{
 let rec=pageCones[index];
 if(rec.hasBox==0.0){return false;}
 return coneRejectsBox(rec.cone,rec.minimum,rec.maximum,worlds[cluster.worldIndex]);
}
/** Le rejet par cone ne depend que de la page, de son monde et de la camera : il vaut donc la meme
 *  chose pour les cinq passes d'une meme image. \`dagWanted\` le calcule une fois par page visible et
 *  le depose derriere les drapeaux de dessin ; les passes suivantes le relisent au lieu de refaire
 *  \`asin\`, \`sin\` et les deux \`length\`. Elles ne le lisent que pour une page visible, la seule pour
 *  laquelle il a ete ecrit. */
fn coneCache(index:u32)->u32{return uni.nodeCount+uni.clusterCount+index;}
fn coneRejected(index:u32)->bool{return flags[coneCache(index)]!=0u;}
fn visible(index:u32,cluster:Cluster)->bool{
 if((cluster.flags&2u)!=0u){return false;}
 if(cluster.nodeIndex!=0xffffffffu&&flags[cluster.nodeIndex]!=0u){return false;}
 let rec=pageCones[index];
 return !outsideFrustum(cluster.worldIndex*FRAME,rec.minimum,rec.maximum);
}
fn selects(cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32,threshold:f32)->bool{
 if(projected(cluster.lodError,cluster.sphere,e,stretch,focal)>threshold){return false;}
 return projected(cluster.parentError,cluster.parentSphere,e,stretch,focal)>threshold;
}
fn focalPixels()->f32{return max(uni.pixelScale.x,uni.pixelScale.y);}
fn stretchOf(world:u32)->f32{return frames[world*FRAME+6u].x*uni.cameraStretch;}
fn emitOne(page:u32){
 let cap=arrayLength(&out.pages);
 let slot=atomicAdd(&out.count,1u);
 if(slot>=cap){atomicStore(&out.overflow,1u);return;}
 out.pages[slot]=page;
}
/** Raise the primitive's threshold to the replacement band, or demand the pinned cover. */
fn escalate(world:u32,parentPixels:f32){
 if(parentPixels>0.0&&parentPixels<INF){atomicMax(&work[world],bitcast<u32>(parentPixels));}
 else{atomicOr(&work[uni.worldCount+world],1u);}
}
@compute @workgroup_size(64)
fn dagReset(@builtin(global_invocation_id) id:vec3u){
 let w=id.x;
 if(w==0u){atomicStore(&out.count,0u);atomicStore(&out.frustumRejected,0u);atomicStore(&out.lodLevel,0u);atomicStore(&out.overflow,0u);}
 if(w>=uni.worldCount){return;}
 atomicStore(&work[w],bitcast<u32>(max(uni.pixelError,0.0)));
 atomicStore(&work[uni.worldCount+w],0u);
}
@compute @workgroup_size(64)
fn dagPlanes(@builtin(global_invocation_id) id:vec3u){
 let w=id.x;if(w>=uni.worldCount){return;}
 let t=transpose(worlds[w]);let base=w*FRAME;
 for(var i=0u;i<6u;i++){frames[base+i]=t*uni.planes[i];}
}
@compute @workgroup_size(64)
fn dagNodes(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.nodeCount){return;}
 let node=nodes[i];let base=node.worldIndex*FRAME;
 if(outsideFrustum(base,node.minimum,node.maximum)){flags[i]=1u;return;}
 if(node.maxParentError>=0.0){
  let e=uni.view*worlds[node.worldIndex];
  if(projected(node.maxParentError,node.sphere,e,stretchOf(node.worldIndex),focalPixels())<=uni.pixelError){flags[i]=2u;return;}
 }
 flags[i]=0u;
}
@compute @workgroup_size(64)
fn dagWanted(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.clusterCount){return;}
 let cluster=clusters[i];
 if(!visible(i,cluster)){atomicAdd(&out.frustumRejected,1u);return;}
 let rejected=coneRejects(i,cluster);
 flags[coneCache(i)]=select(0u,1u,rejected);
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,uni.pixelError)){return;}
 if(rejected){return;}
 atomicMax(&out.lodLevel,cluster.level);
 emitOne(i);
 if(uni.residentCut==0u||pageCones[i].resident!=0.0){return;}
 escalate(w,projected(cluster.parentError,cluster.parentSphere,e,stretch,focal));
}
@compute @workgroup_size(64)
fn dagEscalate(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.clusterCount||uni.residentCut==0u){return;}
 if(pageCones[i].resident!=0.0){return;}
 let cluster=clusters[i];
 if(!visible(i,cluster)){return;}
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[w])))){return;}
 if(coneRejected(i)){return;}
 escalate(w,projected(cluster.parentError,cluster.parentSphere,e,stretch,focal));
}
@compute @workgroup_size(64)
fn dagCheck(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.clusterCount||uni.residentCut==0u){return;}
 if(pageCones[i].resident!=0.0){return;}
 let cluster=clusters[i];
 if(!visible(i,cluster)){return;}
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[w])))){return;}
 if(coneRejected(i)){return;}
 atomicOr(&work[uni.worldCount+w],1u);
}
@compute @workgroup_size(64)
fn dagMask(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.clusterCount){return;}
 let cluster=clusters[i];
 var draw=false;
 if(visible(i,cluster)&&!coneRejected(i)){
  let w=cluster.worldIndex;
  if(uni.residentCut!=0u&&atomicLoad(&work[uni.worldCount+w])!=0u){
   // No resident ancestor replaces the missing cluster: this primitive falls back to its pinned roots.
   draw=(cluster.flags&1u)!=0u;
   if(draw&&pageCones[i].resident==0.0){atomicOr(&out.overflow,2u);draw=false;}
  }else{
   let e=uni.view*worlds[w];
   let threshold=select(uni.pixelError,bitcast<f32>(atomicLoad(&work[w])),uni.residentCut!=0u);
   draw=selects(cluster,e,stretchOf(w),focalPixels(),threshold);
   if(draw&&uni.residentCut!=0u&&pageCones[i].resident==0.0){atomicOr(&out.overflow,2u);draw=false;}
  }
 }
 flags[uni.nodeCount+i]=select(0u,1u,draw);
}
`;
