import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
import { shaderLanguage } from '../math/shaderLanguage.ts';
import { SCREEN_REFLECTION_MAX_ROUGHNESS } from './modelShader.ts';

/** What differs between the programs that resolve a screen reflection. */
export interface ScreenRadiance {
  /** The entry the program's `mirrorLighting` calls. */
  name: string;
  /** True where this pass traces nothing. */
  disabled: string;
  /** The program's reflection where no screen hit answers, at roughness `rough`. */
  fallback: (rough: string) => string;
  /** Statements run first, before any trace. */
  head?: string;
  /** The cone's colour and the share of the lobe it left to the fallback. */
  filtered?: string;
}

/** Screen reflections resolved per pixel in either graphics API (#1341): the reference engine's roughness fade,
 *  the whole trace up to half the maximum roughness and none from it on; a missed ray, the lobe
 *  share a cone left and every faded pixel read the program's fallback once, never black. */
export function screenRadianceShader(
  language: 'wgsl' | 'glsl',
  {
    name,
    disabled,
    fallback,
    head = '',
    filtered = 'filteredResolvedReflection(P,R,rough)',
  }: ScreenRadiance,
) {
  return shaderLanguage(
    `
fn screenReflectionFade(rough:f32)->f32{
 return clamp(2.0-2.0*rough/${SCREEN_REFLECTION_MAX_ROUGHNESS},0.0,1.0);
}
fn resolvedReflectionRay(P:vec3f,N:vec3f,R:vec3f)->vec3f{
 var hit:vec4f=screenReflection(P,R);
 if(hit.a!=0.0){return hit.rgb;}
 return ${fallback(ROUGHNESS_FLOOR)};
}
fn filteredResolvedReflection(P:vec3f,R:vec3f,rough:f32)->vec4f{
 var hit:vec4f=screenReflectionCone(P,R,rough);
 if(hit.a>=1.0){return vec4f(hit.rgb,0.0);}
 return vec4f(hit.rgb,1.0-hit.a);
}
fn ${name}(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 ${head}
 var fade:f32=screenReflectionFade(rough);
 if(${disabled}||fade==0.0){return ${fallback('rough')};}
 var weight:f32=mirrorWeight(rough);
 if(weight==1.0){return resolvedReflectionRay(P,N,R);}
 var filtered:vec4f=${filtered};
 var fallback:vec3f=vec3f(0.0);
 if(filtered.a>0.0||fade<1.0){fallback=${fallback('rough')};}
 var traced:vec3f=filtered.rgb+filtered.a*fallback;
 if(weight>0.0){traced=mix(traced,resolvedReflectionRay(P,N,R),weight);}
 if(fade==1.0){return traced;}
 return mix(fallback,traced,fade);
}`,
    language,
  );
}
