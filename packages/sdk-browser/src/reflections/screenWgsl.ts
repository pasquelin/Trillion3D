import { REFLECTION_CONE_WGSL } from './coneWgsl.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
import { screenTraceShader } from './traceShader.ts';
import { SCREEN_REFLECTION_MAX_ROUGHNESS } from './modelShader.ts';
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
// The cone's colour, and the share of the lobe it left to the fallback.
fn filteredResolvedReflection(P:vec3f,R:vec3f,rough:f32)->vec4f{
 let hit=screenReflectionCone(P,R,rough);
 return vec4f(hit.rgb,select(1.0-hit.a,0.0,hit.a>=1.0));
}
// Unreal's roughness fade: the whole trace up to half the cutoff, none from the cutoff on (#1341).
fn screenReflectionFade(rough:f32)->f32{
 return clamp(2.0-2.0*rough/${SCREEN_REFLECTION_MAX_ROUGHNESS},0.0,1.0);
}
// One fallback read serves both the lobe share the trace left and the roughness fade.
fn resolvedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 let fade=screenReflectionFade(rough);
 if(reflectionView.enabled.x==0.0||fade==0.0){return reflectedRadiance(P,N,R,rough);}
 let weight=mirrorWeight(rough);
 if(weight==1.0){return resolvedReflectionRay(P,N,R);}
 let filtered=filteredResolvedReflection(P,R,rough);
 var fallback=vec3f(0.0);
 if(filtered.a>0.0||fade<1.0){fallback=reflectedRadiance(P,N,R,rough);}
 var traced=filtered.rgb+filtered.a*fallback;
 if(weight>0.0){traced=mix(traced,resolvedReflectionRay(P,N,R),weight);}
 if(fade==1.0){return traced;}
 return mix(fallback,traced,fade);
}`;

/** The rough history holds a ratio mean; a pixel that has only drawn below-horizon samples holds
 *  no weight, and leaves its whole lobe to the environment reflection, never black (#1341). */
const HELD_REFLECTION_WGSL = `
@group(1) @binding(3) var roughHistory:texture_2d<f32>;
fn heldReflection(P:vec3f)->vec4f{
 let projected=reflectionProject(vec4f(P,1.0));
 let at=vec2i((projected.xy/projected.w*0.5+vec2f(0.5))*reflectionSize());
 let held=textureLoad(roughHistory,at,0);
 if(held.a>0.0){return vec4f(held.rgb,0.0);}
 return vec4f(0.0,0.0,0.0,1.0);
}`;

/** Install screen hits at the one reflection-model entry of either program, preserving its
 *  existing miss behavior: the probes with bounce, the environment without. */
export function withScreenReflections(shader: string, history = false) {
  const reflection = history
    ? SCREEN_REFLECTION_WGSL.replace(
        'let filtered=filteredResolvedReflection(P,R,rough);',
        'let filtered=heldReflection(P);',
      ) + HELD_REFLECTION_WGSL
    : SCREEN_REFLECTION_WGSL;
  return (
    shader.replace(
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
