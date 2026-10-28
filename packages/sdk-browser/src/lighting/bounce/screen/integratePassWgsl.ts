import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import { fourRooksJitter } from '../../../../../math/src/wgsl/sampling.ts'
import { DIFFUSE_INTEGRAL_METHOD } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { SP_DIFFUSE_METHOD, SP_ROUGH_LERP, spIntegrate } from './integrateWgsl.ts'
import { spOcclusionRead } from './occlusionReadWgsl.ts'
import { spProbes, spSurface, spWeights } from './probesWgsl.ts'
import {
  INTEGRATE_TILE_ARGS_WORDS,
  INTEGRATE_TILE_COUNTS_AT,
  INTEGRATE_TILE_MODE_COUNT,
  INTEGRATE_TILE_ROW,
  INTEGRATE_TILE_SIDE,
  SCREEN_PROBE_FORMATS as F,
  bindingTable,
} from './screenProbeLayout.ts'

/** The tile classification's bindings: the image's normals and flags, the light, rough specular and back it clears for the tiles of no lit pixel, the
 *  list of the tiles each mode integrates and the workgroups of each mode's integration. */
export const TILE_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  light: [4, { store: F.light }],
  rough: [5, { store: F.rough }],
  back: [6, { store: F.back }],
  tiles: [7, 'buffer'],
  args: [8, 'buffer'],
})

/** The integration's bindings: the image's normals and flags, the occlusion, the light, rough specular and back it writes, the probes' pixels, each tile's
 *  adaptive probes (their count, their list), their irradiance (with their extra ambient occlusion in its alpha, where they keep one), the share of their rays that move, their records and their filtered radiance, the blue noise, the
 *  lobes of the pixels, the tiles to integrate with the counts of each mode's (`args`), and the surfaces' base colour with metalness and emission with occlusion. */
export const INTEGRATE_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  occlusion: [3, 'float'],
  light: [4, { store: F.light }],
  rough: [5, { store: F.rough }],
  back: [6, { store: F.back }],
  pixels: [7, 'buffer-read'],
  header: [8, 'buffer-read'],
  indices: [9, 'buffer-read'],
  irradiance: [10, 'float'],
  moving: [11, 'buffer-read'],
  info: [12, 'float'],
  normal: [13, 'uint'],
  counts: [14, 'buffer-read'],
  blue: [15, 'float'],
  lobes: [16, 'uint'],
  tiles: [17, 'buffer-read'],
  gather: [18, 'float'],
  base: [19, 'float'],
  emissiveAo: [20, 'float'],
  args: [21, 'buffer-read'],
})

const T = TILE_BINDINGS.at
const I = INTEGRATE_BINDINGS.at

/** The layout of the integration's group: the occlusion is read as a float, or, with the bent normal, as the word that holds it; the tiles' list and counts only where the tiles
 *  are classified (`classified`). */
export const integrateEntries = (bentNormal: boolean, classified: boolean) =>
  INTEGRATE_BINDINGS.entries
    .filter((entry) => classified || (entry.binding !== I.tiles && entry.binding !== I.args))
    .map((entry) =>
      entry.binding === I.occlusion && bentNormal
        ? computeTextureEntry(I.occlusion, 'uint')
        : entry,
    )

const SIDE = INTEGRATE_TILE_SIDE

/**
 * THE INTEGRATION'S CELLS: where the integration runs at a reduction (`SP_INTEGRATE_DOWNSAMPLE`, 1 or 2; the program names it) it lights a texel for each pixel in this
 * many along each side of the image (`spIntegrateSize` texels), a cell of the integration standing for the pixel of its block that the four-rooks pattern names
 * (`spIntegratePixel`: the cell's block of pixels, the pixel of it the probes' gather state frame turns, held in the image); at 1 a cell is its own pixel. The
 * stochastic pick of the cells reads the same pixels (`stochasticWgsl.ts`).
 */
