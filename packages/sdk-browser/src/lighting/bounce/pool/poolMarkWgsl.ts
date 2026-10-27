import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bitAt } from '../../../../../math/src/wgsl/integer.ts'
import { fourRooksJitter, interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { BOUNCE_CELLS_WGSL, BOUNCE_GRID_STRUCTS_WGSL } from '../gridWgsl.ts'
import { MARK_IMAGE_BINDINGS as I, MARK_PROBES_BINDINGS as P, POOL_PARAMS } from './poolLayout.ts'

/** Threads along a side of a workgroup of the mark pass over the image. */
const MARK_GROUP = 8

/**
 * THE MARK OF A POINT: the finest level that holds the surface point `P` — the point itself, never pushed off its surface — with a share
 * of its answer above `dither` (`bounceRead`; zero where the mark is not dithered) marks the eight probes round it, a bit a cell in the
 * order of the table (`cellEntry`): the bit of the entry in the bitmap `marks`; a cell the level does not hold is left unmarked. The share fades over the cache's own size at a level's edge, or over the one `markPointOver` is given.
 * Sky marks nothing, nor does a point no level reaches: the
 * sky light answers there.
 */
export const markPoint = (marks: number, group = 0) =>
  wgslBlock(
    `markPoint(${marks},${group})`,
    [BOUNCE_GRID_STRUCTS_WGSL, BOUNCE_CELLS_WGSL, bitAt],
    `@group(${group}) @binding(${marks}) var<storage,read_write> marks:array<atomic<u32>>;
fn markCell(level:u32,cell:vec3i){
 if(!levelHolds(level,cell)){return;}
 let entry=cellEntry(level,probeWrap(cell));
 atomicOr(&marks[entry>>5u],1u<<(entry&31u));
}
fn markPointOver(P:vec3f,dither:f32,bias:u32,invFade:f32){
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let read=bounceReadOver(level,P,invFade);
  if(read.fade<=dither){continue;}
  // The cells the view fills ask the level \`bias\` coarser (held to the coarsest), and mark the cube round the point there.
  let marked=min(level+bias,bounce.counts.y-1u);
  let corner=select(read.corner,bounceRead(marked,P).corner,marked!=level);
  for(var index=0u;index<8u;index++){
   markCell(marked,corner+vec3i(vec3u(bitAt(index,0u),bitAt(index,1u),bitAt(index,2u))));
  }
  return;
 }
}
fn markPointBiased(P:vec3f,dither:f32,bias:u32){markPointOver(P,dither,bias,LEVEL_INV_FADE);}
fn markPoint(P:vec3f){markPointBiased(P,0.0,0u);}`,
  )

/**
 * THE MARK PASS OVER THE IMAGE, where the last image cast no screen probe: a thread takes a pixel of the image downsampled by
 * `markDownsample` over `interpolateDownsample` — in each a pixel of a four-rooks pattern that turns with the frame (`downsampledJitter`) —,
 * reads the surface it shows (its depth, nothing drawn marks nothing) and marks the point (`markPoint`), the level picked with the
 * interleaved gradient noise of the pixel and the frame modulo eight, so that the cells where two levels share the answer are marked by
 * both in turn.
 */
export const MARK_IMAGE_SHADER = wgslProgram(
  `${POOL_PARAMS.wgsl}
@group(0) @binding(${I.grid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${I.view}) var<uniform> view:View;
@group(0) @binding(${I.depth}) var sceneDepth:texture_depth_2d;
@group(0) @binding(${I.params}) var<uniform> pool:PoolParams;
/** The pixel of a downsampled coordinate \`coord\` a factor \`factor\` takes among its factor squared: one of a four-rooks pattern, moved on at
 *  each frame; none where there is no downsampling. */
fn downsampledJitter(coord:vec2u,factor:u32)->vec2u{
 if(factor<=1u){return vec2u(0u);}
 return fourRooksJitter(coord,bounce.frame.z);
}
@compute @workgroup_size(${MARK_GROUP},${MARK_GROUP})
fn markImage(@builtin(global_invocation_id) id:vec3u){
 if(bounce.counts.w==0u){return;}
 // The mark's coordinate in the image downsampled for the interpolation, then the pixel it stands on.
 let interpolate=id.xy*pool.markDownsample.x+downsampledJitter(id.xy,pool.markDownsample.x);
 let size=(vec2u(view.viewport.xy)+vec2u(pool.markDownsample.y-1u))/pool.markDownsample.y;
 if(any(interpolate>=size)){return;}
 let pixel=interpolate*pool.markDownsample.y+downsampledJitter(interpolate,pool.markDownsample.y);
 if(any(pixel>=vec2u(view.viewport.xy))){return;}
 let z=textureLoad(sceneDepth,vec2i(pixel),0);
 // Reverse depth: nothing drawn is at zero.
 if(z<=0.0){return;}
 let dither=interleavedGradientNoise(vec2f(pixel),f32(bounce.frame.z%8u));
 markPointBiased(worldAt(vec2f(pixel)+vec2f(0.5),z),dither,0u);
}`,
  [WORLD_AT_WGSL, markPoint(I.marks), interleavedGradientNoise, fourRooksJitter],
)

/** The mark pass over the image's workgroups: a thread a pixel of the image downsampled by `interpolate` and then by `mark`, `MARK_GROUP`
 *  threads a side to a group. */
export const markImageGroups = (size: readonly number[], mark: number, interpolate: number) =>
  [
    ceilDiv(ceilDiv(ceilDiv(size[0], interpolate), mark), MARK_GROUP),
    ceilDiv(ceilDiv(ceilDiv(size[1], interpolate), mark), MARK_GROUP),
  ] as const

/**
 * THE MARK PASS OVER THE SCREEN PROBES the last image cast: a thread a probe of the atlas of their records (`source.z` along a row, `source.w`
 * rows), those that stand on a lit surface — the uniform ones, the first `source.x`, and the adaptive ones placed, at most `source.y` of
 * the count the placement kept — marking the point they stand on (`markPoint`), as the screen probes mark the cells of the radiance
 * cache they read.
 */
export const MARK_PROBES_SHADER = wgslProgram(
  `@group(0) @binding(${P.grid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${P.source}) var<uniform> source:vec4u;
@group(0) @binding(${P.info}) var probeInfo:texture_2d<f32>;
@group(0) @binding(${P.counts}) var<storage,read> probeCounts:array<u32>;
@compute @workgroup_size(${MARK_GROUP},${MARK_GROUP})
fn markProbes(@builtin(global_invocation_id) id:vec3u){
 if(bounce.counts.w==0u||id.x>=source.z||id.y>=source.w){return;}
 let index=id.y*source.z+id.x;
 if(index>=source.x+min(probeCounts[0],source.y)){return;}
 let record=textureLoad(probeInfo,vec2i(id.xy),0);
 // A probe on no lit surface has a signed depth below zero.
 if(record.w<=0.0){return;}
 markPoint(record.xyz);
}`,
  [markPoint(P.marks)],
)
