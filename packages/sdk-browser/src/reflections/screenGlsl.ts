import { screenTraceShader } from './traceShader.ts';
import { mirrorLightingShader, mirrorWeightShader } from './modelShader.ts';

export const SCREEN_REFLECTION_GLSL = `
uniform sampler2D reflectionColor,reflectionDepth;
uniform bool reflectionEnabled,reflectionCapture;
vec4 reflectionProject(vec4 p){vec4 c=projectionMatrix*p;c.z=(c.z+c.w)*0.5;return c;}
vec2 reflectionSize(){return vec2(textureSize(reflectionColor,0));}
float reflectionDepthAt(ivec2 p){return texelFetch(reflectionDepth,p,0).r;}
float reflectionClearDepth(){return 1.0;}
vec3 reflectionColorAt(ivec2 p){return texelFetch(reflectionColor,p,0).rgb;}
${screenTraceShader('glsl')}
vec3 reflectedRadiance(vec3 P,vec3 N,vec3 R,float rough){
 if(!reflectionEnabled)return vec3(0.0);
 return screenReflection(P,R).rgb;
}
${mirrorWeightShader('glsl')}
${mirrorLightingShader('glsl')}`;