export const SP_INTEGRATE_CELLS = wgslBlock(
  'SP_INTEGRATE_CELLS',
  [fourRooksJitter],
  `fn spIntegrateSize()->vec2u{return (sp.size.xy+vec2u(SP_INTEGRATE_DOWNSAMPLE-1u))/vec2u(SP_INTEGRATE_DOWNSAMPLE);}
fn spIntegratePixel(cell:vec2u)->vec2u{
 if(SP_INTEGRATE_DOWNSAMPLE==1u){return cell;}
 return min(cell*SP_INTEGRATE_DOWNSAMPLE+fourRooksJitter(cell,sp.frames.x),sp.size.xy-vec2u(1u));
}`,
)

/** The tiles a mode's list holds at most: the integration's (`spTileCount`). */
const SP_TILE_COUNT = wgslBlock(
  'SP_TILE_COUNT',
  [SP_INTEGRATE_CELLS],
  `const SP_TILE_ROW:u32=${INTEGRATE_TILE_ROW}u;
fn spTileCount()->u32{
 let size=spIntegrateSize();
 return ((size.x+${SIDE - 1}u)/${SIDE}u)*((size.y+${SIDE - 1}u)/${SIDE}u);
}`,
)

/**
 * THE CLASSIFICATION OF THE TILES of cells the integration is dispatched over, in three entries. `tileInit` empties the workgroups of the integration of each of its three modes
 * (`INTEGRATE_TILE_MODE`) to (0, 1, 1) and their counts to zero (`args`). `tileClassify`, a workgroup a tile of `INTEGRATE_TILE_SIDE` cells on a side, marks each lit pixel of the tile's block of pixels (the cells' pixels,
 * all of them where the integration is downsampled, not only the ones it lights) with the bit of the mode it needs (`spTileBitOf`: the complete mode for hair; the sampled one for a pixel that samples its
 * BRDF or has a rough specular to sample, `spRoughLerp`; the simple one else), and lists the tile in the most complete mode its pixels need (`tiles`, a list of the tile count's size for each mode, the entry the tile's coordinates in
 * `x | y << 16`), counting the mode's tiles as it lists, which the integration reads to go no further than the tiles listed; a tile with no lit pixel is listed nowhere and its texels' light, rough specular and
 * back are cleared, the integration not reaching them. `tileFinish` turns each count into the workgroups of its dispatch, in rows of `INTEGRATE_TILE_ROW`
 * where a mode holds more tiles than a dispatch's axis.
 */
