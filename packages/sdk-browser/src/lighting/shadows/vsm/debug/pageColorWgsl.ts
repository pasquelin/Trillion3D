import { wgslFn } from '../../../../../../math/src/wgsl/decl.ts'
import { VSM_LOG2_PAGE } from '../constants.ts'

/** A colour from an integer: the finishing mix of a 32-bit word (murmur), three bytes of it, as the views of the virtual shadow maps colour a page or a level. */
export const vsmIntToColor = wgslFn(
  'vsmIntToColor',
  [],
  `fn vsmIntToColor(index:u32)->vec3f{
 var h=index;
 h^=h>>16u;
 h*=0x85ebca6bu;
 h^=h>>13u;
 h*=0xc2b2ae35u;
 h^=h>>16u;
 return vec3f(f32(h&255u),f32((h>>8u)&255u),f32((h>>16u)&255u))*(1.0/255.0);
}`,
)

/** The colour of the virtual page that holds the texel `virtualTexel` of a map: the hash of its address (x, y shifted ten bits). */
export const vsmVirtualPageColor = wgslFn(
  'vsmVirtualPageColor',
  [vsmIntToColor],
  `fn vsmVirtualPageColor(virtualTexel:vec2u)->vec3f{
 let page=virtualTexel>>vec2u(${VSM_LOG2_PAGE}u);
 return vsmIntToColor(page.x+(page.y<<10u));
}`,
)

/** The grey of a colour, by the Rec. 601 weights. */
export const vsmGrayscale = wgslFn(
  'vsmGrayscale',
  [],
  'fn vsmGrayscale(c:vec3f)->f32{return dot(c,vec3f(0.299,0.587,0.114));}',
)
