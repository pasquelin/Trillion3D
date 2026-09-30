import { REFLECTION_CONE_WGSL } from './coneWgsl.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
import { screenTraceShader } from './traceShader.ts';
import { MIRROR_LIGHTING_WGSL } from '../bounce/reflectWgsl.ts';
import { SCREEN_REFLECTION_MAX_ROUGHNESS, mirrorWeightShader } from './modelShader.ts';
import { FOG_FREE_SURFACE_FLAG } from '../scene/surfaceModel.ts';

export const SCREEN_REFLECTION_WGSL = `
// \`enabled\`: x the switch, yz the size the image draws in the source, which may be smaller.
struct ReflectionView{matrix:mat4x4f,enabled:vec4f,}
@group(1) @binding(0) var reflectionColor:texture_2d<f32>;
@group(1) @binding(1) var reflectionDepth:texture_depth_2d;
@group(1) @binding(2) var<uniform> reflectionView:ReflectionView;
fn reflectionProject(p:vec4f)->vec4f{let c=reflectionView.matrix*p;return vec4f(c.x,-c.y,c.z,c.w);}
fn reflectionSize()->vec2f{return reflectionView.enabled.yz;}
fn reflectionDepthAt(p:vec2i)->f32{return textureLoad(reflectionDepth,p,0);}
fn reflectionClearDepth()->f32{return 0.0;}
fn reflectionColorAt(p:vec2i)->vec3f{return textureLoad(reflectionColor,p,0).rgb;}
${screenTraceShader('wgsl')}
fn resolvedReflectionRay(P:vec3f,N:vec3f,R:vec3f)->vec3f{
 let hit=screenReflection(P,R);
 if(hit.a!=0.0){return hit.rgb;}
 return reflectedRadiance(P,N,R,${ROUGHNESS_FLOOR});
}
${REFLECTION_CONE_WGSL}
fn filteredResolvedReflection(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 let hit=screenReflectionCone(P,R,rough);
 if(hit.a>=1.0){return hit.rgb;}
 return hit.rgb+(1.0-hit.a)*reflectedRadiance(P,N,R,rough);
}
// the reference engine's roughness fade: the whole trace up to half the cutoff, none from the cutoff on (#1341).
fn screenReflectionFade(rough:f32)->f32{
 return clamp(2.0-2.0*rough/${SCREEN_REFLECTION_MAX_ROUGHNESS},0.0,1.0);
}
fn tracedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 let weight=mirrorWeight(rough);
 if(weight==1.0){return resolvedReflectionRay(P,N,R);}
 let filtered=filteredResolvedReflection(P,N,R,rough);
 if(weight==0.0){return filtered;}
 return mix(filtered,resolvedReflectionRay(P,N,R),weight);
}
fn resolvedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 let fade=screenReflectionFade(rough);
 if(reflectionView.enabled.x==0.0||fade==0.0){return reflectedRadiance(P,N,R,rough);}
 let traced=tracedRadiance(P,N,R,rough);
 if(fade==1.0){return traced;}
 return mix(reflectedRadiance(P,N,R,rough),traced,fade);
}`;

/** The rough history holds a ratio mean; a pixel that has only drawn below-horizon samples holds
 *  no weight, and reads the environment reflection, never black (#1341). */
export const HELD_REFLECTION_WGSL = `
@group(1) @binding(3) var roughHistory:texture_2d<f32>;
fn heldReflection(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 let projected=reflectionProject(vec4f(P,1.0));
 let at=vec2i((projected.xy/projected.w*0.5+vec2f(0.5))*reflectionSize());
 let held=textureLoad(roughHistory,at,0);
 if(held.a>0.0){return held.rgb;}
 return reflectedRadiance(P,N,R,rough);
}`;

/** The direct-only program has the same mirror model; its off-screen fallback is empty. */
const NO_PROXY_WGSL = `
${mirrorWeightShader('wgsl')}
fn reflectedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{return vec3f(0.0);}
${MIRROR_LIGHTING_WGSL}`;

/** Install screen hits at the one reflection-model entry, preserving its existing miss behavior. */
export function withScreenReflections(shader: string, direct = false, history = false) {
  const source = direct
    ? shader.replace(
        'var rgb=lit+ambient+emissive.rgb;',
        'var rgb=lit+ambient+emissive.rgb+mirrorLighting(base.rgb,base.a,normal.a,N,V,P);',
      ) + NO_PROXY_WGSL
    : shader;
  const reflection = history
    ? SCREEN_REFLECTION_WGSL.replace(
        'let filtered=filteredResolvedReflection(P,N,R,rough);',
        'let filtered=heldReflection(P,N,R,rough);',
      ) + HELD_REFLECTION_WGSL
    : SCREEN_REFLECTION_WGSL;
  return (
    source.replace(
      ')*reflectedRadiance(P,N,reflect(-V,N),',
      ')*resolvedRadiance(P,N,reflect(-V,N),',
    ) + reflection
  );
}

/** Source radiance has no camera fog and no recursive mirror: consumed before any blending. */
export function reflectionSource(shader: string) {
  const cameraFog = `if((surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)==0u){rgb=fogged(rgb,P,view.display.yzw);}`;
  return shader
    .replace('+mirrorLighting(base.rgb,base.a,normal.a,N,V,P)', '')
    .replaceAll(cameraFog, '');
}
