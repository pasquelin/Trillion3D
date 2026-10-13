import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { mixWord } from '../../../math/src/wgsl/sampling.ts'
import { byteOf } from '../../../math/src/wgsl/integer.ts'

/** Bright, stable display colors derived from integer triangle IDs, hashed by the engine's one
 *  integer hash (`mixWord`). */
export const TRIANGLE_PALETTE_WGSL = wgslBlock(
  'TRIANGLE_PALETTE_WGSL',
  [mixWord, byteOf],
  `
fn stableTriangleId(cluster:u32,triangle:u32)->u32{return cluster^mixWord(triangle);}
fn hashColor(id:u32)->vec3f{
 let h=mixWord(id);
 let hue=f32(h&65535u)/65535.0;
 let saturation=0.65+0.25*f32(byteOf(h,2u))/255.0;
 let value=0.78+0.20*f32(byteOf(h,3u))/255.0;
 let channels=abs(fract(vec3f(hue,hue+0.6666667,hue+0.3333333))*6.0-vec3f(3.0));
 return value*mix(vec3f(1.0),clamp(channels-vec3f(1.0),vec3f(0.0),vec3f(1.0)),saturation);
}`,
)
