import { screenTraceShader } from './traceShader.ts';
import { mirrorLightingShader, mirrorWeightShader } from './modelShader.ts';

export const SCREEN_REFLECTION_GLSL = `
uniform sampler2D reflectionColor,reflectionDepth,reflectionResolveImage;
uniform bool reflectionEnabled,reflectionCapture,reflectionResolve,reflectionOutput;
vec4 reflectionProject(vec4 p){vec4 c=projectionMatrix*p;c.z=(c.z+c.w)*0.5;return c;}
vec2 reflectionSize(){return vec2(textureSize(reflectionColor,0));}
float reflectionDepthAt(ivec2 p){return texelFetch(reflectionDepth,p,0).r;}
float reflectionClearDepth(){return 1.0;}
vec3 reflectionColorAt(ivec2 p){return texelFetch(reflectionColor,p,0).rgb;}
${screenTraceShader('glsl')}
// A receiver reads the trace once, resolved at the mirror pass's own size (a mirror receiver is
// the only fragment that asks, and the resolve pass writes exactly those). The pass itself reads
// the full-detail source, so one trace serves every later sample of the reduced image.
vec3 reflectedRadiance(vec3 P,vec3 N,vec3 R,float rough){
 if(!reflectionEnabled)return vec3(0.0);
 if(reflectionResolve)return texture(reflectionResolveImage,gl_FragCoord.xy/vec2(textureSize(reflectionResolveImage,0))).rgb;
 return screenReflection(P,R).rgb;
}
${mirrorWeightShader('glsl')}
${mirrorLightingShader('glsl')}`;
