import { reflectionConeShader } from './coneShader.ts';
import { reflectionConeFilterShader } from './coneFilterShader.ts';
import { screenTraceShader } from './traceShader.ts';
import { screenRadianceShader } from './screenRadianceShader.ts';
import { WEBGL_SCREEN_RADIANCE } from './webglScreenRadiance.ts';
import { mirrorLightingShader, mirrorWeightShader } from './modelShader.ts';

export const SCREEN_REFLECTION_GLSL = `
uniform sampler2D reflectionColor,reflectionDepth;
uniform highp usampler2D reflectionBounds;
uniform bool reflectionEnabled,reflectionCapture,reflectionResolve,reflectionOutput;
vec4 reflectionProject(vec4 p){vec4 c=projectionMatrix*p;c.z=(c.z+c.w)*0.5;return c;}
vec2 reflectionSize(){return vec2(textureSize(reflectionColor,0));}
float reflectionDepthAt(ivec2 p){return texelFetch(reflectionDepth,p,0).r;}
float reflectionClearDepth(){return 1.0;}
vec4 reflectionHitAt(ivec2 p){return vec4(texelFetch(reflectionColor,p,0).rgb,1.0);}
// The walk reads the depth bounds below: GLSL reads top to bottom.
vec2 reflectionBoundsAt(ivec2 p,int level);
int reflectionBoundsLevels();
${screenTraceShader('glsl')}
${mirrorWeightShader('glsl')}
float reflectionLastMip(){return floor(log2(max(reflectionSize().x,reflectionSize().y)));}
// The bounds hold the levels above the pixels, the pyramid's last the whole image (\`pyramidGl.ts\`).
int reflectionBoundsLevels(){return int(reflectionLastMip());}
vec2 reflectionBoundsAt(ivec2 p,int level){
 if(level==0)return reflectionPixelBounds(p);
 ivec2 size=textureSize(reflectionBounds,level-1);
 return uintBitsToFloat(texelFetch(reflectionBounds,clamp(p,ivec2(0),size-1),level-1).rg);
}
vec4 reflectionMipColorAt(ivec2 p,int level){
 ivec2 size=textureSize(reflectionColor,level);
 return texelFetch(reflectionColor,clamp(p,ivec2(0),size-1),level);
}
${reflectionConeFilterShader('glsl')}
${reflectionConeShader('glsl')}
// The display pass reads the receiver's reflection once, resolved at the mirror pass's own size:
// the reduced image is written into the reflectionColor unit after the resolve pass, so no trace
// runs over the receiver again. The resolve pass itself reads the full-detail source above.
${screenRadianceShader('glsl', WEBGL_SCREEN_RADIANCE)}
${mirrorLightingShader('glsl')}`;
