import * as THREE from 'three';
import type {BackendFactory} from './backendTypes.ts';
import type {Scene} from '../sdk-core/lightingExperimentScene.ts';

export interface LightingExperimentRayDiagnostics {
 rayTraversal:'brute'|'bvh';
 bvhNodeCount:number;
 /** Packed node payload; not a physical VRAM measurement. */
 bvhNodeBytes:number;
 /** Last render's CPU refit duration; zero when the exhaustive path is active. */
 bvhRefitMs:number;
}

/** Mutable solver output. Array references may be replaced between render calls. */
export interface LightingExperimentRenderState {
 scene:Scene;
 /** Incident irradiance excluding emitted source radiance: pi * T * (L - Le). */
 indirectIrradiance:Float64Array;
 radiance:Float64Array;
 exposure?:number;
 /** Deterministic GGX samples per pixel; integer in [1, 8], default 8. */
 reflectionSamples?:number;
 /** Per-emitter stratified shadow samples. 64 is a reference mode, not a convergence guarantee. */
 directLightSamples?:16|64;
 /** Exhaustive reference stays the default until the host validates its BVH comparison. */
 rayTraversal?:'brute'|'bvh';
 /** Backend-owned output object, reused and updated every render. */
 rayDiagnostics?:LightingExperimentRayDiagnostics;
}

const MAX_SURFACES=256,MAX_CACHE_DIMENSION=4096,MAX_REFLECTION_SAMPLES=8,MAX_EMITTERS=8,MAX_DIRECT_SAMPLES=64;

/** Preorder binary tree; each node stores min.xyz/escape and max.xyz/surface.
 * An internal node has surface=-1 and its first child immediately follows it.
 * Escape indices strictly increase, so a shader visits at most 2*S-1 nodes.
 * The topology is built once; refits use the float32 rectangle records consumed
 * by the shader, preserving moving doors and emitters without rebuilding cuts.
 */
function createRectangleBvh(surfaces:Scene['surfaces']){
 const nodeCount=2*surfaces.length-1,data=new Float32Array(nodeCount*8);
 const rightChildren=new Int32Array(nodeCount).fill(-1);
 const centers=surfaces.map(surface=>surface.origin.map((value,axis)=>value+0.5*(surface.u[axis]+surface.v[axis])));
 if(centers.some(center=>center.some(value=>!Number.isFinite(value))))throw new Error('Lighting experiment BVH requires finite rectangle coordinates');
 let nextNode=0;
 const build=(indices:number[]):number=>{
  const node=nextNode++,offset=node*8;
  if(indices.length===1)data[offset+7]=indices[0];
  else{
   data[offset+7]=-1;
   let axis=0,largestExtent=-1;
   for(let candidate=0;candidate<3;candidate++){
    let minimum=Infinity,maximum=-Infinity;
    for(const index of indices){minimum=Math.min(minimum,centers[index][candidate]);maximum=Math.max(maximum,centers[index][candidate]);}
    if(maximum-minimum>largestExtent){largestExtent=maximum-minimum;axis=candidate;}
   }
   indices.sort((a,b)=>centers[a][axis]-centers[b][axis]||a-b);
   const middle=Math.floor(indices.length/2);
   build(indices.slice(0,middle));rightChildren[node]=build(indices.slice(middle));
  }
  data[offset+3]=nextNode;
  return node;
 };
 build(surfaces.map((_,index)=>index));
 const refit=(surfaceData:Float32Array)=>{
  for(let node=nodeCount-1;node>=0;node--){
   const offset=node*8,surface=data[offset+7];
   if(surface>=0){
    const record=surface*24;
    for(let axis=0;axis<3;axis++){
     const origin=surfaceData[record+axis],u=surfaceData[record+4+axis],v=surfaceData[record+8+axis];
     const low=origin+Math.min(0,u)+Math.min(0,v),high=origin+Math.max(0,u)+Math.max(0,v);
     // The absolute term also thickens planar boxes; the relative term exceeds
     // float32 storage rounding and leaves margin for shader point arithmetic.
     const padding=1e-4+1e-6*Math.max(Math.abs(origin),Math.abs(u),Math.abs(v),Math.abs(low),Math.abs(high));
     data[offset+axis]=low-padding;data[offset+4+axis]=high+padding;
    }
   }else{
    const left=(node+1)*8,right=rightChildren[node]*8;
    for(let axis=0;axis<3;axis++){
     data[offset+axis]=Math.min(data[left+axis],data[right+axis]);
     data[offset+4+axis]=Math.max(data[left+4+axis],data[right+4+axis]);
    }
   }
  }
 };
 return {data,nodeCount,refit};
}

