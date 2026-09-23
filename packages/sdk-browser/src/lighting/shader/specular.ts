export const lightingSpecularShader = `// Fixed low-discrepancy points: no temporal reuse or noise masking in the renderer.
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
}`;
