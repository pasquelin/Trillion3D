import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { hashUnit } from '../../../../math/src/wgsl/sampling.ts'
import { bitAt } from '../../../../math/src/wgsl/integer.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { BOUNCE_GRID_HEAD_WGSL, bounceBindingsWgsl } from './gridWgsl.ts'
import { MARK_BINDINGS } from './probes/probeBindings.ts'

/** Tiles along a side of a workgroup of the mark pass. */
export const MARK_GROUP = 8

/**
 * THE BITMAP OF MARKS, at binding `binding` of group 0, and the two ways a point marks into it.
 * `markCell` sets the bit of a cell of a level, in the order of `ProbeSlots.entryAt` (`cellEntry`).
 * `markPoint` reads the point `P` of normal `N` as the lit passes do (`bounceRead`, the very rule the
 * field is read by, the normal bias included), finds the finest level that holds it and marks the
 * eight probes round it; a point no level reaches marks nothing, the sky light answers there. It tells
 * whether a level held the point. The mark pass marks the surfaces the image shows by it, and a
 * probe's ray the one it hit.
 */
export const marksWgsl = (binding: number) =>
  wgslBlock(
    `marksWgsl(${binding})`,
    [BOUNCE_GRID_HEAD_WGSL, bitAt],
    `@group(0) @binding(${binding}) var<storage,read_write> marks:array<atomic<u32>>;
fn markCell(level:u32,cell:vec3i){
 let entry=cellEntry(level,probeWrap(cell));
 atomicOr(&marks[entry>>5u],1u<<(entry&31u));
}
fn markPoint(P:vec3f,N:vec3f)->bool{
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let read=bounceRead(level,P,N);
  if(!read.holds||read.fade<=0.0){continue;}
  for(var corner=0u;corner<8u;corner++){
   markCell(level,read.corner+vec3i(vec3u(bitAt(corner,0u),bitAt(corner,1u),bitAt(corner,2u))));
  }
  return true;
 }
 return false;
}`,
  )

/**
 * THE MARK PASS: the image tells which cells of the levels it reads. The image is cut into tiles of
 * `markTilePixels` pixels a side; a thread a tile takes the pixel its jitter picks — a point that
 * moves from one mark to the next, `markJitter` marks coming round to the same one —, reads the
 * surface it shows (its depth, its normal), and marks the eight probes round that point
 * (`markPoint`). Sky marks nothing, nor does a point no level reaches: the sky light answers there.
 * The CPU reads the bitmap a few images late (`marks.ts`) and gives each cell it names a probe.
 */
export const BOUNCE_MARK_SHADER = wgslProgram(
  `${wgslConsts({ MARK_TILE: BOUNCE_SETTINGS.markTilePixels, MARK_JITTER: BOUNCE_SETTINGS.markJitter })}
@group(0) @binding(${MARK_BINDINGS.view}) var<uniform> view:View;
@group(0) @binding(${MARK_BINDINGS.depth}) var sceneDepth:texture_depth_2d;
@group(0) @binding(${MARK_BINDINGS.normals}) var sceneNormals:texture_2d<f32>;
/** The pixel of tile \`tile\` this mark looks at: a point of the tile that turns, from one mark to the next, by
 *  the golden steps of a low-discrepancy sequence from a point of its own. */
fn markPixel(tile:vec2u,frame:u32)->vec2u{
 let seed=(tile.x*73856093u)^(tile.y*19349663u);
 let start=vec2f(hashUnit(seed),hashUnit(seed^2654435769u));
 let turn=vec2f(0.7548776662,0.5698402910)*f32(frame%MARK_JITTER);
 return tile*MARK_TILE+min(vec2u(fract(start+turn)*f32(MARK_TILE)),vec2u(MARK_TILE-1u));
}
@compute @workgroup_size(${MARK_GROUP},${MARK_GROUP})
fn markCells(@builtin(global_invocation_id) tile:vec3u){
 if(bounce.counts.w==0u){return;}
 let pixel=markPixel(tile.xy,bounce.frame.z);
 if(any(pixel>=vec2u(view.viewport.xy))){return;}
 let z=textureLoad(sceneDepth,vec2i(pixel),0);
 // Reverse depth: nothing drawn is at zero.
 if(z<=0.0){return;}
 let normal=textureLoad(sceneNormals,vec2i(pixel),0).xyz;
 if(dot(normal,normal)<0.5){return;}
 let P=worldAt(vec2f(pixel)+vec2f(0.5),z);
 markPoint(P,normalize(normal));
}`,
  [
    WORLD_AT_WGSL,
    BOUNCE_GRID_HEAD_WGSL,
    bounceBindingsWgsl(0, MARK_BINDINGS.grid, MARK_BINDINGS.probes),
    marksWgsl(MARK_BINDINGS.marks),
    hashUnit,
  ],
)