const vertexShader=`
varying vec3 worldPosition;
void main(){
 vec4 world=modelMatrix*vec4(position,1.0);
 worldPosition=world.xyz;
 gl_Position=projectionMatrix*viewMatrix*world;
}`;

function fragmentShader(surfaceCount:number){return `
#define SURFACE_COUNT ${surfaceCount}
#define BVH_NODE_COUNT ${2*surfaceCount-1}
#define MAX_SAMPLES ${MAX_REFLECTION_SAMPLES}
#define MAX_EMITTERS ${MAX_EMITTERS}
#define MAX_DIRECT_SAMPLES ${MAX_DIRECT_SAMPLES}
precision highp float;
uniform highp sampler2D indirectCache;
uniform highp sampler2D surfaceData;
uniform highp sampler2D bvhData;
uniform bool useBvh;
uniform vec2 cacheSize;
uniform vec4 sphere;
uniform float sphereRoughness;
uniform int primarySurface;
uniform int reflectionSamples;
uniform int emitterCount;
uniform int emitterIndices[MAX_EMITTERS];
uniform int directLightSamples;
uniform int directLightGrid;
uniform float experimentExposure;
varying vec3 worldPosition;
const float PI=3.141592653589793;
const float RAY_EPSILON=0.0001;
const vec3 SPECULAR_F0=vec3(0.92);

// Float texture avoids a scene-sized uniform array exceeding WebGL2 limits.
vec4 surfaceRecord(int i,int field){return texelFetch(surfaceData,ivec2(field,i),0);}
float mirrorFlag(int i){return surfaceRecord(i,0).w;}
vec3 surfaceNormal(int i){return normalize(cross(surfaceRecord(i,1).xyz,surfaceRecord(i,2).xyz));}
vec2 surfaceUv(int i,vec3 p){
 vec3 q=p-surfaceRecord(i,0).xyz,u=surfaceRecord(i,1).xyz,v=surfaceRecord(i,2).xyz;
 return vec2(dot(q,u)/dot(u,u),dot(q,v)/dot(v,v));
}
vec3 cacheTexel(vec2 p){return texture2D(indirectCache,(p+0.5)/cacheSize).rgb;}
vec3 rayOrigin(vec3 p,vec3 normal,vec3 direction){
 return p+normal*(dot(normal,direction)>=0.0?2.0*RAY_EPSILON:-2.0*RAY_EPSILON);
}
vec3 cachedIndirectIrradiance(int i,vec3 p){
 // xy: first texel, zw: grid dimensions. Filtering stays within one surface.
 vec4 tile=surfaceRecord(i,5);
 vec2 grid=clamp(surfaceUv(i,p)*tile.zw-0.5,vec2(0.0),tile.zw-1.0);
 vec2 lo=floor(grid),hi=min(lo+1.0,tile.zw-1.0),f=fract(grid);
 vec3 lower=mix(cacheTexel(tile.xy+lo),cacheTexel(tile.xy+vec2(hi.x,lo.y)),f.x);
 vec3 upper=mix(cacheTexel(tile.xy+vec2(lo.x,hi.y)),cacheTexel(tile.xy+hi),f.x);
 return mix(lower,upper,f.y);
}

// Shared intersection arithmetic: nearest-hit for reflections, any-hit for
// opaque shadow segments. Neither path traces a triangle BVH.
bool intersectRectangle(int i,vec3 origin,vec3 direction,float limit,out float distance,out vec3 hit,out vec3 normal){
 vec3 corner=surfaceRecord(i,0).xyz,u=surfaceRecord(i,1).xyz,v=surfaceRecord(i,2).xyz;
 normal=normalize(cross(u,v));
 float denominator=dot(direction,normal);
 if(abs(denominator)<1.0e-7)return false;
 distance=dot(corner-origin,normal)/denominator;
 if(distance<=RAY_EPSILON||distance>=limit)return false;
 hit=origin+direction*distance;
 vec3 q=hit-corner;
 vec2 uv=vec2(dot(q,u)/dot(u,u),dot(q,v)/dot(v,v));
 return !any(lessThan(uv,vec2(0.0)))&&!any(greaterThan(uv,vec2(1.0)));
}

float intersectSphere(vec3 origin,vec3 direction,float limit){
 vec3 oc=origin-sphere.xyz;
 float b=dot(oc,direction),c=dot(oc,oc)-sphere.w*sphere.w;
 float discriminant=b*b-c;
 if(discriminant>=0.0){
  float distance=-b-sqrt(discriminant);
  if(distance<=RAY_EPSILON)distance=-b+sqrt(discriminant);
  if(distance>RAY_EPSILON&&distance<limit)return distance;
 }
 return limit;
}

vec3 inverseRayDirection(vec3 direction){
 vec3 inverseDirection=vec3(0.0);
 for(int axis=0;axis<3;axis++)if(abs(direction[axis])>=1.0e-19)inverseDirection[axis]=1.0/direction[axis];
 return inverseDirection;
}

bool intersectsBounds(vec3 low,vec3 high,vec3 origin,vec3 direction,vec3 inverseDirection,float limit){
 float nearDistance=RAY_EPSILON,farDistance=limit;
 for(int axis=0;axis<3;axis++){
  if(direction[axis]==0.0){
   if(origin[axis]<low[axis]||origin[axis]>high[axis])return false;
  }else if(abs(direction[axis])>=1.0e-19){
   float a=(low[axis]-origin[axis])*inverseDirection[axis],b=(high[axis]-origin[axis])*inverseDirection[axis];
   nearDistance=max(nearDistance,min(a,b));farDistance=min(farDistance,max(a,b));
   if(nearDistance>farDistance)return false;
  }
  // An extremely small nonzero direction leaves this axis unconstrained.
  // This only admits extra candidates, avoiding overflow and 0*infinity NaNs.
 }
 return true;
}

bool intersectScene(vec3 origin,vec3 direction,float limit,out int object,out vec3 p,out vec3 n){
 float closest=limit;
 object=-2;
 if(useBvh){
  vec3 inverseDirection=inverseRayDirection(direction);
  int node=0;
  for(int visit=0;visit<BVH_NODE_COUNT;visit++){
   if(node>=BVH_NODE_COUNT)break;
   vec4 low=texelFetch(bvhData,ivec2(0,node),0),high=texelFetch(bvhData,ivec2(1,node),0);
   if(!intersectsBounds(low.xyz,high.xyz,origin,direction,inverseDirection,closest)){node=int(low.w);continue;}
   int i=int(high.w);
   if(i>=0){
    float distance;vec3 hit;vec3 normal;
    // Use the ORIGINAL limit so an equal-distance lower index remains eligible.
    if(intersectRectangle(i,origin,direction,limit,distance,hit,normal)&&
     (distance<closest||(distance==closest&&(object<0||i<object)))){
     closest=distance;object=i;p=hit;n=normal;
    }
   }
   node++;
  }
 }else{
  for(int i=0;i<SURFACE_COUNT;i++){
   float distance;vec3 hit;vec3 normal;
   if(intersectRectangle(i,origin,direction,closest,distance,hit,normal)){
    closest=distance;object=i;p=hit;n=normal;
   }
  }
 }
 // Strict inequality retains the rectangle when the sphere has an equal hit.
 float distance=intersectSphere(origin,direction,closest);
 if(distance<closest){object=-1;p=origin+direction*distance;n=normalize(p-sphere.xyz);}
 return object!=-2;
}

bool shadowBlocked(vec3 origin,vec3 direction,float limit){
 if(intersectSphere(origin,direction,limit)<limit)return true;
 if(useBvh){
  vec3 inverseDirection=inverseRayDirection(direction);
  int node=0;
  for(int visit=0;visit<BVH_NODE_COUNT;visit++){
   if(node>=BVH_NODE_COUNT)break;
   vec4 low=texelFetch(bvhData,ivec2(0,node),0),high=texelFetch(bvhData,ivec2(1,node),0);
   if(!intersectsBounds(low.xyz,high.xyz,origin,direction,inverseDirection,limit)){node=int(low.w);continue;}
   int i=int(high.w);
   if(i>=0){
    float distance;vec3 hit;vec3 normal;
    if(intersectRectangle(i,origin,direction,limit,distance,hit,normal))return true;
   }
   node++;
  }
 }else{
  for(int i=0;i<SURFACE_COUNT;i++){
   float distance;vec3 hit;vec3 normal;
   if(intersectRectangle(i,origin,direction,limit,distance,hit,normal))return true;
  }
 }
 return false;
}

uint hashBits(uint x){
 x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;
 return x;
}

vec2 directJitter(int receiver,int emitter,int sampleIndex){
 uvec2 pixel=uvec2(gl_FragCoord.xy);
 uint seed=hashBits(pixel.x^hashBits(pixel.y+0x9e3779b9u));
 seed=hashBits(seed^((uint(receiver)+1u)*0x85ebca6bu));
 seed=hashBits(seed^((uint(emitter)+1u)*0xc2b2ae35u));
 seed=hashBits(seed^((uint(sampleIndex)+1u)*0x68bc21ebu));
 return vec2(float(seed&0x00ffffffu),float(hashBits(seed^0x02e5be93u)&0x00ffffffu))/16777216.0;
}

// One jittered sample per stratum, fixed per pixel/receiver/STABLE source index.
// No frame seed, blur, or temporal accumulation. Decorrelation changes bands
// into spatial noise; it does not establish converged integration.
vec3 directIrradiance(int receiver,vec3 p){
 vec3 result=vec3(0.0),normal=surfaceNormal(receiver);
 for(int light=0;light<MAX_EMITTERS;light++){
  if(light>=emitterCount)break;
  int emitter=emitterIndices[light];
  if(emitter==receiver)continue;
  vec3 corner=surfaceRecord(emitter,0).xyz,u=surfaceRecord(emitter,1).xyz,v=surfaceRecord(emitter,2).xyz;
  vec3 lightNormal=normalize(cross(u,v));
  vec3 emission=surfaceRecord(emitter,4).xyz;
  float sampleArea=length(cross(u,v))/float(directLightSamples);
  for(int sampleIndex=0;sampleIndex<MAX_DIRECT_SAMPLES;sampleIndex++){
   if(sampleIndex>=directLightSamples)break;
   int row=sampleIndex/directLightGrid,column=sampleIndex-row*directLightGrid;
   vec2 uv=(vec2(float(column),float(row))+directJitter(receiver,emitter,sampleIndex))/float(directLightGrid);
   vec3 target=corner+u*uv.x+v*uv.y,toLight=target-p;
   float distanceSquared=dot(toLight,toLight);
   if(distanceSquared<16.0*RAY_EPSILON*RAY_EPSILON)continue;
   vec3 direction=toLight*inversesqrt(distanceSquared);
   float cosine=max(dot(normal,direction),0.0),lightCosine=max(dot(lightNormal,-direction),0.0);
   if(cosine<=0.0||lightCosine<=0.0)continue;
   vec3 start=rayOrigin(p,normal,direction),segment=target-start;
   float segmentLength=length(segment);
   if(!shadowBlocked(start,segment/segmentLength,segmentLength-2.0*RAY_EPSILON)){
    result+=emission*(cosine*lightCosine*sampleArea/distanceSquared);
   }
  }
 }
 return result;
}

vec3 surfaceRadiance(int i,vec3 p){
 vec3 irradiance=cachedIndirectIrradiance(i,p)+directIrradiance(i,p);
 return surfaceRecord(i,4).xyz+surfaceRecord(i,3).xyz*irradiance/PI;
}

// Fixed low-discrepancy points: no temporal reuse or noise masking in the renderer.
vec2 samplePoint(int sampleIndex,int bounce){
 float k=float(sampleIndex);
 return vec2((k+0.5)/float(reflectionSamples),fract(k*0.618033988749895+float(bounce)*0.381966011250105));
}

// GGX NDF half-vector sampling. Weight = f * NoL / pdf; rejected directions
// contribute zero. Roughness is perceptual, alpha = roughness^2. No IBL term.
bool scatterMetal(vec3 incoming,vec3 normal,float roughness,vec2 xi,out vec3 outgoing,out vec3 weight){
 vec3 view=-incoming;
 float noV=dot(normal,view);
 if(noV<=0.0)return false;
 if(roughness<0.001){
  outgoing=reflect(incoming,normal);
  weight=SPECULAR_F0+(1.0-SPECULAR_F0)*pow(1.0-noV,5.0);
  return true;
 }
 float alpha=roughness*roughness,a2=alpha*alpha;
 float cosTheta=sqrt((1.0-xi.x)/(1.0+(a2-1.0)*xi.x));
 float sinTheta=sqrt(max(0.0,1.0-cosTheta*cosTheta));
 float phi=2.0*PI*xi.y;
 vec3 tangent=normalize(cross(abs(normal.z)<0.999?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0),normal));
 vec3 halfVector=normalize(tangent*(sinTheta*cos(phi))+cross(normal,tangent)*(sinTheta*sin(phi))+normal*cosTheta);
 float voH=dot(view,halfVector),noH=max(dot(normal,halfVector),0.0);
 if(voH<=0.0||noH<=0.0)return false;
 outgoing=reflect(incoming,halfVector);
 float noL=dot(normal,outgoing);
 if(noL<=0.0)return false;
 float smithDenominator=noL*sqrt(noV*noV*(1.0-a2)+a2)+noV*sqrt(noL*noL*(1.0-a2)+a2);
 float geometry=2.0*noL*noV/max(smithDenominator,1.0e-8);
 vec3 fresnel=SPECULAR_F0+(1.0-SPECULAR_F0)*pow(1.0-voH,5.0);
 weight=fresnel*(geometry*voH/max(noV*noH,1.0e-8));
 return true;
}

vec3 traceRadiance(vec3 origin,vec3 direction,int sampleIndex,int usedInteractions){
 vec3 throughput=vec3(1.0);
 // Three total specular interactions, including the visible primary surface.
 // The fourth intersection may terminate on a diffuse or emissive surface.
 for(int bounce=0;bounce<4;bounce++){
  int object;vec3 p;vec3 normal;
  if(!intersectScene(origin,direction,1.0e20,object,p,normal))return vec3(0.0);
  if(object>=0&&mirrorFlag(object)<0.5){
   if(dot(normal,-direction)<=0.0)return vec3(0.0);
   return throughput*surfaceRadiance(object,p);
  }
  if(usedInteractions+bounce>=3)return vec3(0.0);
  if(dot(normal,-direction)<0.0)normal=-normal;
  if(object>=0){
   // Mirror reflectance is independent of its zero diffuse transport albedo.
   throughput*=SPECULAR_F0;
   direction=reflect(direction,normal);
  }else{
   vec3 outgoing;vec3 weight;
   if(!scatterMetal(direction,normal,sphereRoughness,samplePoint(sampleIndex,bounce+1),outgoing,weight))return vec3(0.0);
   throughput*=weight;direction=outgoing;
  }
  origin=rayOrigin(p,normal,direction);
 }
 return vec3(0.0);
}

void main(){
 vec3 incoming=normalize(worldPosition-cameraPosition);
 vec3 point=worldPosition;
 if(primarySurface<0){
  // Rasterized sphere triangles are chords INSIDE the analytic sphere. Start
  // at the exact camera-ray hit, otherwise the reflected ray hits itself.
  vec3 oc=cameraPosition-sphere.xyz;
  float b=dot(oc,incoming),discriminant=b*b-dot(oc,oc)+sphere.w*sphere.w;
  float distance=-b-sqrt(max(discriminant,0.0));
  if(distance<=RAY_EPSILON)distance=-b+sqrt(max(discriminant,0.0));
  point=cameraPosition+incoming*distance;
 }
 vec3 linearRadiance=vec3(0.0);
 if(primarySurface>=0&&mirrorFlag(primarySurface)<0.5){
  if(dot(surfaceNormal(primarySurface),-incoming)>0.0)linearRadiance=surfaceRadiance(primarySurface,worldPosition);
 }else{
  vec3 normal=primarySurface<0?normalize(point-sphere.xyz):surfaceNormal(primarySurface);
  if(dot(normal,-incoming)<0.0)normal=-normal;
  for(int sampleIndex=0;sampleIndex<MAX_SAMPLES;sampleIndex++){
   if(sampleIndex>=reflectionSamples)break;
   vec3 outgoing;vec3 weight;
   if(primarySurface>=0){outgoing=reflect(incoming,normal);weight=SPECULAR_F0;}
   else if(!scatterMetal(incoming,normal,sphereRoughness,samplePoint(sampleIndex,0),outgoing,weight))continue;
   linearRadiance+=weight*traceRadiance(rayOrigin(point,normal,outgoing),outgoing,sampleIndex,1);
  }
  linearRadiance/=float(reflectionSamples);
 }
 gl_FragColor=vec4(max(linearRadiance,vec3(0.0))*experimentExposure,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;}

/**
 * Observation backend for the transport experiment. Rasterizes prepared source
 * meshes; visibility for reflections is restricted to the declared rectangles
 * and sphere. It does not exercise cluster selection or general mesh tracing.
 */
export function createLightingExperimentBackend(state:LightingExperimentRenderState):BackendFactory{
 return ({source,signal,onDiagnostic})=>{
  const domain=state.scene,surfaceCount=domain.surfaces.length;
  if(surfaceCount<1||surfaceCount>MAX_SURFACES)throw new Error(`Lighting experiment requires 1..${MAX_SURFACES} surfaces`);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x000000);
  const patchOffsets:number[]=[],tileOffsets:number[]=[];
  let patchCount=0,atlasWidth=1,atlasHeight=0;
  const expectedIds=domain.surfaces.map(surface=>surface.id);
  const shapes=domain.surfaces.map(surface=>[surface.columns,surface.rows] as const);
  for(const surface of domain.surfaces){
   if(!Number.isInteger(surface.columns)||!Number.isInteger(surface.rows)||surface.columns<1||surface.rows<1)throw new Error('Invalid lighting experiment patch grid');
   patchOffsets.push(patchCount);tileOffsets.push(atlasHeight);
   patchCount+=surface.columns*surface.rows;
   atlasWidth=Math.max(atlasWidth,surface.columns);atlasHeight+=surface.rows;
  }
  if(atlasWidth>MAX_CACHE_DIMENSION||atlasHeight>MAX_CACHE_DIMENSION)throw new Error('Lighting experiment cache exceeds the declared texture bound');
  if(domain.patches.length!==patchCount)throw new Error('Lighting experiment patch grid does not match scene patches');
  const texels=new Float32Array(atlasWidth*atlasHeight*4);
  const texture=new THREE.DataTexture(texels,atlasWidth,atlasHeight,THREE.RGBAFormat,THREE.FloatType);
  texture.minFilter=THREE.NearestFilter;texture.magFilter=THREE.NearestFilter;
  texture.wrapS=THREE.ClampToEdgeWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.generateMipmaps=false;texture.flipY=false;texture.colorSpace=THREE.NoColorSpace;
  const surfaceTexels=new Float32Array(surfaceCount*6*4);
  const surfaceTexture=new THREE.DataTexture(surfaceTexels,6,surfaceCount,THREE.RGBAFormat,THREE.FloatType);
  surfaceTexture.minFilter=THREE.NearestFilter;surfaceTexture.magFilter=THREE.NearestFilter;
  surfaceTexture.generateMipmaps=false;surfaceTexture.flipY=false;surfaceTexture.colorSpace=THREE.NoColorSpace;
  const bvh=createRectangleBvh(domain.surfaces);
  const bvhTexture=new THREE.DataTexture(bvh.data,2,bvh.nodeCount,THREE.RGBAFormat,THREE.FloatType);
  bvhTexture.minFilter=THREE.NearestFilter;bvhTexture.magFilter=THREE.NearestFilter;
  bvhTexture.generateMipmaps=false;bvhTexture.flipY=false;bvhTexture.colorSpace=THREE.NoColorSpace;
  bvhTexture.needsUpdate=true;
  const rayDiagnostics:LightingExperimentRayDiagnostics={rayTraversal:'brute',bvhNodeCount:bvh.nodeCount,bvhNodeBytes:bvh.data.byteLength,bvhRefitMs:0};
  state.rayDiagnostics=rayDiagnostics;
  const uniforms={
   indirectCache:{value:texture},cacheSize:{value:new THREE.Vector2(atlasWidth,atlasHeight)},
   surfaceData:{value:surfaceTexture},
   sphere:{value:new THREE.Vector4()},sphereRoughness:{value:0},
   reflectionSamples:{value:8},experimentExposure:{value:1},
   emitterCount:{value:0},emitterIndices:{value:new Int32Array(MAX_EMITTERS)},
   directLightSamples:{value:16},directLightGrid:{value:4},
   bvhData:{value:bvhTexture},useBvh:{value:false},
  };
  const shader=fragmentShader(surfaceCount);
  const materials:THREE.ShaderMaterial[]=[];
  const copies:{mesh:THREE.Mesh;surface:number;restTransform:THREE.Matrix4}[]=[];
  const geometrySet=new Set<THREE.BufferGeometry>();
  const basis=new THREE.Matrix4(),normal=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3();
  const surfaceBasis=(i:number,target:THREE.Matrix4)=>{
   const surface=state.scene.surfaces[i];
   u.fromArray(surface.u);v.fromArray(surface.v);normal.crossVectors(u,v);
   const area=normal.length();
   if(!Number.isFinite(area)||area<=1e-12||Math.abs(u.dot(v))>1e-6*u.length()*v.length())throw new Error('Lighting experiment tracing requires finite orthogonal rectangle edges');
   normal.multiplyScalar(1/area);target.makeBasis(u,v,normal);
   target.setPosition(surface.origin[0],surface.origin[1],surface.origin[2]);
   return target;
  };
  const sphereBasis=(target:THREE.Matrix4)=>{
   const sphere=state.scene.sphere;
   if(!sphere)throw new Error('Lighting experiment observation requires the declared sphere');
   if(!Number.isFinite(sphere.radius)||sphere.radius<=0)throw new Error('Invalid lighting experiment sphere radius');
   target.makeScale(sphere.radius,sphere.radius,sphere.radius);
   return target.setPosition(sphere.center[0],sphere.center[1],sphere.center[2]);
  };
  let triangles=0,geometryAllocationBytes=0,disposed=false;
  source.updateMatrixWorld(true);
  const sourceMeshes:THREE.Mesh[]=[];
  source.traverse(object=>{if((object as THREE.Mesh).isMesh)sourceMeshes.push(object as THREE.Mesh);});
  const indices=sourceMeshes.map(mesh=>{
   const i=expectedIds.indexOf(mesh.name);
   if(i<0&&mesh.name!=='glossy_sphere')throw new Error(`Unknown source mesh in lighting experiment: ${mesh.name}`);
   return i;
  });
  for(let i=-1;i<surfaceCount;i++)if(indices.filter(index=>index===i).length!==1)throw new Error(`Lighting experiment requires one source mesh for ${i<0?'glossy_sphere':expectedIds[i]}`);
  try{
   for(let meshIndex=0;meshIndex<sourceMeshes.length;meshIndex++){
    const original=sourceMeshes[meshIndex],surface=indices[meshIndex];
    const geometry=original.geometry.clone();geometrySet.add(geometry);
    const material=new THREE.ShaderMaterial({
     name:'lighting-experiment-cache',vertexShader,fragmentShader:shader,
     uniforms:{...uniforms,primarySurface:{value:surface}},
     side:THREE.DoubleSide,transparent:false,depthTest:true,depthWrite:true,toneMapped:true,
    });
    materials.push(material);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=original.name;
    mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;mesh.matrix.copy(original.matrixWorld);
    mesh.renderOrder=meshIndex;scene.add(mesh);
    const restTransform=(surface>=0?surfaceBasis(surface,basis):sphereBasis(basis)).clone().invert().multiply(original.matrixWorld);
    copies.push({mesh,surface,restTransform});
    const index=geometry.getIndex(),position=geometry.getAttribute('position');
    triangles+=(index?index.count:position.count)/3;
    if(index)geometryAllocationBytes+=index.array.byteLength;
    const counted=new Set<ArrayBufferView>();
    for(const attribute of Object.values(geometry.attributes)){
     const array=attribute instanceof THREE.InterleavedBufferAttribute?attribute.data.array:attribute.array;
     if(!counted.has(array)){counted.add(array);geometryAllocationBytes+=array.byteLength;}
    }
   }
  }catch(error){materials.forEach(material=>material.dispose());geometrySet.forEach(geometry=>geometry.dispose());texture.dispose();surfaceTexture.dispose();bvhTexture.dispose();throw error;}

  const update=()=>{
   if(disposed)throw new Error('Lighting experiment backend is disposed');
   signal?.throwIfAborted();
   const current=state.scene;
   if(current.surfaces.length!==surfaceCount||current.patches.length!==patchCount)throw new Error('Lighting experiment topology cannot change after creation');
   if(state.indirectIrradiance.length!==patchCount*3||state.radiance.length!==patchCount*3)throw new Error('Lighting experiment solver cache size mismatch');
   const samples=state.reflectionSamples??MAX_REFLECTION_SAMPLES,directSamples=state.directLightSamples??16,exposure=state.exposure??1;
   if(!Number.isInteger(samples)||samples<1||samples>MAX_REFLECTION_SAMPLES)throw new Error('Lighting experiment reflectionSamples must be an integer from 1 to 8');
   if(!Number.isFinite(exposure)||exposure<=0)throw new Error('Lighting experiment exposure must be finite and positive');
   if(directSamples!==16&&directSamples!==64)throw new Error('Lighting experiment directLightSamples must be 16 or 64');
   const rayTraversal=state.rayTraversal??'brute';
   if(rayTraversal!=='brute'&&rayTraversal!=='bvh')throw new Error('Lighting experiment rayTraversal must be brute or bvh');
   uniforms.reflectionSamples.value=samples;uniforms.experimentExposure.value=exposure;
   uniforms.directLightSamples.value=directSamples;uniforms.directLightGrid.value=directSamples===16?4:8;
   uniforms.useBvh.value=rayTraversal==='bvh';rayDiagnostics.rayTraversal=rayTraversal;rayDiagnostics.bvhRefitMs=0;
   uniforms.emitterCount.value=0;
   for(let i=0;i<surfaceCount;i++){
    const surface=current.surfaces[i];
    if(surface.id!==expectedIds[i]||surface.columns!==shapes[i][0]||surface.rows!==shapes[i][1])throw new Error('Lighting experiment surface identity and grid must remain stable');
    const record=i*24;
    surfaceTexels.set(surface.origin,record);surfaceTexels[record+3]=surface.kind==='mirror'?1:0;
    surfaceTexels.set(surface.u,record+4);surfaceTexels.set(surface.v,record+8);
    surfaceTexels.set(surface.albedo,record+12);surfaceTexels.set(surface.emission,record+16);
    if(surface.emission.some(value=>value>0)){
     if(uniforms.emitterCount.value>=MAX_EMITTERS)throw new Error(`Lighting experiment supports at most ${MAX_EMITTERS} area emitters`);
     uniforms.emitterIndices.value[uniforms.emitterCount.value++]=i;
    }
    surfaceTexels[record+20]=0;surfaceTexels[record+21]=tileOffsets[i];
    surfaceTexels[record+22]=surface.columns;surfaceTexels[record+23]=surface.rows;
    for(let row=0;row<surface.rows;row++)for(let column=0;column<surface.columns;column++){
     const input=(patchOffsets[i]+row*surface.columns+column)*3;
     const output=((tileOffsets[i]+row)*atlasWidth+column)*4;
     for(let channel=0;channel<3;channel++){
      const value=state.indirectIrradiance[input+channel];
      if(!Number.isFinite(value)||value<0)throw new Error('Lighting experiment indirect irradiance must be finite and nonnegative');
      texels[output+channel]=value;
     }
     texels[output+3]=1;
    }
   }
   const sphere=current.sphere;
   if(!sphere)throw new Error('Lighting experiment observation requires the declared sphere');
   if(!Number.isFinite(sphere.roughness)||sphere.roughness<0||sphere.roughness>1)throw new Error('Lighting experiment sphere roughness must lie in [0, 1]');
   uniforms.sphere.value.set(sphere.center[0],sphere.center[1],sphere.center[2],sphere.radius);
   uniforms.sphereRoughness.value=sphere.roughness;
   for(const copy of copies){
    if(copy.surface>=0)surfaceBasis(copy.surface,basis);else sphereBasis(basis);
    copy.mesh.matrix.multiplyMatrices(basis,copy.restTransform);copy.mesh.matrixWorldNeedsUpdate=true;
   }
   if(uniforms.useBvh.value){
    const refitStart=performance.now();
    bvh.refit(surfaceTexels);
    rayDiagnostics.bvhRefitMs=performance.now()-refitStart;
    bvhTexture.needsUpdate=true;
   }
   texture.needsUpdate=true;surfaceTexture.needsUpdate=true;
  };
  return {
   id:'lighting-experiment-webgl2',scene,overBudget:false,
   capabilities:{renderer:'Three.js WebGL2 analytic transport experiment',materials:'Indirect irradiance cache plus per-pixel area-light visibility (16 or 64 stratified samples) and emission; mirror reflectance 0.92; metal GGX F0 0.92; full source meshes',hierarchy:false,gpuDriven:false,simplification:false,eviction:false,
    unsupported:['general triangle ray tracing','WebGPU implementation','cluster selection and streaming performance','specular transport back into the diffuse solver','more than three specular interactions (black termination)','environment outside declared scene (black)','converged glossy integration (1..8 deterministic GGX samples)','converged soft shadows (16/64 stratified samples retain spatial noise)','cancellation within a submitted GPU draw','transparent materials','physical VRAM instrumentation']},
   async prepare(){
    update();
    onDiagnostic?.({phase:'lighting-experiment',message:'Analytic rectangle/sphere observation with per-pixel direct visibility and indirect cache',context:{surfaceCount,patchCount,triangles,cacheBytes:texels.byteLength,surfaceDataBytes:surfaceTexels.byteLength,cacheFiltering:'manual bilinear indirect irradiance at patch centers',diffuse:'emission + albedo * (indirect cache + per-pixel direct irradiance) / pi',directLightSamples:uniforms.directLightSamples.value,directLightSampling:'stratified jitter from pixel, receiver, stable emitter index and sample; no temporal seed',shadowTraversal:'opaque any-hit; exhaustive reference or refitted rectangle AABB BVH',...rayDiagnostics,bvhBounds:'float32 rectangle coordinates; expanded by 1e-4 + 1e-6 * coordinate scale',bvhUpdate:'fixed median topology; bottom-up refit only in BVH mode',directReferenceConverged:false,maxEmitters:MAX_EMITTERS,maxSpecularInteractions:3,reflectionSamples:uniforms.reflectionSamples.value,specularF0:0.92,primarySphereHit:'analytic camera ray; normal-offset secondary origin',fullSourceGeometry:true}});
   },
   render(){update();},
   metrics:()=>({clusters:null,selectedTriangles:triangles,submittedTriangles:triangles,totalSubmittedTriangles:triangles,residentPages:null,geometryAllocationBytes,pagesDetached:0,frustumRejected:0,lodLevel:null,drawCalls:copies.length,coverageReady:true,coverageBudgetLimited:false,transparentMeshes:0,transparentDrawCalls:0,transparentSubmittedTriangles:0}),
   dispose(){if(disposed)return;disposed=true;materials.forEach(material=>material.dispose());geometrySet.forEach(geometry=>geometry.dispose());texture.dispose();surfaceTexture.dispose();bvhTexture.dispose();scene.clear();},
  };
 };
}
