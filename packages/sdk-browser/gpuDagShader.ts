import { DAG_ERROR_WGSL } from './gpuDagShaderError.ts';
import { INVERSE_TRANSPOSE_WGSL } from './inverseTransposeWgsl.ts';
import { DAG_COMPACT_WGSL } from './gpuDagCompactWgsl.ts';
import { DAG_LIVE_WGSL } from './gpuDagLiveWgsl.ts';
import { DAG_LEVEL_WGSL } from './gpuDagLevelWgsl.ts';
import { DAG_RECORD_WGSL } from './gpuDagRecordWgsl.ts';
import { ESCALATION_SLACK } from './pageSelectionTypes.ts';
import { CLUSTER_LEVEL_SHIFT } from './gpuDagLayout.ts';

export const DAG_SELECTION_SHADER = `struct Cluster{sphere:vec4f,parentSphere:vec4f,lodError:f32,parentError:f32,worldIndex:u32,flags:u32,}
struct CullNode{minimum:vec3f,firstChild:u32,maximum:vec3f,maxParentError:f32,sphere:vec4f,worldIndex:u32,firstPage:u32,pageCount:u32,childCount:u32,}
struct Uniforms{planes:array<vec4f,6>,view:mat4x4f,pixelScale:vec2f,pixelError:f32,near:f32,clusterCount:u32,nodeCount:u32,worldCount:u32,residentCut:u32,cameraWorld:vec3f,cameraStretch:f32,}
struct Output{count:atomic<u32>,frustumRejected:atomic<u32>,lodLevel:atomic<u32>,overflow:atomic<u32>,pages:array<u32>,}
@group(0) @binding(0) var<storage, read> clusters:array<Cluster>;
@group(0) @binding(1) var<storage, read> nodes:array<CullNode>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
@group(0) @binding(3) var<storage, read_write> flags:array<u32>;
@group(0) @binding(4) var<storage, read_write> out:Output;
@group(0) @binding(5) var<storage, read_write> work:array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> worlds:array<mat4x4f>;
@group(0) @binding(7) var<storage, read_write> frames:array<vec4f>;
@group(0) @binding(8) var<storage, read> cold:array<u32>;
/** A WGSL const-expression may not be infinite, so the unreachable band uses the largest f32:
 *  every comparison below behaves exactly as the CPU cut's Infinity for any finite threshold. */
const INF:f32=3.4e38;
const FRAME:u32=7u;
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
 if(hasBox(index)==0.0){return false;}
 return coneRejectsBox(coneOf(index),boxMin(index),boxMax(index),worlds[cluster.worldIndex]);
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
 return !outsideFrustum(cluster.worldIndex*FRAME,boxMin(index),boxMax(index));
}
fn stretchOf(world:u32)->f32{return frames[world*FRAME+6u].x*uni.cameraStretch;}
fn emitOne(page:u32){
 let cap=uni.clusterCount;
 let slot=atomicAdd(&out.count,1u);
 if(slot>=cap){atomicStore(&out.overflow,1u);return;}
 out.pages[slot]=page;
}
/** Raise the primitive's threshold to the replacement band, or demand the pinned cover.
 *  Le seuil est posé STRICTEMENT au-dessus de l'erreur du parent (marge \`ESCALATION_SLACK\`) : les
 *  passes qui le relisent recalculent cette erreur dans un autre point d'entrée, où le pilote ne
 *  rend pas le même f32 au dernier bit près. Une égalité exacte y laissait le cluster absent
 *  retenu par \`dagMask\` — page non résidente dessinée, donc couverture déclarée incomplète. */
fn escalate(world:u32,parentPixels:f32){
 let raised=parentPixels*${ESCALATION_SLACK};
 if(parentPixels>0.0&&raised<INF){atomicMax(&work[world],bitcast<u32>(raised));}
 else{atomicOr(&work[uni.worldCount+world],1u);}
}
/** La remise à zéro et les plans par primitive : deux noyaux hier, un seul lancement aujourd'hui.
 *  Rien ne les liait — le premier écrit les seuils, les compteurs de sortie et les comptes de bloc,
 *  le second les plans du tronc —, et seule la descente, qui suit, lit ce que le second écrit. Les
 *  comptes de bloc de la compaction sont remis à zéro ici parce que \`dagMask\` les accumule, et la
 *  file de la passe 0 reçoit la racine de chaque primitive. */
@compute @workgroup_size(64)
fn dagPrepare(@builtin(global_invocation_id) id:vec3u){
 let w=id.x;
 if(w==0u){atomicStore(&out.count,0u);atomicStore(&out.frustumRejected,0u);atomicStore(&out.lodLevel,0u);atomicStore(&out.overflow,0u);resetCounters();}
 if(w<blockCount()){atomicStore(&work[blockBase()+w],0u);}
 if(w>=uni.worldCount){return;}
 // La racine de la primitive ouvre la descente : un fil, une racine, aucun compteur à disputer.
 flags[queueBase(0u)+w]=rootOf(w);
 atomicStore(&work[w],bitcast<u32>(max(uni.pixelError,0.0)));
 atomicStore(&work[uni.worldCount+w],0u);
 let t=transpose(worlds[w]);let base=w*FRAME;
 for(var i=0u;i<6u;i++){frames[base+i]=t*uni.planes[i];}
}
@compute @workgroup_size(64)
fn dagWanted(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=atomicLoad(&work[candCounter()])){return;}
 // Seules les pages des feuilles retenues : une page sous un nœud rejeté n'est jamais lue, et son
 // drapeau de dessin vaut déjà zéro — \`dagClearDrawn\` a effacé les seules qui valaient un.
 let i=flags[candBase()+s];
 let cluster=clusters[i];
 if(!visible(i,cluster)){atomicAdd(&out.frustumRejected,1u);return;}
 liveAppend(i);
 let rejected=coneRejects(i,cluster);
 flags[coneCache(i)]=select(0u,1u,rejected);
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,uni.pixelError)){return;}
 if(rejected){return;}
 atomicMax(&out.lodLevel,cluster.flags>>${CLUSTER_LEVEL_SHIFT}u);
 emitOne(i);
 if(uni.residentCut==0u||isResident(i)){return;}
 escalate(w,projected(cluster.parentError,cluster.parentSphere,e,stretch,focal));
}
@compute @workgroup_size(64)
fn dagEscalate(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()||uni.residentCut==0u){return;}
 let i=liveAt(s);
 if(isResident(i)){return;}
 let cluster=clusters[i];
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[w])))){return;}
 if(coneRejected(i)){return;}
 escalate(w,projected(cluster.parentError,cluster.parentSphere,e,stretch,focal));
}
@compute @workgroup_size(64)
fn dagCheck(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()||uni.residentCut==0u){return;}
 let i=liveAt(s);
 if(isResident(i)){return;}
 let cluster=clusters[i];
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[w])))){return;}
 if(coneRejected(i)){return;}
 atomicOr(&work[uni.worldCount+w],1u);
}
@compute @workgroup_size(64)
fn dagMask(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()){return;}
 let i=liveAt(s);
 let cluster=clusters[i];
 var draw=false;
 if(!coneRejected(i)){
  let w=cluster.worldIndex;
  if(uni.residentCut!=0u&&atomicLoad(&work[uni.worldCount+w])!=0u){
   // No resident ancestor replaces the missing cluster: this primitive falls back to its pinned roots.
   draw=(cluster.flags&1u)!=0u;
   if(draw&&!isResident(i)){atomicOr(&out.overflow,2u);draw=false;}
  }else{
   let e=uni.view*worlds[w];
   let threshold=select(uni.pixelError,bitcast<f32>(atomicLoad(&work[w])),uni.residentCut!=0u);
   draw=selects(cluster,e,stretchOf(w),focalPixels(),threshold);
   if(draw&&uni.residentCut!=0u&&!isResident(i)){atomicOr(&out.overflow,2u);draw=false;}
  }
 }
 let posee=select(0u,1u,draw);
 flags[uni.nodeCount+i]=posee;
 // Le compte de dessinées du bloc de cette page, tenu ici plutôt que relu ensuite page par page.
 if(posee!=0u){atomicAdd(&work[blockBase()+i/BLOCK],1u);drawnAppend(i);}
}
${DAG_ERROR_WGSL}
${INVERSE_TRANSPOSE_WGSL}
${DAG_COMPACT_WGSL}
${DAG_LIVE_WGSL}
${DAG_LEVEL_WGSL}
${DAG_RECORD_WGSL}`;
