import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PROFILE_COLUMNS } from '../../../../sdk-core/src/lighting/subsurfaceProfile/table.ts'
import { glyphBits } from '../../hair/debugFont.ts'
import { SCREEN_PASS_VERTEX } from '../../diagnostic/screenPass.ts'
import { SSS_COMMON_WGSL } from './commonWgsl.ts'
import { SSS_RADIUS_SCALE_WORD } from './shape.ts'

export const SSS_VISUALIZE_ENTRY = 'sssVisualizeFs'

/** The characters a profile's number is written with: the digits, then the letters; any other is a question mark. */
const CHARACTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ?'

/** The kernel texel whose alpha is the profile's scatter reach: the last of the widest kernel. */
const REACH_COLUMN = PROFILE_COLUMNS.kernel0 + PROFILE_COLUMNS.kernel0Size - 1

/** The pixels of scatter reach, over a pixel's half width, below which a profile pixel is faded out (the scattering is then inside the pixel). */
const FADE_PIXELS = 4

/** The pixel's mini font cell, in pixels, and where a glyph of three by five cells starts in it. */
const CELL = 8
const GLYPH_AT = [2, 1] as const

/**
 * THE SUBSURFACE PROFILE MAP (`subsurface-profiles`): over the display image, the lower right quarter shows the whole image's profile of each pixel — the default skin buff, the
 * next profiles red, green, blue, magenta, cyan and yellow, 100 dark green, 255 white, any other a mid grey, a pixel that is no profile pixel grey too — with the profile's number or
 * letter in white in each cell of eight pixels, all faded by the share of the scattering that spreads over more than four pixels of the image (the pixels the
 * scattering leaves alone are dark). The rest of the image is left as it is.
 */
export const SSS_VISUALIZE_WGSL = wgslProgram(
  `@group(1) @binding(0) var<uniform> shown:vec4f;
const GLYPHS=array<u32,${CHARACTERS.length}>(${[...CHARACTERS].map((c) => `${glyphBits(c)}u`).join(',')});
${SCREEN_PASS_VERTEX}
fn characterOf(id:u32)->u32{
 if(id<=9u){return id;}
 if(id-10u<=25u){return id;}
 return ${CHARACTERS.length - 1}u;
}
fn profileColour(id:u32)->vec3f{
 var c=vec3f(0.5);
 if(id==0u){c=vec3f(0.8,0.7,0.6);}
 if(id==1u){c=vec3f(0.5,0.0,0.0);}
 if(id==2u){c=vec3f(0.0,0.5,0.0);}
 if(id==3u){c=vec3f(0.0,0.0,0.5);}
 if(id==4u){c=vec3f(0.5,0.0,0.5);}
 if(id==5u){c=vec3f(0.0,0.5,0.5);}
 if(id==6u){c=vec3f(0.5,0.5,0.0);}
 if(id==100u){c=vec3f(0.0,0.2,0.0);}
 if(id==255u){c=vec3f(1.0);}
 return c;
}
/** How much of the profile's scatter is wider than ${FADE_PIXELS} pixels: 0 where it stays inside the pixel. */
fn fullResolutionShare(depth:f32,reach:f32,opacity:f32)->f32{
 let reachStep=view.scatter.x/depth*${SSS_RADIUS_SCALE_WORD}*reach;
 return saturate(reachStep/(0.5/view.scene.z)-${FADE_PIXELS}.0)*saturate(opacity*10.0);
}
@fragment fn ${SSS_VISUALIZE_ENTRY}(@builtin(position) at:vec4f)->@location(0) vec4f{
 let local=at.xy/shown.xy*2.0-vec2f(1.0);
 // The reference's box test leaves the upper bound of x out: the image's own edge is its bound.
 if(local.x<0.0||local.y<0.0||local.y>=1.0){discard;}
 let p=clamp(vec2i(local*view.scene.xy),vec2i(0),vec2i(view.scene.xy)-vec2i(1));
 var colour=vec3f(0.5);
 if(sssIsProfile(p)){
  let id=sssProfileAt(p);
  colour=profileColour(id);
  let cell=vec2i(at.xy)%${CELL}-vec2i(${GLYPH_AT[0]},${GLYPH_AT[1]});
  if(all(cell>=vec2i(0))&&cell.x<3&&cell.y<5&&((GLYPHS[characterOf(id)]>>u32(cell.y*3+cell.x))&1u)!=0u){colour=vec3f(1.0);}
  let reach=sssRow(${REACH_COLUMN}u,id).a*SSS_KERNEL_SIZE;
  colour*=fullResolutionShare(sssDepthAt(p),reach,sssOpacityAt(p));
 }
 return vec4f(colour,1.0);
}`,
  [SSS_COMMON_WGSL],
)
