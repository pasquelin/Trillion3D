import { SURFACE_MODEL_MASK } from '../scene/surfaceModel.ts'
import { HASH_UNIT_WGSL } from '../math/hashUnitWgsl.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts'
import { withScreenReflections } from './screenWgsl.ts'
import { GGX_REFLECTION_SAMPLE_WGSL } from './ggxSampleWgsl.ts'
import { HIZ_TRACE_WGSL, REFLECTION_PHASE_WGSL } from './hizTraceWgsl.ts'
import { SCREEN_REFLECTION_MAX_ROUGHNESS } from './modelShader.ts'

/** A sample is bounded: one ray per 2 × 2 block (`reflectionPhase`, the
 *  half-resolution trace), resolved by the bounded ray (`boundedReflectionRay`, `hizTraceWgsl.ts`):
 *  the depth pyramid's walk, a miss on the filtered probes. A reference
 *  session's program takes the mirror's whole walk and fallback instead (`reflectionTrace`,
 *  `frame/referenceMode.ts`): two programs, never a branch. A texel that writes a weight writes, at
 *  that one return, the record of its pixel the history resolve's gather reads (`resolveWgsl.ts`):
 *  the identifier, from the visibility buffer the lighting binds (`vis`, the resolve's
 *  `ids`), and the depth's bits, exact; a texel without weight, whose record no gather reads,
 *  none. */
const stochasticReflectionWgsl = (unbounded: boolean) => `${GGX_REFLECTION_SAMPLE_WGSL}
${REFLECTION_PHASE_WGSL}
${unbounded ? '' : HIZ_TRACE_WGSL}
@group(2) @binding(0) var reflectionOwners:texture_storage_2d<rg32uint,write>;
@fragment fn traceRoughReflection(@builtin(position) texel:vec4f)->@location(0) vec4f{
 let seed=bitcast<u32>(reflectionView.enabled.w);
 let at=min(vec2i(texel.xy)*2+reflectionPhase(seed),vec2i(reflectionView.enabled.yz)-vec2i(1));
 let pixel=vec2f(at)+vec2f(0.5);
 let flag=textureLoad(flags,at,0).r&${SURFACE_MODEL_MASK}u;
 if(flag==0u||flag==1u||flag==3u||flag==4u||flag==5u){return vec4f(0.0);}
 let nr=textureLoad(normalRough,at,0);
 // Mirrors take the exact ray; from the cutoff on, where the display's fade is zero, it reads
 // the environment alone.
 if(nr.a<=${ROUGHNESS_FLOOR}||nr.a>=${SCREEN_REFLECTION_MAX_ROUGHNESS}){return vec4f(0.0);}
 let z=textureLoad(depth,at,0);
 let P=worldAt(pixel,z);
 shadowFootprint=length(worldAt(pixel+vec2f(1.0,0.0),z)-P);
 shadowSetView(view.camera.xyz,view.viewport.x,pixel,seed,shadowFootprint,worldAt(view.viewport.xy*0.5,z));
 let N=normalize(nr.xyz);let V=normalize(view.camera.xyz-P*view.camera.w);
 let pixelSeed=u32(at.y)*u32(reflectionView.enabled.y)+u32(at.x);
 // Integer rank and source epoch are mixed by the caller, independent of wall clock.
 // 0x9e3779b9u: odd 32-bit constant (fractional part of the golden ratio) that flips well-spread
 // bits of the seed, so the second coordinate is decorrelated from the first; any odd value with
 // well-spread bits would serve, this one is declared, not tuned.
 let xi=vec2f(hashUnit(pixelSeed^seed),hashUnit(pixelSeed^seed^0x9e3779b9u));
 let sample=stochasticReflection(reflect(-V,N),N,nr.a,min(xi,vec2f(0.99999994)));
 if(sample.w<=0.0){return vec4f(0.0);}
 textureStore(reflectionOwners,vec2i(texel.xy),vec4u(textureLoad(vis,at,0).r,bitcast<u32>(z),0u,0u));
 return vec4f(${unbounded ? 'resolvedReflectionRay' : 'boundedReflectionRay'}(P,N,sample.xyz),sample.w);
}`

/** The trace borrows the same lighting/proxy bindings as the final resolve; `unbounded`, a
 *  reference session's program. */
export function stochasticReflectionShader(shader: string, unbounded = false) {
  const source = withScreenReflections(shader)
  return (
    source +
    (source.includes('fn hashUnit(') ? '' : HASH_UNIT_WGSL) +
    stochasticReflectionWgsl(unbounded)
  )
}
