import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { visPageIndex, visRowIn } from '../../visibility/visWords.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { bitIsSet, bitWord } from '../../../../math/src/wgsl/integer.ts'

/** Bytes of one outline's uniform, the `Outline` struct: its colour, the identifiers' texels per
 *  display pixel and their size, the line's width and the reach of its scans, in display pixels. */
export const OUTLINE_UNIFORM_BYTES = 48

const OUTLINE_STRUCT = wgslStruct(
  'Outline',
  [],
  `struct Outline{color:vec4f,scale:vec2f,idSize:vec2f,width:f32,reach:i32,}`,
)

/**
 * The outline's programs (`webgpuOutline.ts`), a separable exact distance to the selection in two
 * passes at the display's size:
 * - `across` reads, for each pixel, the identifiers of its row out to the line's reach, each
 *   through its page row to its placement (`pages[row].placement`) and that placement's bit in
 *   `chosen`, and writes how far the nearest chosen one lies (`OUTLINE_FORMAT`), nearest first, so
 *   a pixel on or beside the selection stops at once;
 * - `over` takes, down its column, the nearest of those, `√(dx² + dy²)`, and lays the colour over
 *   the display image where it is within the line's width, its last pixel weighed by the share it
 *   covers: a pixel of the selection itself is left as it is, so only the silhouette's outside is
 *   lined — what hides a selected object shows no line of it, the visible silhouette alone.
 * An identifier of no page (the background, an impostor card) or of a row past the table is chosen
 * by nothing. `overPresent` writes the canvas the composition presented to as well.
 */
export const OUTLINE_WGSL = wgslProgram(
  `
@group(0) @binding(0) var ids:texture_2d<u32>;
@group(0) @binding(1) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(2) var<storage,read> chosen:array<u32>;
@group(0) @binding(3) var<uniform> outline:Outline;
@group(1) @binding(0) var near:texture_2d<f32>;
fn chosenAt(pixel:vec2i)->bool{
 let texel=vec2i((vec2f(pixel)+0.5)*outline.scale);
 if(any(texel<vec2i(0))||any(vec2f(texel)>=outline.idSize)){return false;}
 let id=textureLoad(ids,texel,0).r;
 if(!visRowIn(id,arrayLength(&pages))){return false;}
 let placement=pages[visPageIndex(id)].placement;
 let word=bitWord(placement);
 return word<arrayLength(&chosen)&&bitIsSet(chosen[word],placement);
}
@fragment fn across(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let at=vec2i(pixel.xy);
 var k=0;
 loop{
  if(k>outline.reach||chosenAt(at+vec2i(k,0))||chosenAt(at-vec2i(k,0))){break;}
  k++;
 }
 return vec4f(f32(k)/255.0,0.0,0.0,0.0);
}
fn acrossAt(pixel:vec2i)->i32{return i32(round(textureLoad(near,pixel,0).r*255.0));}
fn lineAt(pixel:vec4f)->vec4f{
 let at=vec2i(pixel.xy);
 if(acrossAt(at)==0){return vec4f(0.0);}
 let rows=i32(textureDimensions(near).y);
 var nearest=f32(1e9);
 for(var dy=-outline.reach;dy<=outline.reach;dy++){
  let y=at.y+dy;
  if(y<0||y>=rows){continue;}
  let dx=acrossAt(vec2i(at.x,y));
  if(dx<=outline.reach){nearest=min(nearest,f32(dx*dx+dy*dy));}
 }
 let share=clamp(outline.width+1.0-sqrt(nearest),0.0,1.0)*outline.color.a;
 return vec4f(outline.color.rgb*share,share);
}
@fragment fn over(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let line=lineAt(pixel);
 if(line.a<=0.0){discard;}
 return line;
}
struct Shown{@location(0) display:vec4f,@location(1) canvas:vec4f,}
@fragment fn overPresent(@builtin(position) pixel:vec4f)->Shown{
 let line=lineAt(pixel);
 if(line.a<=0.0){discard;}
 return Shown(line,line);
}`,
  [
    OUTLINE_STRUCT,
    PAGE_INFO_STRUCT_WGSL,
    visPageIndex,
    visRowIn,
    bitWord,
    bitIsSet,
    FULLSCREEN_VERTEX,
  ],
)
