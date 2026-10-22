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
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
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
 * THE NOISE AND THE PLACES: the noise (the engine's integer hash), the tile's jitter, the atlas's addresses and the
 * parameters' flag. The probes' tiles are cut from the image's corner, and the pixel a tile's uniform probe stands on
 * moves by a Hammersley point of the tile's side every frame (`spTileJitter`), `tileJitters` of them coming round; the
 * adaptive probes of a tile stand on pixels of the tile's own (`spAdaptivePixel`), each sample a Hammersley point of a
 * seed the tile and the frame's jitter give.
 */
const SP_PLACES = wgslBlock(
  'SP_PLACES',
  [hammersley16, rand3dPcg16],
  `fn spFlag(bit:u32)->bool{return (sp.mode.z&bit)!=0u;}
/** Two values of [0, 1) of the texel \`coord\` and the \`salt\`, a hash of the three. */
fn spNoise(coord:vec2u,salt:u32)->vec2f{
 let h=rand3dPcg16(vec3i(vec2i(coord),i32(salt))).xy;
 return vec2f(h)*(1.0/65536.0);
}
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
/** The tile of the probe that stands on the pixel \`word\` names (\`x | y << 16\`). */
fn spProbeTile(word:u32)->vec2u{
 let pix=vec2u(word&0xffffu,word>>16u);
 return (pix-min(pix,spTileJitter(sp.mode.x)))/vec2u(sp.size.z);
}`,
)

/**
 * A POINT'S DEPTH as the weights measure it: its view depth, the engine's linear one (`surfaceLinearDepth`); a constant
 * under an orthographic camera, where a plane's distance has no depth to be relative to (`spDepthOf`); and its distance
 * from the eye, which the detail trace's fade and the history's fade follow (`spEyeDistance`).
 */
const SP_DEPTHS = wgslBlock(
  'SP_DEPTHS',
  [SP_REFLECTION, slabPerspective],
  `fn spDepthOf(p:vec3f)->f32{
 return max(select(1000.0,surfaceLinearDepth(p),slabPerspective(reflectionView.slab)),1e-3);
}
fn spEyeDistance(p:vec3f)->f32{return length(p-view.camera.xyz);}`,
)

/**
 * A RAY'S END AS THE TRACE STORES IT, and the ray word: the distance it reached (its bits but two, whether the ray met
 * a surface and whether what it met moves against the probe), the texel of the octahedron a ray is traced through
 * and its level (`spPackRay`; 6, 6 and 4 bits), the size of that level's grid (`spRayMip`).
 */
const SP_HITS = wgslBlock(
  'SP_HITS',
  [],
  `${wgslConsts({ SP_IMPORTANCE_LEVELS: SCREEN_PROBE_CONSTANTS.importanceLevels })}
fn spHitWord(distance:f32,hit:bool,moving:bool)->u32{
 return (bitcast<u32>(max(distance,0.0))&0x7ffffffcu)|select(0u,1u,hit)|select(0u,2u,moving);
}
fn spHitDistance(word:u32)->f32{return bitcast<f32>(word&0x7ffffffcu);}
fn spHitIs(word:u32)->bool{return (word&1u)!=0u;}
fn spHitMoves(word:u32)->bool{return (word&2u)!=0u;}
fn spPackRay(coord:vec2u,level:u32)->u32{return (coord.x&63u)|((coord.y&63u)<<6u)|((level&15u)<<12u);}
fn spRayCoord(word:u32)->vec2u{return vec2u(word&63u,(word>>6u)&63u);}
fn spRayLevel(word:u32)->u32{return (word>>12u)&15u;}
/** Texels a side of the grid a ray of level \`level\` is a texel of, for probes tracing \`trace\` rays a side. */
fn spRayMip(level:u32,trace:u32)->u32{return (trace<<SP_IMPORTANCE_LEVELS)>>level;}
/** A probe: its world point, its signed depth — negative where it stands on no lit surface —, its normal and
 *  the speed of its surface, in metres an image. */
struct SpProbe{P:vec3f,depth:f32,N:vec3f,speed:f32,}`,
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
const SP_MIN_WEIGHT:f32=${SCREEN_PROBE_CONSTANTS.minInterpolationWeight};
const SP_MAX_TRACE:f32=${SCREEN_PROBE_CONSTANTS.maxTraceDistance};`,
  )
