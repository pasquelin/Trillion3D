import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { SCREEN_PASS_VERTEX } from '../../../diagnostic/screenPass.ts'
import { DIGIT_GLYPH_BITS, FONT_CELLS } from '../../../hair/debugFont.ts'
import { LIGHT_GRID_WGSL } from '../../direct/lightWgsl.ts'

/** The pixels a digit's cell is drawn at, and the pixels from one digit to the next. */
const CELL_PIXELS = 2
const ADVANCE = 8
/** The colour of a cell's border, and of its digits. */
const BORDER = 0.25
const DIGITS = 0.1

/**
 * THE LIGHT GRID VIEW (`lightGridDebug`): over the display image, each cell of the grid in a heat colour from blue (no light) to red (`lightGridDebugMaxThreshold` lights or more) with its
 * count written in its middle, and its borders in grey. A pixel not in a cell with a light keeps the image, as do those past the depth image. `grid` is the grid's buffer; the
 * display and the depth image may differ in size, a pixel being taken to its depth texel and back.
 *
 *   dbg    uniform   display size, the columns across and down, the view (1 the count in the cell of the pixel's depth, 2 the greatest count of the slices but the last, 3 of all), the
 *                    threshold, the one slice shown (-1 none) and the lights of the scene (what a cell with no list walks)
 */
export const LIGHT_GRID_DEBUG_WGSL = wgslProgram(
  `struct GridDebug{display:vec2u,tiles:vec2u,mode:u32,threshold:u32,slice:i32,lights:u32,}
@group(0) @binding(0) var<uniform> dbg:GridDebug;
@group(0) @binding(1) var sceneDepth:texture_depth_2d;
@group(0) @binding(2) var<storage,read> grid:array<u32>;
const DIGIT_GLYPHS=array<u32,10>(${DIGIT_GLYPH_BITS.join('u,')}u);
${SCREEN_PASS_VERTEX}
fn cellCount(column:vec2u,slice:u32)->u32{
 let base=GRID_HEAD+((column.y*dbg.tiles.x+column.x)*GRID_SLICES+slice)*TILE_STRIDE;
 return select(grid[base]&~TILE_SHADOWED,dbg.lights,grid[base+1u]==TILE_NO_SLICE);
}
fn heatColor(x:f32)->vec3f{
 let hue=(1.0-saturate(x))*0.6;
 return saturate(vec3f(abs(hue*6.0-3.0)-1.0,2.0-abs(hue*6.0-2.0),2.0-abs(hue*6.0-4.0)));
}
fn glyphLit(digit:u32,rel:vec2i)->f32{
 if(any(rel<vec2i(0))||rel.x>=${FONT_CELLS.width * CELL_PIXELS}||rel.y>=${FONT_CELLS.height * CELL_PIXELS}){return 0.0;}
 let cell=vec2u(rel/${CELL_PIXELS});
 return f32((DIGIT_GLYPHS[digit]>>(cell.y*3u+cell.x))&1u);
}
fn printDigit(color:vec3f,pixel:vec2i,left:vec2i,digit:u32)->vec3f{
 var out=mix(color,vec3f(0.0),glyphLit(digit,pixel-left-vec2i(1)));
 out=mix(out,vec3f(${DIGITS}),glyphLit(digit,pixel-left));
 return out;
}
@fragment fn fsLightGrid(@builtin(position) position:vec4f)->@location(0) vec4f{
 let extent=textureDimensions(sceneDepth);
 let scale=vec2f(extent)/vec2f(dbg.display);
 let local=vec2u(floor(position.xy*scale));
 let local2=vec2u(floor((position.xy+1.0)*scale));
 if(dbg.tiles.x==0u||dbg.tiles.y==0u||any(local>=extent)){discard;}
 let column=min(local/TILE_SIZE,dbg.tiles-vec2u(1u));
 var count=0u;
 if(dbg.mode==1u&&dbg.slice<0){
  let map=bitcast<vec3f>(vec3u(grid[0],grid[1],grid[2]));
  count=cellCount(column,gridSlice(textureLoad(sceneDepth,vec2i(local),0),map));
 }else{
  let first=select(0u,min(u32(dbg.slice),GRID_SLICES-1u),dbg.slice>=0);
  let end=select(select(GRID_SLICES,GRID_SLICES-1u,dbg.mode==2u),first+1u,dbg.slice>=0);
  for(var slice=first;slice<end;slice++){count=max(count,cellCount(column,slice));}
 }
 let corner=(local/TILE_SIZE)*TILE_SIZE;
 let corner2=(local2/TILE_SIZE)*TILE_SIZE;
 var color=vec3f(0.0);
 var drawn=false;
 if(count>0u){
  drawn=true;
  color=heatColor(f32(count)/f32(dbg.threshold));
  let middle=vec2f(corner+vec2u(TILE_SIZE/2u))/scale;
  var cursor=vec2i(middle);
  var divisor=1u;
  while(count/divisor>=10u&&divisor<1000u){divisor*=10u;}
  for(;divisor>0u;divisor/=10u){
   color=printDigit(color,vec2i(position.xy),cursor,(count/divisor)%10u);
   cursor.x+=${ADVANCE};
  }
 }
 if((corner.x<=local.x&&corner2.x>=local.x)||(corner.y<=local.y&&corner2.y>=local.y)){
  drawn=true;
  color=vec3f(${BORDER});
 }
 if(!drawn){discard;}
 return vec4f(color,1.0);
}`,
  [LIGHT_GRID_WGSL],
)
