import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { INVALID_DEPTH_WORD } from './layout.ts'

/** The views of the atlas, by the code the viewer's uniform holds. */
export const ATLAS_VIEWS = {
  'surface-cache-albedo': 0,
  'surface-cache-normal': 1,
  'surface-cache-depth': 2,
  'surface-cache-cards': 3,
  'surface-cache-fill': 4,
  'surface-cache-age': 5,
} as const

/** The viewer's uniform: the view, the atlas's side in texels and in tiles, the image's clock and
 *  the canvas's size. */
export const ATLAS_VIEW_UNIFORM = fieldLayout('AtlasView', [
  ['view', 'u32'],
  ['side', 'u32'],
  ['tiles', 'u32'],
  ['frame', 'u32'],
  ['canvas', 'vec2f'],
  ['padA', 'f32'],
  ['padB', 'f32'],
] as const)

/** The bit of a tile's first word that says its page is of its card's coarsest level. */
export const TILE_LOCKED = 0x80000000

/**
 * THE VIEWER OF THE ATLAS: the whole physical atlas as a square picture, fitted to the canvas and
 * centred, one of its layers or one of what the CPU knows of each tile of 8 × 8 texels
 * (`ATLAS_VIEWS`): the albedo as stored, the normal in its card's frame, the depth in its card's box, the
 * card of the tile, whether it is held and of which kind of page, and how long ago its page was captured.
 * A tile is two words: its card plus one — 0 for a tile no page holds — with the top bit set where its
 * page is of the coarsest level, and the image its page was captured at.
 */
export const ATLAS_VIEW_WGSL = wgslProgram(
  `${ATLAS_VIEW_UNIFORM.wgsl}
${wgslConsts({ LOCKED: TILE_LOCKED, INVALID_DEPTH: INVALID_DEPTH_WORD })}
@group(0) @binding(0) var<uniform> view:AtlasView;
@group(0) @binding(1) var albedo:texture_2d<f32>;
@group(0) @binding(2) var normal:texture_2d<f32>;
@group(0) @binding(3) var depth:texture_2d<u32>;
@group(0) @binding(4) var<storage,read> tileInfo:array<vec2u>;
/** A colour for card \`card\`: its number's hash. */
fn cardColor(card:u32)->vec3f{
 var h=card*747796405u+2891336453u;
 h=((h>>((h>>28u)+4u))^h)*277803737u;
 h=(h>>22u)^h;
 return 0.25+0.75*vec3f(f32(h&255u),f32((h>>8u)&255u),f32((h>>16u)&255u))/255.0;
}
@fragment fn atlas(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let size=min(view.canvas.x,view.canvas.y);
 let at=(pixel.xy-0.5*(view.canvas-vec2f(size)))/size;
 if(any(at<vec2f(0.0))||any(at>=vec2f(1.0))){return vec4f(0.08,0.08,0.08,1.0);}
 let texel=vec2i(at*f32(view.side));
 let tile=texel/8;
 let info=tileInfo[u32(tile.y)*view.tiles+u32(tile.x)];
 let held=(info.x&~LOCKED)!=0u;
 let word=textureLoad(depth,texel,0).x&0xffffu;
 let hasSurface=word<INVALID_DEPTH;
 var color=vec3f(0.0);
 switch(view.view){
  case 0u:{if(hasSurface){color=textureLoad(albedo,texel,0).xyz;}}
  case 1u:{
   if(hasSurface){
    let xy=textureLoad(normal,texel,0).xy*2.0-vec2f(1.0);
    color=vec3f(xy,sqrt(max(1.0-dot(xy,xy),0.0001)))*0.5+vec3f(0.5);
   }
  }
  case 2u:{color=select(vec3f(1.0,0.0,1.0),vec3f(f32(word)/65535.0),hasSurface);}
  case 3u:{if(held){color=cardColor((info.x&~LOCKED)-1u);}}
  case 4u:{if(held){color=select(vec3f(0.1,0.2,1.0),vec3f(0.1,1.0,0.2),(info.x&LOCKED)!=0u);}}
  default:{
   if(held){
    let age=f32(view.frame-info.y);
    color=select(mix(vec3f(1.0,0.0,0.0),vec3f(0.0,0.0,1.0),saturate(age/8.0)),vec3f(1.0),age<1.0);
   }
  }
 }
 // The edges of the pages of the atlas, faint, so that a page reads as one.
 let edge=fract(at*f32(view.side)/128.0);
 let line=select(1.0,0.75,any(edge<vec2f(0.004)));
 return vec4f(color*line,1.0);
}`,
  [FULLSCREEN_VERTEX],
)
