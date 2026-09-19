/** `hashBits` is murmur3's fmix in GLSL; `triangleHash` (trianglePalette.ts) is the same
 *  mix in WGSL, preceded by an additive input offset. Two languages, two writings. */
export const lightingDirectShader = `uint hashBits(uint x){
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

`;
