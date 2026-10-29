import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import {
  equalAreaDecode,
  equalAreaEncode,
  octWrapBorder,
} from '../../../../../math/src/wgsl/octahedral.ts'
import { slabPerspective } from '../../../../../math/src/wgsl/projection.ts'
import { hammersley16, rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import {
  cosineLobeShader,
  harmonicsShader,
} from '../../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import {
  IRRADIANCE_PROBE_SIDE,
  SCREEN_PROBE_CONSTANTS,
} from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import {
  REFLECTION_GROUP,
  REFLECTION_LINEAR_DEPTH_WGSL,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../../reflections/viewLayout.ts'
import { SCREEN_PROBE_FLAGS, SCREEN_PROBE_PARAMS } from './screenProbeLayout.ts'

/** The parameters' struct, which every kernel declares (`sp`, `spParams`). */
const SP_PARAMS_STRUCT = wgslBlock('SP_PARAMS_STRUCT', [], SCREEN_PROBE_PARAMS.wgsl)

/** The declaration of the parameters at `binding` of group 0. */
export const spParams = (binding: number) =>
  `@group(0) @binding(${binding}) var<uniform> sp:ScreenProbeParams;`

/** The bits of the mode word's flags, as the kernels name them. */
const FLAG_CONSTS = wgslConsts(
  Object.fromEntries(
    Object.entries(SCREEN_PROBE_FLAGS).map(([name, bit]) => [
      `SP_FLAG_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`,
      bit,
    ]),
  ),
)

/** The reflection group every kernel reads beside its own (the view the lighting reads, the depth pyramid, the last lit
 *  image): its declarations, and the engine's one linear depth. */
export const SP_REFLECTION = wgslBlock(
  'SP_REFLECTION',
  [
    reflectionLightViewWgsl(REFLECTION_GROUP),
    reflectionBindingsWgsl(REFLECTION_GROUP),
    REFLECTION_LINEAR_DEPTH_WGSL,
  ],
  '',
)

/** The nine terms of the order-2 basis, a direction's harmonics (`spBasis`) and a normal's cosine lobe
 *  (`spCosine`): a radiance projected on the first, its irradiance read by the second. */
const SP_BASIS = wgslBlock(
  'SP_BASIS',
  [],
  `fn spBasis(d:vec3f)->array<f32,9>{return ${harmonicsShader('d')};}
fn spCosine(n:vec3f)->array<f32,9>{return ${cosineLobeShader('n')};}`,
)

/**
 * THE PLACES: the tile's jitter, the atlas's addresses and the parameters' flag. The probes' tiles are cut from the image's
 * corner, and the pixel a tile's uniform probe stands on moves by a Hammersley point of the tile's side every frame
 * (`spTileJitter`), `tileJitters` of them coming round; the adaptive probes of a tile stand on pixels of the tile's own
 * (`spAdaptivePixel`), each sample a Hammersley point of a seed the tile and the frame's jitter give.
 */
const SP_PLACES = wgslBlock(
  'SP_PLACES',
  [hammersley16, rand3dPcg16],
  `fn spFlag(bit:u32)->bool{return (sp.mode.z&bit)!=0u;}
/** The jitter of the tile's uniform probe at jitter \`index\`: a Hammersley point of the tile's side. */
fn spTileJitter(index:u32)->vec2u{
 return vec2u(hammersley16(index%SP_TILE_JITTERS,SP_TILE_JITTERS,vec2u(0u))*f32(sp.size.z));
}
/** The pixel the uniform probe of tile \`tile\` stands on at jitter \`index\`, held in the image. */
fn spUniformPixel(tile:vec2u,index:u32)->vec2u{
 return min(tile*sp.size.z+spTileJitter(index),sp.size.xy-vec2u(1u));
}
/** The pixel the adaptive sample \`sample\` of tile \`tile\` stands on: not held in the image. */
fn spAdaptivePixel(tile:vec2u,sample:u32)->vec2u{
 let seed=rand3dPcg16(vec3i(vec2i(tile),i32(sp.mode.x))).xy;
 let h=hammersley16(sample,SP_SAMPLES,seed)*f32(sp.size.z);
 let held=clamp(h,vec2f(0.0),vec2f(f32(sp.size.z)-1.0));
 return tile*sp.size.z+spTileJitter(sp.mode.x)+vec2u(held);
}
fn spAtlasOf(index:u32)->vec2u{return vec2u(index%sp.grid.x,index/sp.grid.x);}
fn spIndexOf(atlas:vec2u)->u32{return atlas.y*sp.grid.x+atlas.x;}
/** The tile of the probe \`index\`, which stands on the pixel \`word\` names (\`x | y << 16\`): a uniform probe's own, whose pixel is held in the image
 *  where its tile is cut by the image's edge, an adaptive probe's that of its pixel. */
fn spProbeTile(index:u32,word:u32)->vec2u{
 if(index<sp.counts.y){return spAtlasOf(index);}
 let pix=vec2u(word&0xffffu,word>>16u);
 return (pix-min(pix,spTileJitter(sp.mode.x)))/vec2u(sp.size.z);
}`,
)

/** The dither a pass writing a float target takes (`spTargetDither`): a hash of the texel it writes and of the view's frame index modulo the jitters,
 *  plus the pass's own `salt`, in [0, 1). */
export const SP_TARGET_DITHER = wgslBlock(
  'SP_TARGET_DITHER',
  [rand3dPcg16],
  `fn spTargetDither(texel:vec2u,salt:i32)->f32{
 return f32(rand3dPcg16(vec3i(vec2i(texel),i32(sp.size.w%SP_TILE_JITTERS)+salt)).x)/65536.0;
}`,
)

/**
 * WHERE A PROBE'S SPHERICAL HARMONICS lie in the irradiance texture (`spCoefficientTexel`, the texel of coefficient `k` of probe `atlas`): a texel a coefficient in a
 * row of nine to a probe, or, where the probes keep an extra ambient occlusion, the first nine texels of the probe's block of the octahedral map's side and border,
 * the alpha of whose texels holds the occlusion by normal (`spExtraAoCode`): the one texture carries both.
 */
export const spCoefficientTexel = (extraAo: boolean) =>
  wgslBlock(
    `spCoefficientTexel(${extraAo})`,
    [],
    extraAo
      ? `fn spCoefficientTexel(atlas:vec2u,k:u32)->vec2i{
 let border=${IRRADIANCE_PROBE_SIDE + 2}u;
 return vec2i(atlas*border+vec2u(k%border,k/border));
}`
      : 'fn spCoefficientTexel(atlas:vec2u,k:u32)->vec2i{return vec2i(vec2u(atlas.x*9u+k,atlas.y));}',
  )

/**
 * A POINT'S DEPTH as the weights measure it: its view depth, the engine's linear one (`surfaceLinearDepth`); under an orthographic camera,
 * where the clip depth is not a length, its distance from the eye's plane along the view (`viewEyeDistance`, metres), so that a plane's distance
 * is relative to a depth in both projections (`spDepthOf`). `spMaxRay` is the intensity a traced ray is held to (`screenProbeMaxRayIntensity`)
 * in the units of the light the probes trace, which is not pre-exposed: the setting is a number of the pre-exposed light, so it is divided by
 * the pre-exposure every light is written multiplied by (`view.preExposure`).
 */
const SP_DEPTHS = wgslBlock(
  'SP_DEPTHS',
  [SP_REFLECTION, slabPerspective, WORLD_AT_WGSL],
  `fn spDepthOf(p:vec3f)->f32{
 return max(select(viewEyeDistance(p),surfaceLinearDepth(p),slabPerspective(reflectionView.slab)),1e-3);
}
/** The furthest a ray looks for a surface, in metres (\`screenProbeMaxTraceDistance\`). */
fn spMaxTrace()->f32{return sp.spatial.w;}
fn spMaxRay()->f32{return sp.weights.w/view.preExposure.x;}`,
)

/**
 * THE SKY LIGHT THAT LEAKS onto the surface a ray found, at `distance` metres along `d` (`spSkyLeak`): the sky light read along the ray at the roughness `sp.leak.w`, times the
 * share that leaks by channel (`sp.leak.xyz`) and the share of the way to the distance it leaks whole at (`sp.cache.w` its inverse); none while the share is none
 * or no sky light shines.
 */
const SP_SKY_LEAK = wgslBlock(
  'SP_SKY_LEAK',
  [SP_REFLECTION],
  `fn spSkyLeak(d:vec3f,distance:f32)->vec3f{
 if(!skyLightApplied()||all(sp.leak.xyz<=vec3f(0.0))){return vec3f(0.0);}
 return skyLightReflection(d,sp.leak.w)*sp.leak.xyz*saturate(distance*sp.cache.w);
}`,
)

/**
 * A RAY'S END AS THE TRACE STORES IT, and the ray word: the distance it reached (its bits but one, whether what the ray
 * met moves against the probe), the texel of the octahedron a ray is traced through
 * and its level (`spPackRay`; 6, 6 and 4 bits), the size of that level's grid (`spRayMip`).
 */
export const SP_HITS = wgslBlock(
  'SP_HITS',
  [],
  `${wgslConsts({ SP_IMPORTANCE_LEVELS: SCREEN_PROBE_CONSTANTS.importanceLevels })}
fn spHitWord(distance:f32,moving:bool)->u32{
 return (bitcast<u32>(max(distance,0.0))&0x7ffffffeu)|select(0u,1u,moving);
}
fn spHitDistance(word:u32)->f32{return bitcast<f32>(word&0x7ffffffeu);}
fn spHitMoves(word:u32)->bool{return (word&1u)!=0u;}
fn spPackRay(coord:vec2u,level:u32)->u32{return (coord.x&63u)|((coord.y&63u)<<6u)|((level&15u)<<12u);}
fn spRayCoord(word:u32)->vec2u{return vec2u(word&63u,(word>>6u)&63u);}
fn spRayLevel(word:u32)->u32{return (word>>12u)&15u;}
/** Texels a side of the grid a ray of level \`level\` is a texel of, for probes tracing \`trace\` rays a side. */
fn spRayMip(level:u32,trace:u32)->u32{return (trace<<SP_IMPORTANCE_LEVELS)>>level;}
/** A probe: its world point, its signed depth — negative where it stands on no lit surface —, its normal, the speed of its
 *  surface, in metres an image, and whether its surface has backface diffuse light (\`foliage\`: a thin double-sided sheet or a subsurface
 *  material) or is hair. */
struct SpProbe{P:vec3f,depth:f32,N:vec3f,speed:f32,foliage:bool,hair:bool,}`,
)

/**
 * WHAT EVERY SCREEN-PROBE KERNEL SHARES, once: the equal-area map of the sphere on the square (a texel of a probe is the
 * same solid angle as any other) and its border wrap, the noise and the places, the depths, the ray words, the order-2 basis,
 * and the weights of the four uniform probes round a pixel (`spWeights`, listed beside by the kernels that read them).
 * The parameters' struct and the reflection group come with it. A kernel names its `SP_TRACE` and the parameters' binding.
 */
export const spCommon = (samples: readonly [number, number]) =>
  wgslBlock(
    `spCommon(${samples[0]}, ${samples[1]})`,
    [
      SP_PARAMS_STRUCT,
      SP_REFLECTION,
      SP_BASIS,
      SP_PLACES,
      SP_DEPTHS,
      SP_SKY_LEAK,
      SP_HITS,
      PI,
      WORLD_AT_WGSL,
      equalAreaDecode,
      equalAreaEncode,
      octWrapBorder,
    ],
    `${FLAG_CONSTS}
${wgslConsts({
  SP_SAMPLES_X: samples[0],
  SP_SAMPLES_Y: samples[1],
  SP_SAMPLES: samples[0] * samples[1],
  SP_TILE_JITTERS: SCREEN_PROBE_CONSTANTS.tileJitters,
})}
const SP_MIN_WEIGHT:f32=${SCREEN_PROBE_CONSTANTS.minInterpolationWeight};`,
  )
