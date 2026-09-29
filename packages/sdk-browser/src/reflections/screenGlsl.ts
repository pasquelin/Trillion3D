import { reflectionConeShader } from './coneShader.ts';
import { reflectionConeFilterShader } from './coneFilterShader.ts';
import { screenTraceShader } from './traceShader.ts';
import { mirrorLightingShader, mirrorWeightShader } from './modelShader.ts';

export const SCREEN_REFLECTION_GLSL = `
uniform sampler2D reflectionColor,reflectionDepth;
uniform highp usampler2D reflectionBounds;
uniform bool reflectionEnabled,reflectionCapture,reflectionResolve,reflectionOutput;
vec4 reflectionProject(vec4 p){vec4 c=projectionMatrix*p;c.z=(c.z+c.w)*0.5;return c;}
vec2 reflectionSize(){return vec2(textureSize(reflectionColor,0));}
float reflectionDepthAt(ivec2 p){return texelFetch(reflectionDepth,p,0).r;}
float reflectionClearDepth(){return 1.0;}
vec3 reflectionColorAt(ivec2 p){return texelFetch(reflectionColor,p,0).rgb;}
${screenTraceShader('glsl')}
${mirrorWeightShader('glsl')}
float reflectionLastMip(){return floor(log2(max(reflectionSize().x,reflectionSize().y)));}
vec2 reflectionBoundsAt(ivec2 p,int level){
 if(level==0){float z=reflectionDepthAt(p);return z==1.0?vec2(1.0,0.0):vec2(z);}
 ivec2 size=textureSize(reflectionBounds,level-1);
 return uintBitsToFloat(texelFetch(reflectionBounds,clamp(p,ivec2(0),size-1),level-1).rg);
}
vec4 reflectionMipColorAt(ivec2 p,int level){
 ivec2 size=textureSize(reflectionColor,level);
 return texelFetch(reflectionColor,clamp(p,ivec2(0),size-1),level);
}
${reflectionConeFilterShader('glsl')}
${reflectionConeShader('glsl')}
vec3 screenReflectionRay(vec3 P,vec3 N,vec3 R){return screenReflection(P,R).rgb;}
vec3 filteredScreenReflection(vec3 P,vec3 N,vec3 R,float rough){return screenReflectionCone(P,R,rough).rgb;}
// The display pass reads the receiver's reflection once, resolved at the mirror pass's own size:
// the reduced image is written into the reflectionColor unit after the resolve pass, so no trace
// runs over the receiver again. The resolve pass itself reads the full-detail source above.
vec3 reflectedRadiance(vec3 P,vec3 N,vec3 R,float rough){
 if(!reflectionEnabled)return vec3(0.0);
 if(reflectionResolve)return texture(reflectionColor,gl_FragCoord.xy/vec2(textureSize(reflectionColor,0))).rgb;
 float weight=mirrorWeight(rough);
 if(weight==1.0)return screenReflectionRay(P,N,R);
 vec3 filtered=filteredScreenReflection(P,N,R,rough);
 if(weight==0.0)return filtered;
 return mix(filtered,screenReflectionRay(P,N,R),weight);
}
${mirrorLightingShader('glsl')}`;
