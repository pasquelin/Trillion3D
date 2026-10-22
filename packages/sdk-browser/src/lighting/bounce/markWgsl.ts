import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
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
 * THE MARK PASS: the image tells which cells of the levels it reads. The image is cut into tiles of
 * `markTilePixels` pixels a side; a thread a tile takes the pixel its jitter picks — a point that
 * moves from one mark to the next, `markJitter` marks coming round to the same one —, reads the
 * surface it shows (its depth, its normal), finds the finest level that holds that point as the lit
 * passes read it (`bounceRead`, the very rule the field is read by, the normal bias included) and
 * sets the bit of the eight probes round it, a bit a cell in the order of `ProbeSlots.entryAt`
 * (`cellEntry`). Sky marks nothing, nor does a point no level reaches: the sky light answers there.
 * The CPU reads the bitmap a few images late (`marks.ts`) and gives each cell it names a probe.
 */
export const BOUNCE_MARK_SHADER = wgslProgram(
  `${wgslConsts({ MARK_TILE: BOUNCE_SETTINGS.markTilePixels, MARK_JITTER: BOUNCE_SETTINGS.markJitter })}
@group(0) @binding(${MARK_BINDINGS.view}) var<uniform> view:View;
@group(0) @binding(${MARK_BINDINGS.depth}) var sceneDepth:texture_depth_2d;
@group(0) @binding(${MARK_BINDINGS.normals}) var sceneNormals:texture_2d<f32>;
@group(0) @binding(${MARK_BINDINGS.marks}) var<storage,read_write> marks:array<atomic<u32>>;
fn markCell(level:u32,cell:vec3i){
 let entry=cellEntry(level,probeWrap(cell));
 atomicOr(&marks[entry>>5u],1u<<(entry&31u));
}
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
 let N=normalize(normal);
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let read=bounceRead(level,P,N);
  if(!read.holds||read.fade<=0.0){continue;}
  for(var corner=0u;corner<8u;corner++){
   markCell(level,read.corner+vec3i(vec3u(bitAt(corner,0u),bitAt(corner,1u),bitAt(corner,2u))));
  }
  return;
 }
}`,
  [
    WORLD_AT_WGSL,
    BOUNCE_GRID_HEAD_WGSL,
    bounceBindingsWgsl(0, MARK_BINDINGS.grid, MARK_BINDINGS.probes),
    bitAt,
    hashUnit,
  ],
)