const TILE_CLASSIFICATION = wgslBlock(
  'TILE_CLASSIFICATION',
  [SP_ROUGH_LERP, SP_DIFFUSE_METHOD, SP_TILE_COUNT],
  `const SP_ARGS_WORDS:u32=${INTEGRATE_TILE_ARGS_WORDS}u;
const SP_COUNTS_AT:u32=${INTEGRATE_TILE_COUNTS_AT}u;
@group(0) @binding(${T.light}) var lightOut:texture_storage_2d<${F.light},write>;
@group(0) @binding(${T.rough}) var roughOut:texture_storage_2d<${F.rough},write>;
@group(0) @binding(${T.back}) var backOut:texture_storage_2d<${F.back},write>;
@group(0) @binding(${T.tiles}) var<storage,read_write> tileList:array<u32>;
@group(0) @binding(${T.args}) var<storage,read_write> tileArgs:array<atomic<u32>,${INTEGRATE_TILE_ARGS_WORDS}>;
var<workgroup> tileModes:atomic<u32>;
@compute @workgroup_size(1)
fn tileInit(){
 for(var word=0u;word<SP_ARGS_WORDS;word++){atomicStore(&tileArgs[word],select(0u,1u,word<SP_COUNTS_AT&&word%3u!=0u));}
}
@compute @workgroup_size(${SIDE},${SIDE})
fn tileClassify(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&tileModes,0u);}
 workgroupBarrier();
 let cell=group.xy*${SIDE}u+local.xy;
 let inside=all(cell<spIntegrateSize());
 if(inside){
  for(var block=0u;block<SP_INTEGRATE_DOWNSAMPLE*SP_INTEGRATE_DOWNSAMPLE;block++){
   let pixel=cell*SP_INTEGRATE_DOWNSAMPLE+vec2u(block%SP_INTEGRATE_DOWNSAMPLE,block/SP_INTEGRATE_DOWNSAMPLE);
   if(any(pixel>=sp.size.xy)){continue;}
   let s=spSurfaceAt(pixel);
   if(s.lit){
    let at=vec2i(pixel);
    let rough=spRoughLerp(textureLoad(sceneNormals,at,0).w,s.foliage,spLobed(textureLoad(sceneFlags,at,0).r));
    atomicOr(&tileModes,spTileBitOf(s.hair,rough));
   }
  }
 }
 workgroupBarrier();
 let modes=atomicLoad(&tileModes);
 if(modes==0u){
  if(inside){
   textureStore(lightOut,vec2i(cell),vec4f(0.0));
   textureStore(roughOut,vec2i(cell),vec4u(0u));
   textureStore(backOut,vec2i(cell),vec4u(0u));
  }
  return;
 }
 if(lane==0u){
  let mode=select(select(SP_TILE_SIMPLE,SP_TILE_SAMPLED,(modes&SP_TILE_BIT_SAMPLED)!=0u),SP_TILE_COMPLETE,(modes&SP_TILE_BIT_COMPLETE)!=0u);
  let place=atomicAdd(&tileArgs[SP_COUNTS_AT+mode],1u);
  tileList[mode*spTileCount()+place]=group.x|(group.y<<16u);
 }
}
@compute @workgroup_size(1)
fn tileFinish(){
 for(var mode=0u;mode<${INTEGRATE_TILE_MODE_COUNT}u;mode++){
  let tiles=atomicLoad(&tileArgs[SP_COUNTS_AT+mode]);
  atomicStore(&tileArgs[mode*3u],min(tiles,SP_TILE_ROW));
  atomicStore(&tileArgs[mode*3u+1u],max((tiles+SP_TILE_ROW-1u)/SP_TILE_ROW,1u));
 }
}`,
)

/** The tile classification's program over the integration's reduction `integrate`, the integral method `integral` and the `samples` of a tile. */
export const tileShader = (
  integrate: number,
  integral: number,
  samples: readonly [number, number],
) =>
  wgslProgram(
    `${spParams(T.params)}
${wgslConsts({ SP_INTEGRATE_DOWNSAMPLE: integrate, SP_INTEGRAL_METHOD: integral })}`,
    [spCommon(samples), spSurface(T.normals, T.flags), TILE_CLASSIFICATION],
  )

/** The entry points of the integration of the tiles each mode lists, in the order of `INTEGRATE_TILE_MODE`. */
export const CLASSIFIED_POINTS = [
  'integrateSimple',
  'integrateSampled',
  'integrateComplete',
] as const
/** The entry point of the integration of every cell, where the tiles are not classified. */
export const EVERY_POINT = 'integrateEvery'

/**
 * THE INTEGRATION OF A CELL (`spIntegrateCell`), in the mode its tile is integrated in (`SP_DIFFUSE_METHOD`), and the entries that dispatch it: where the tiles are classified, `integrateSimple`, `integrateSampled` and
 * `integrateComplete` over the tiles each mode lists (`spIntegrateTile`), where the pixels of a simple tile take their diffuse light over pi for their rough specular and sample nothing, those of a sampled
 * tile sample the lobe of their rough specular and, where the setting asks it, their BRDF, and those of a complete tile (hair) sample the whole sphere; else `integrateEvery`, over every cell, whose
 * mode has every branch. A workgroup a tile (`INTEGRATE_TILE_SIDE` cells on a side), a thread a cell, which lights the pixel it stands for
 * (`spIntegratePixel`: the cell itself where the integration is not downsampled): the
 * probes it reads give its light with the share of it that moves, its rough specular and its back (`spIntegrate`, under the open sky of its occlusion where the
 * setting applies the occlusion during the integration), written for the temporal pass to blend: the light, under the probes' extra ambient occlusion and the material's, and the share of it that moves in the first target, the rough
 * specular in the second, the back in the third, each an 11-11-10 word, at the cell's texel. A cell whose pixel is no lit surface is cleared.
 */
