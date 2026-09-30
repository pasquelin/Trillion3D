import { REFLECTION_CONE_WGSL } from './coneWgsl.ts';
import { screenTraceShader } from './traceShader.ts';
import { type ScreenRadiance, screenRadianceShader } from './screenRadianceShader.ts';

/** The WebGPU resolve: its fallback is the program's own reflection model, the probes with bounce
 *  and the environment without. */
const SCREEN_RADIANCE: ScreenRadiance = {
  name: 'resolvedRadiance',
  disabled: 'reflectionView.enabled.x==0.0',
  fallback: (rough: string) => `reflectedRadiance(P,N,R,${rough})`,
};

const screenReflectionWgsl = (filtered?: string) => `
// \`enabled\`: x the switch, yz the size the image draws in the source, which may be smaller.
struct ReflectionView{matrix:mat4x4f,enabled:vec4f,}
@group(1) @binding(0) var reflectionColor:texture_2d<f32>;
@group(1) @binding(1) var reflectionDepth:texture_depth_2d;
@group(1) @binding(2) var<uniform> reflectionView:ReflectionView;
fn reflectionProject(p:vec4f)->vec4f{let c=reflectionView.matrix*p;return vec4f(c.x,-c.y,c.z,c.w);}
fn reflectionSize()->vec2f{return reflectionView.enabled.yz;}
fn reflectionDepthAt(p:vec2i)->f32{return textureLoad(reflectionDepth,p,0);}
fn reflectionClearDepth()->f32{return 0.0;}
// The reprojected source (source.ts): alpha 0 where the last image did not see the point.
fn reflectionHitAt(p:vec2i)->vec4f{return textureLoad(reflectionColor,p,0);}
${screenTraceShader('wgsl')}
${REFLECTION_CONE_WGSL}
${screenRadianceShader('wgsl', { ...SCREEN_RADIANCE, filtered })}`;

export const SCREEN_REFLECTION_WGSL = screenReflectionWgsl();

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
    ? screenReflectionWgsl('heldReflection(P)') + HELD_REFLECTION_WGSL
    : SCREEN_REFLECTION_WGSL;
  return (
    shader.replace(
      ')*reflectedRadiance(P,N,reflect(-V,N),',
      ')*resolvedRadiance(P,N,reflect(-V,N),',
    ) + reflection
  );
}
