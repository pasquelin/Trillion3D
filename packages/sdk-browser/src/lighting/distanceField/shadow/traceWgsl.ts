import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { pixelToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { isSubsurfaceModel } from '../../../materials/surface/subsurface.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../../materials/surface/pixelModel.ts'
import { subsurfaceDensity } from '../../subsurfaceDensity.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'
import { DFSH_COMMON_WGSL, dfshCommonWgsl } from './commonWgsl.ts'
import { DFSH_BINDING as B, DFSH_HALF_FORMAT, DFSH_TILE } from './layout.ts'
import { dfshTraceObjectWgsl } from './traceObjectWgsl.ts'

export const DFSH_TRACE_OBJECT_WGSL = dfshTraceObjectWgsl(0)

/**
 * THE RAY OF A POINT THROUGH THE MESHES OF THE TILE IT STARTS IN (`dfshTraceThroughTile`), for the sun `sun` of the `suns` the bind group
 * `group` holds: the positions from the eye, in centimetres, the lists the group's tile bindings hold, one after the other, a sun's after
 * its predecessor's (its tiles from the word `counts.z` of its block, its entries from `view.x`): the tile's meshes in the order of
 * the list, a ray with no cone (no tangent, no least radius), the meshes' surfaces expanded, no thin transmission, until it is wholly
 * occluded; 1 outside the grid of tiles. The cards' direct light reads it for the suns (`lighting/surfaceCache/lighting/meshShadowWgsl.ts`).
 */
export const dfshTileTraceWgsl = (group: number, suns: number) =>
  wgslBlock(
    `DFSH_TILE_TRACE_WGSL ${group} ${suns}`,
    [dfshCommonWgsl(group, suns), dfshTraceObjectWgsl(group, suns)],
    `@group(${group}) @binding(${B.tileOffsets}) var<storage,read> tileOffsets:array<u32>;
@group(${group}) @binding(${B.tileCounts}) var<storage,read> tileCounts:array<u32>;
@group(${group}) @binding(${B.tileData}) var<storage,read> tileData:array<u32>;
var<private> dfshSet:u32=0xffffffffu;
fn dfshTraceThroughTile(sun:u32,rayStart:vec3f,rayEnd:vec3f)->f32{
 if(dfshSet!=sun){dfsh=dfshSuns[sun];dfshSet=sun;}
 let tile=dfshTileOf(rayStart);
 if(tile.x<0){return 1.0;}
 let own=u32(tile.y)*dfsh.tiles.x+u32(tile.x);
 let at=dfsh.counts.z+own;
 let start=dfshTileStart(own,tileOffsets[at]);
 let count=min(tileCounts[at],dfshTileRoom(start));
 var visibility=1.0;
 for(var k=0u;k<count;k++){
  visibility=dfshTraceCone(tileData[dfsh.view.x+start+k],rayStart,rayEnd,0.0,0.0,true,visibility,-1.0);
  if(visibility<0.01){return 0.0;}
 }
 return visibility;
}`,
  )

/**
 * WHAT THE TRACES OF A TEXEL SHARE (`dfshBlockOf` and after): the texel's block of pixels — its top
 * left is the pixel the rays start from, with the depth at it —, whether the cascade reaches it
 * (some pixel of the block, the farthest with a half-resolution result or the top left alone with
 * `distanceFieldShadowSubsampleDepth`, farther than the cascade's nearest depth, and the top left
 * nearer than its farthest), the pixel's position, the ray's two ends — started off the surface by
 * 2 centimetres and the share of the depth (`trace.y`), as long as the light's trace distance —, the
 * density of the light a transmitting pixel lets through (`dfshDensityOf`: negative for a pixel that
 * lets none, where the quality has no transmission (`trace.w`) or the pixel is no thin sheet nor of a
 * subsurface, skin, profile, hair or eye model; else from the opacity in the alpha of the thin
 * transmission's target, a hair's being none) and the store of the visibility with the depth it
 * was traced at into the light's rows of the half-resolution result.
 */
export const DFSH_TRACE_PIXEL_WGSL = wgslBlock(
  'DFSH_TRACE_PIXEL_WGSL',
  [
    DFSH_COMMON_WGSL,
    hizDepthWgsl(0, B.depth),
    pixelToNdc,
    subsurfaceDensity,
    isSubsurfaceModel,
    pixelModelOf,
  ],
  `
@group(0) @binding(${B.half}) var halfFactors:texture_storage_2d<${DFSH_HALF_FORMAT},write>;
@group(0) @binding(${B.flags}) var surfaceFlags:texture_2d<u32>;
@group(0) @binding(${B.subsurface}) var subsurfaceColor:texture_2d<f32>;
struct DfshBlock{top:vec2i,z:f32,depth:f32,farthest:f32}
fn dfshCellsOf()->vec2u{
 let down=dfsh.view.z;
 return (dfsh.view.xy+vec2u(down-1u))/down;
}
// The depth and the ray's start position come from the same texel, the top left of the block.
fn dfshBlockOf(cell:vec2u)->DfshBlock{
 let down=dfsh.view.z;
 let top=vec2i(cell*down);
 let last=vec2i(dfsh.view.xy)-vec2i(1);
 let z=hizOpaqueDepth(top);
 var farthest=z;
 if((dfsh.counts.w&DFSH_SUBSAMPLE_DEPTH)==0u){
  for(var k=1u;k<down*down;k++){
   farthest=min(farthest,hizOpaqueDepth(min(top+vec2i(i32(k%down),i32(k/down)),last)));
  }
 }
 return DfshBlock(top,z,dfshDepthCm(z),dfshDepthCm(farthest));
}
fn dfshBlockReached(block:DfshBlock)->bool{
 return block.farthest>dfsh.range.x&&block.depth<dfsh.range.y;
}
fn dfshPixelPosition(block:DfshBlock)->vec3f{
 return dfshPosition(pixelToNdc(vec2f(block.top)+vec2f(0.5),vec2f(dfsh.view.xy)),block.z);
}
fn dfshRayStart(position:vec3f,depth:f32)->vec3f{
 return position+dfsh.light.xyz*(2.0+dfsh.trace.y*depth);
}
fn dfshRayEnd(position:vec3f)->vec3f{
 return position+dfsh.light.xyz*dfsh.trace.x;
}
fn dfshDensityOf(top:vec2i)->f32{
 let flags=textureLoad(surfaceFlags,top,0).r;
 if(dfsh.trace.w<=0.0||!isSubsurfaceModel(flags)){return -1.0;}
 if(pixelModelOf(flags)==${PIXEL_MODEL.hair}u){return 0.0;}
 return subsurfaceDensity(textureLoad(subsurfaceColor,top,0).a);
}
fn dfshStore(cell:vec2u,size:vec2u,visibility:f32,depth:f32){
 textureStore(halfFactors,vec2u(cell.x,dfsh.view.w*size.y+cell.y),vec4f(visibility,depth,0.0,0.0));
}`,
)

/**
 * THE CASCADE TRACED (`dfshTrace`), a thread a texel of the half-resolution result, in the rows of
 * the light's layer: the pixel at the texel's top left, with the depth at it, rays from its surface
 * toward the sun (`dfshTraceObject`) through the meshes the pixel's tile lists, in the order of the
 * list, stopping at full occlusion. The tile's list starts where the start offsets say, or at the
 * tile's own place when the lists are not compacted, and holds what is left of the room after it
 * (`dfshTileStart`, `dfshTileRoom`). Only a pixel the cascade reaches is traced (`dfshBlockReached`).
 * It writes the visibility and the depth it was traced at (the upsample weighs by it), 1 where
 * nothing was traced.
 */
export const DFSH_TRACE_WGSL = wgslProgram(
  `@group(0) @binding(${B.tileOffsets}) var<storage,read> tileOffsets:array<u32>;
@group(0) @binding(${B.tileCounts}) var<storage,read> tileCounts:array<u32>;
@group(0) @binding(${B.tileData}) var<storage,read> tileData:array<u32>;
fn dfshTraceTile(position:vec3f,depth:f32,tile:vec2i,density:f32)->f32{
 let at=u32(tile.y)*dfsh.tiles.x+u32(tile.x);
 let start=dfshTileStart(at,tileOffsets[at]);
 let count=min(tileCounts[at],dfshTileRoom(start));
 let rayStart=dfshRayStart(position,depth);
 let rayEnd=dfshRayEnd(position);
 var visibility=1.0;
 for(var k=0u;k<count&&visibility>0.0;k++){
  visibility=dfshTraceObject(tileData[start+k],rayStart,rayEnd,dfsh.light.w,visibility,density);
  if(visibility<0.01){visibility=0.0;}
 }
 return visibility;
}
@compute @workgroup_size(${DFSH_TILE},${DFSH_TILE})
fn dfshTrace(@builtin(global_invocation_id) id:vec3u){
 let size=dfshCellsOf();
 if(any(id.xy>=size)){return;}
 let block=dfshBlockOf(id.xy);
 var visibility=1.0;
 if(dfshBlockReached(block)){
  let position=dfshPixelPosition(block);
  let tile=dfshTileOf(position);
  if(tile.x>=0){visibility=dfshTraceTile(position,block.depth,tile,dfshDensityOf(block.top));}
 }
 dfshStore(id.xy,size,visibility,block.depth);
}`,
  [DFSH_COMMON_WGSL, meshFieldWgsl(0, B.objects), DFSH_TRACE_PIXEL_WGSL, DFSH_TRACE_OBJECT_WGSL],
)
