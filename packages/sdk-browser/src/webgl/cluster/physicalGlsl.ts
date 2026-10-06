import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import { PHYSICAL_MAPS_GLSL } from './physicalMapsShader.ts'

/** Anisotropic GGX and a dielectric clear coat, from the Khronos material extension
 * equations. The frame follows the engine's UV derivatives; zero strength preserves the
 * isotropic path. https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos */
export const PHYSICAL_GLSL = `
uniform vec4 physical;uniform vec2 coatNormalScale;vec4 physicalRead;
${PHYSICAL_MAPS_GLSL}
vec3 anisotropyT,anisotropyB,coatNormal;
void physicalFrame(vec3 N){
 physicalRead=physical;
 if(physicalMapInfo[0].x>0){
  vec3 mapped=physicalMap(0).rgb;vec2 direction=mapped.rg*2.0-1.0;
  physicalRead.x*=mapped.b;
  if(dot(direction,direction)>0.0)physicalRead.y+=atan(direction.y,direction.x);
 }
 if(physicalMapInfo[1].x>0)physicalRead.z*=physicalMap(1).r;
 if(physicalMapInfo[2].x>0)physicalRead.w=clamp(physical.w*physicalMap(2).g,${ROUGHNESS_FLOOR},1.0);
 if(physicalMapInfo[3].x>0){
  vec2 uv=mapUv(physicalMapUv[3],sourceUv(physicalMapChannels.w));
  vec3 mapped=physicalMap(3).xyz*2.0-1.0;mapped.xy*=coatNormalScale;
  CotangentFrame coat=cotangentFrame(coatNormal,dFdx(viewPosition),dFdy(viewPosition),dFdx(uv),dFdy(uv));
  float face=faceSides==2&&!flatShaded?(gl_FrontFacing?1.0:-1.0):1.0;
  coatNormal=normalize(coat.T*face*mapped.x+coat.B*face*mapped.y+coatNormal*mapped.z);
 }
 // The frame serves the anisotropic lobes alone, which read it only when physicalRead.x > 0: never
 // without a positive strength factor. A uniform branch, so its derivatives stay defined.
 if(!(physical.x>0.0))return;
 CotangentFrame frame=cotangentFrame(N,dFdx(viewPosition),dFdy(viewPosition),dFdx(texcoord0),dFdy(texcoord0));
 vec3 T=frame.T-N*dot(N,frame.T);
 if(dot(T,T)<1e-12){vec3 axis=abs(N.z)<0.999?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0);T=cross(axis,N);}
 T=normalize(T);vec3 B=normalize(cross(N,T));if(dot(B,frame.B)<0.0)B=-B;
 anisotropyT=cos(physicalRead.y)*T+sin(physicalRead.y)*B;
 anisotropyB=cross(N,anisotropyT);
}
vec3 anisotropicLobe(vec3 L,vec3 V,vec3 N,vec3 f0,float rough){
 vec3 H=normalize(L+V);float alpha=rough*rough;
 float at=mix(alpha,1.0,physicalRead.x*physicalRead.x),ab=alpha;
 float nl=max(dot(N,L),0.0),nv=max(dot(N,V),0.0),nh=max(dot(N,H),0.0);
 vec3 h=vec3(dot(anisotropyT,H)/at,dot(anisotropyB,H)/ab,nh);
 float D=INVERSE_PI/(at*ab*pow(dot(h,h),2.0));
 float gv=nl*length(vec3(at*dot(anisotropyT,V),ab*dot(anisotropyB,V),nv));
 float gl=nv*length(vec3(at*dot(anisotropyT,L),ab*dot(anisotropyB,L),nl));
 return fresnel(f0,max(dot(V,H),0.0))*D*0.5/max(gv+gl,1e-6);
}
float coatAttenuation(vec3 V){return 1.0-physicalRead.z*fresnel(vec3(0.04),max(dot(coatNormal,V),0.0)).r;}
`
