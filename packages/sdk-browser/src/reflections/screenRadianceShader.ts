import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts'
import { SCREEN_REFLECTION_CUTOFF } from './modelShader.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** How a program traces a lobe rougher than a mirror: a cone (`filtered`) beside the mirror ray
 *  (`mirror`), or its own march of the mirror ray itself (`march`), which takes neither. */
type ScreenLobe =
  | {
      /** The cone's colour and the share of the lobe it left to the fallback. */
      filtered?: string
      /** The function that resolves the mirror ray, `(P,N,R)`: by default the full walk, a miss on
       *  the program's fallback at the roughness floor. */
      mirror?: string
      march?: never
    }
  | {
      /** The program's march of the mirror ray, `(P,R)`: a hit's colour with a non-zero alpha, or a
       *  zero alpha for a miss. The full walk (`screenReflection`) traces that same ray with its own
       *  crossing test, so where
       *  `mirrorWeight` lies strictly between 0 and 1 — the roughness floor to one roughness step of
       *  the lobe table above it (`MIRROR_TRANSITION_END`) — the walk alone traces it, never both:
       *  a hit is the walk's colour, a miss mixes by that weight the fallbacks at the roughness and
       *  at the floor. */
      march: string
      filtered?: never
      mirror?: never
    }

/** A program's lobe (`ScreenLobe`) and the roughness its trace fades out at, from half of it on:
 *  by default the opaque cutoff. */
export type ScreenLobeFade = ScreenLobe & { maxRoughness?: number }

/** The program's reflection where no screen hit answers, at roughness `rough`: its own model
 *  (`reflectedRadiance`), the probes with bounce and the environment without. */
const fallback = (rough: string) => `reflectedRadiance(P,N,R,${rough})`

/** Screen reflections resolved per pixel (#1341), `resolvedRadiance`: a roughness fade,
 *  the whole trace up to half the maximum roughness and none from it on; a missed ray, the lobe
 *  share a cone left and every faded pixel read the program's fallback once, never black. A pass
 *  that traces nothing (`reflectionView.enabled.x` zero) reads the fallback alone. */
export function screenRadianceShader({
  filtered = 'filteredResolvedReflection(P,N,R,rough)',
  march,
  mirror,
  maxRoughness = SCREEN_REFLECTION_CUTOFF,
}: ScreenLobeFade) {
  const { lobe, transition } = march
    ? {
        lobe: `var hit:vec4f;
 if(weight>0.0){hit=screenReflection(P,R);}else{hit=${march}(P,R);}
 var filtered:vec4f=vec4f(0.0,0.0,0.0,1.0);
 if(hit.a!=0.0){filtered=vec4f(hit.rgb,0.0);}`,
        transition: `if(weight>0.0&&filtered.a>0.0){traced=mix(traced,${fallback(wgslF32(ROUGHNESS_FLOOR))},weight);}`,
      }
    : {
        lobe: `let filtered:vec4f=${filtered};`,
        transition: 'if(weight>0.0){traced=mix(traced,resolvedReflectionRay(P,N,R),weight);}',
      }
  return wgslBlock(
    `screenRadianceShader(${JSON.stringify({ filtered, march, mirror, maxRoughness })})`,
    [],
    `
fn screenReflectionFade(rough:f32)->f32{
 return clamp(2.0-2.0*rough/${wgslF32(maxRoughness)},0.0,1.0);
}
fn resolvedReflectionRay(P:vec3f,N:vec3f,R:vec3f)->vec3f{${
      mirror
        ? `\n return ${mirror}(P,N,R);`
        : `
 let hit:vec4f=screenReflection(P,R);
 if(hit.a!=0.0){return hit.rgb;}
 return ${fallback(wgslF32(ROUGHNESS_FLOOR))};`
    }
}
fn filteredResolvedReflection(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec4f{
 let hit:vec4f=screenReflectionCone(P,N,R,rough);
 return vec4f(hit.rgb,max(1.0-hit.a,0.0));
}
fn resolvedRadiance(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 let fade:f32=screenReflectionFade(rough);
 if(reflectionView.enabled.x==0.0||fade==0.0){return ${fallback('rough')};}
 let weight:f32=mirrorWeight(rough);
 if(weight==1.0){return resolvedReflectionRay(P,N,R);}
 ${lobe}
 var fallback:vec3f=vec3f(0.0);
 if(filtered.a>0.0||fade<1.0){fallback=${fallback('rough')};}
 var traced:vec3f=filtered.rgb+filtered.a*fallback;
 ${transition}
 if(fade==1.0){return traced;}
 return mix(fallback,traced,fade);
}`,
  )
}
