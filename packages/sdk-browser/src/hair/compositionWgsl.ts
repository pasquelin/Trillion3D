import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { fogOverModules } from '../lighting/fog/fogPassWgsl.ts'
import { hairTileQuad } from './tilesWgsl.ts'
import {
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
  HAIR_TILE_ALL,
} from './visibilityMath.ts'

/** The bindings of the composition's own group (group 1); group 0 is the fog pass's. */
export const HAIR_COMPOSE_GROUP = {
  image: 0,
  tiles: 1,
  nodeIndex: 2,
  coverage: 3,
  light: 4,
  nodeCounter: 5,
  nearestDepth: 6,
} as const
/** The words of the image block of the composition (`HairComposeImage`): the size drawn, the room of a list of tiles. */
export const HAIR_COMPOSE_IMAGE_WORDS = 4

const G = HAIR_COMPOSE_GROUP

/**
 * THE STRANDS LAID ON THE LIT IMAGE, drawn over the tiles with strands: a pixel's light is the sum of the light of
 * its compacted samples (each already multiplied by its share of the pixel, `hairLightMain`), read from the grid they were lit
 * on, taken through the fog along the way to the nearest strand (`fogOpaque`, the fog pass's own: the height fog, the local
 * volumes, the fog's volume and the haze) and multiplied by the share of the pixel the strands cover. The result is premultiplied
 * (the pipeline blends it with `one` and `1 - alpha`): the image under the strands lets through what they do not cover.
 * Group 0 is the fog pass's, group 1 the strands'.
 */
export const hairComposeWgsl = (localFog: boolean) =>
  wgslBlock(
    `hairComposeWgsl(${localFog})`,
    [...fogOverModules(localFog), hairTileQuad],
    `struct HairComposeImage{size:vec2u,capacity:u32,pad:u32}
@group(1) @binding(${G.image}) var<uniform> hairImage:HairComposeImage;
@group(1) @binding(${G.tiles}) var<storage,read> hairTiles:array<u32>;
@group(1) @binding(${G.nodeIndex}) var hairNodeIndex:texture_2d<u32>;
@group(1) @binding(${G.coverage}) var hairCoverage:texture_2d<f32>;
@group(1) @binding(${G.light}) var hairLightGrid:texture_2d<f32>;
@group(1) @binding(${G.nodeCounter}) var<storage,read> hairCounter:array<u32>;
@group(1) @binding(${G.nearestDepth}) var hairNearest:texture_2d<f32>;
@vertex fn hairComposeVs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) rank:u32)->@builtin(position) vec4f{
 return hairTileQuad(vertex,hairTiles[${HAIR_TILE_ALL}u*hairImage.capacity+rank],hairImage.size);
}
@fragment fn hairComposeFs(@builtin(position) position:vec4f)->@location(0) vec4f{
 let pixel=vec2i(position.xy);
 let desc=textureLoad(hairNodeIndex,pixel,0).x;
 let count=desc>>${HAIR_NODE_OFFSET_BITS}u;
 let covered=textureLoad(hairCoverage,pixel,0).r;
 if(count==0u||covered<=0.0){discard;}
 let first=desc&${HAIR_NODE_OFFSET_MASK}u;
 let side=u32(ceil(sqrt(f32(hairCounter[${HAIR_NODE_COUNTER_STORED}]))));
 var light=vec3f(0.0);
 for(var i=0u;i<count;i++){
  let index=first+i;
  light+=textureLoad(hairLightGrid,vec2i(i32(index%side),i32(index/side)),0).rgb;
 }
 // The fog along the way to the nearest strand, as the fog pass lays it on a surface; a view of one lighting term shows it unfogged.
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(view.views.x==0.0){
  over=fogOpaque(worldAt(position.xy,textureLoad(hairNearest,pixel,0).x),view.display.yzw,position.xy);
 }
 return vec4f((light*over.a+preExposed(over.rgb))*min(covered,1.0),min(covered,1.0));
}`,
  )
