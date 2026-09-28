import { screenTraceShader } from './traceShader.ts';
import { MIRROR_LIGHTING_WGSL } from '../bounce/reflectWgsl.ts';
import { mirrorWeightShader } from './modelShader.ts';

export const SCREEN_REFLECTION_WGSL = `
struct ReflectionView{matrix:mat4x4f,enabled:vec4f,}
@group(1) @binding(0) var reflectionColor:texture_2d<f32>;
@group(1) @binding(1) var reflectionDepth:texture_depth_2d;
@group(1) @binding(2) var<uniform> reflectionView:ReflectionView;
fn reflectionProject(p:vec4f)->vec4f{let c=reflectionView.matrix*p;return vec4f(c.x,-c.y,c.z,c.w);}
fn reflectionSize()->vec2f{return vec2f(textureDimensions(reflectionColor));}
fn reflectionDepthAt(p:vec2i)->f32{return textureLoad(reflectionDepth,p,0);}
fn reflectionClearDepth()->f32{return 0.0;}
fn reflectionColorAt(p:vec2i)->vec3f{return textureLoad(reflectionColor,p,0).rgb;}
${screenTraceShader('wgsl')}
fn resolvedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 if(reflectionView.enabled.x!=0.0){
  let weight=mirrorWeight(rough);
  if(weight>0.0){
   let hit=screenReflection(P,R);
   if(hit.a!=0.0){
    if(weight==1.0){return hit.rgb;}
    return mix(reflectedRadiance(P,N,R,rough),hit.rgb,weight);
   }
  }
 }
 return reflectedRadiance(P,N,R,rough);
}`;

/** The direct-only program has the same mirror model; its off-screen fallback is empty. */
const NO_PROXY_WGSL = `
${mirrorWeightShader('wgsl')}
fn reflectedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{return vec3f(0.0);}
${MIRROR_LIGHTING_WGSL}`;

/** Install screen hits at the one reflection-model entry, preserving its existing miss behavior. */
export function withScreenReflections(shader: string, direct = false) {
  const source = direct
    ? shader.replace(
        'lit+ambient+emissive.rgb,P,',
        'lit+ambient+emissive.rgb+mirrorLighting(base.rgb,base.a,normal.a,N,V,P),P,',
      ) + NO_PROXY_WGSL
    : shader;
  return (
    source.replace(
      ')*reflectedRadiance(P,N,reflect(-V,N),',
      ')*resolvedRadiance(P,N,reflect(-V,N),',
    ) + SCREEN_REFLECTION_WGSL
  );
}

/** Source radiance has no camera fog and no recursive mirror: consumed before any blending. */
export function reflectionSource(shader: string) {
  return shader
    .replace('+mirrorLighting(base.rgb,base.a,normal.a,N,V,P)', '')
    .replace('fogged(base.rgb,P,view.display.yzw)', 'base.rgb')
    .replace(/fogged\((lit[^;]*),P,view.display.yzw\)/, '$1');
}