const integrateKernel = (classified: boolean) =>
  wgslBlock(
    `INTEGRATE_KERNEL(${classified})`,
    [SP_TILE_COUNT, makeFinite3],
    `@group(0) @binding(${I.light}) var lightOut:texture_storage_2d<${F.light},write>;
@group(0) @binding(${I.rough}) var roughOut:texture_storage_2d<${F.rough},write>;
@group(0) @binding(${I.back}) var backOut:texture_storage_2d<${F.back},write>;
fn spIntegrateCell(cell:vec2u,mode:u32){
 if(any(cell>=spIntegrateSize())){return;}
 let at=vec2i(cell);
 let pixel=spIntegratePixel(cell);
 let s=spSurfaceAt(pixel);
 var light=vec4f(0.0);
 var rough=0u;
 var back=0u;
 if(s.lit){
  // Applied during the integration the occlusion is searched at the integration's own reduction (\`ScreenProbeSettings.occlusionDownsample\`): its texel is the cell's.
  let read=spIntegrate(pixel,cell,s,mode,s.backface,spSkyAt(at,s.N,spStrengthOf(s.foliage)));
  light=read.light;
  rough=read.rough;
  back=read.back;
 }
 textureStore(lightOut,at,vec4f(max(makeFinite3(light.rgb),vec3f(0.0)),light.a));
 textureStore(roughOut,at,vec4u(rough,0u,0u,0u));
 textureStore(backOut,at,vec4u(back,0u,0u,0u));
}
${
  classified
    ? `@group(0) @binding(${I.tiles}) var<storage,read> tileList:array<u32>;
@group(0) @binding(${I.args}) var<storage,read> tileCounts:array<u32>;
fn spIntegrateTile(group:vec3u,local:vec2u,mode:u32){
 let index=group.y*SP_TILE_ROW+group.x;
 if(index>=tileCounts[${INTEGRATE_TILE_COUNTS_AT}u+mode]){return;}
 let tile=tileList[mode*spTileCount()+index];
 spIntegrateCell(vec2u(tile&0xffffu,tile>>16u)*${SIDE}u+local,mode);
}
${CLASSIFIED_POINTS.map(
  (point, mode) => `@compute @workgroup_size(${SIDE},${SIDE})
fn ${point}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u){
 spIntegrateTile(group,local.xy,${mode}u);
}`,
).join('\n')}`
    : `@compute @workgroup_size(${SIDE},${SIDE})
fn ${EVERY_POINT}(@builtin(global_invocation_id) id:vec3u){
 spIntegrateCell(id.xy,SP_TILE_EVERY);
}`
}`,
  )

/** The integration's program over the occlusion's `downsample` (kept with the bent normal where `bentNormal`), its own reduction `integrate`, the integral method `integral` and the `samples` of a tile; with the
 *  probes' extra ambient occlusion where `extraAo`, the levels of detail of their filtered radiance the gather holds (`mips`, one where it holds one), and its tiles dispatched
 *  in lists of their modes where `classified`, else over every cell. */
export const integrateShader = (
  downsample: number,
  integrate: number,
  integral: number,
  samples: readonly [number, number],
  bentNormal: boolean,
  extraAo: boolean,
  mips: number,
  classified: boolean,
) =>
  wgslProgram(
    `${spParams(I.params)}
${wgslConsts({ SP_OCCLUSION_DOWNSAMPLE: downsample, SP_INTEGRATE_DOWNSAMPLE: integrate, SP_INTEGRAL_METHOD: integral })}`,
    [
      spCommon(samples),
      spWeights,
      spSurface(I.normals, I.flags),
      spProbes(I.info, I.normal, I.counts),
      blueNoiseWgsl(0, I.blue),
      spOcclusionRead(I.occlusion, bentNormal),
      spIntegrate({
        ...I,
        extraAo,
        bentNormal,
        mips,
        numerical: integral === DIFFUSE_INTEGRAL_METHOD.numerical,
      }),
      integrateKernel(classified),
    ],
  )
