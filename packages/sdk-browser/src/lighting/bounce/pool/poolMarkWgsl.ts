import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { bitAt } from '../../../../../math/src/wgsl/integer.ts'
import { hashUnit } from '../../../../../math/src/wgsl/sampling.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { BOUNCE_CELLS_WGSL, BOUNCE_GRID_STRUCTS_WGSL } from '../gridWgsl.ts'
import { MARK_IMAGE_BINDINGS as I, MARK_PROBES_BINDINGS as P } from './poolLayout.ts'

/** Tiles along a side of a workgroup of the mark pass over the image. */
const MARK_GROUP = 8

/**
 * THE MARK OF A POINT: the finest level that holds the surface point `P` of normal `N` (`bounceRead`, the normal bias included) marks the
 * eight probes round it, a bit a cell in the order of the table (`cellEntry`): the bit of the entry in the bitmap `marks`. Sky marks nothing, nor does a point no level reaches: the sky light answers there.
 */
export const markPoint = (marks: number) =>
  wgslBlock(
    `markPoint(${marks})`,
    [BOUNCE_GRID_STRUCTS_WGSL, BOUNCE_CELLS_WGSL, bitAt],
    `@group(0) @binding(${marks}) var<storage,read_write> marks:array<atomic<u32>>;
fn markCell(level:u32,cell:vec3i){
 let entry=cellEntry(level,probeWrap(cell));
 atomicOr(&marks[entry>>5u],1u<<(entry&31u));
}
fn markPointBiased(P:vec3f,N:vec3f,bias:u32){
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let read=bounceRead(level,P,N);
  if(!read.holds||read.fade<=0.0){continue;}
  // The cells the view fills ask the level \`bias\` coarser (held to the coarsest), and mark the cube round the point there.
  let marked=min(level+bias,bounce.counts.y-1u);
  let corner=select(read.corner,bounceRead(marked,P,N).corner,marked!=level);
  for(var index=0u;index<8u;index++){
   markCell(marked,corner+vec3i(vec3u(bitAt(index,0u),bitAt(index,1u),bitAt(index,2u))));
  }
  return;
 }
}
fn markPoint(P:vec3f,N:vec3f){markPointBiased(P,N,0u);}`,
  )

/**
 * THE MARK PASS OVER THE IMAGE, where the last image cast no screen probe: the image is cut into tiles of `markTilePixels` pixels a side;
 * a thread a tile takes the pixel its jitter picks — a point that moves from one mark to the next, `markJitter` marks coming round
 * to the same one —, reads the surface it shows (its depth, its normal) and marks the point (`markPoint`).
 */
export const MARK_IMAGE_SHADER = wgslProgram(
  `${wgslConsts({ MARK_TILE: BOUNCE_SETTINGS.markTilePixels, MARK_JITTER: BOUNCE_SETTINGS.markJitter })}
@group(0) @binding(${I.grid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${I.view}) var<uniform> view:View;
@group(0) @binding(${I.depth}) var sceneDepth:texture_depth_2d;
@group(0) @binding(${I.normals}) var sceneNormals:texture_2d<f32>;
/** The pixel of tile \`tile\` this mark looks at: a point of the tile that turns, from one mark to the next, by
 *  the golden steps of a low-discrepancy sequence from a point of its own. */
fn markPixel(tile:vec2u,frame:u32)->vec2u{
 let seed=(tile.x*73856093u)^(tile.y*19349663u);
 let start=vec2f(hashUnit(seed),hashUnit(seed^2654435769u));
 let turn=vec2f(0.7548776662,0.5698402910)*f32(frame%MARK_JITTER);
 return tile*MARK_TILE+min(vec2u(fract(start+turn)*f32(MARK_TILE)),vec2u(MARK_TILE-1u));
}
@compute @workgroup_size(${MARK_GROUP},${MARK_GROUP})
fn markImage(@builtin(global_invocation_id) tile:vec3u){
 if(bounce.counts.w==0u){return;}
 let pixel=markPixel(tile.xy,bounce.frame.z);
 if(any(pixel>=vec2u(view.viewport.xy))){return;}
 let z=textureLoad(sceneDepth,vec2i(pixel),0);
 // Reverse depth: nothing drawn is at zero.
 if(z<=0.0){return;}
 let normal=textureLoad(sceneNormals,vec2i(pixel),0).xyz;
 if(dot(normal,normal)<0.5){return;}
 markPoint(worldAt(vec2f(pixel)+vec2f(0.5),z),normalize(normal));
}`,
  [WORLD_AT_WGSL, markPoint(I.marks), hashUnit],
)

/** The mark pass over the image's workgroups: a group a tile of `markTilePixels` pixels a side, `MARK_GROUP` tiles a side. */
export const markImageGroups = (size: readonly number[]) => {
  const tile = BOUNCE_SETTINGS.markTilePixels * MARK_GROUP
  return [ceilDiv(size[0], tile), ceilDiv(size[1], tile)] as const
}

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
@group(0) @binding(${P.normal}) var probeNormal:texture_2d<f32>;
@group(0) @binding(${P.counts}) var<storage,read> probeCounts:array<u32>;
@compute @workgroup_size(${MARK_GROUP},${MARK_GROUP})
fn markProbes(@builtin(global_invocation_id) id:vec3u){
 if(bounce.counts.w==0u||id.x>=source.z||id.y>=source.w){return;}
 let index=id.y*source.z+id.x;
 if(index>=source.x+min(probeCounts[0],source.y)){return;}
 let record=textureLoad(probeInfo,vec2i(id.xy),0);
 // A probe on no lit surface has a signed depth below zero.
 if(record.w<=0.0){return;}
 let normal=textureLoad(probeNormal,vec2i(id.xy),0).xyz;
 if(dot(normal,normal)<0.5){return;}
 markPoint(record.xyz,normalize(normal));
}`,
  [markPoint(P.marks)],
)
