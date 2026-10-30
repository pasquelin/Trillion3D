import { wgslFn } from '../../../math/src/wgsl/decl.ts'

/**
 * THE DEBUG OVERLAYS' SHARED WGSL: the tests of a point against a rectangle and its border, used by the atlas debug views that draw
 * rectangles (`IN_RECT`, `ON_BORDER`, declarations the views list), and the pass that lays the texture they draw over the display image (`BLIT_WGSL`, `overlayBlit.ts`).
 */

/** The test of a point against a rectangle. */
export const IN_RECT = wgslFn(
  'inRect',
  [],
  'fn inRect(at:vec2f,low:vec2f,high:vec2f)->bool{return all(at>=low)&&all(at<=high);}',
)

/** The test of a point against a rectangle's border, `width` thick. */
export const ON_BORDER = wgslFn(
  'onBorder',
  [IN_RECT],
  'fn onBorder(at:vec2f,low:vec2f,high:vec2f,width:f32)->bool{return inRect(at,low,high)&&(any(at-low<=vec2f(width))||any(high-at<=vec2f(width)));}',
)

/** The debug texture laid over the image, one texel to a pixel: drawn in a viewport of its size, the triangle carries the texture's coordinates; its colour is taken as premultiplied by its alpha. */
export const BLIT_WGSL = `
@group(0) @binding(0) var overlay:texture_2d<f32>;
@group(0) @binding(1) var overlaySampler:sampler;
struct Corner{@builtin(position) position:vec4f,@location(0) uv:vec2f}
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->Corner{
 let at=vec2f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1));
 return Corner(vec4f(at,0.0,1.0),vec2f(at.x*0.5+0.5,0.5-at.y*0.5));
}
@fragment fn blit(in:Corner)->@location(0) vec4f{
 return textureSampleLevel(overlay,overlaySampler,in.uv,0.0);
}`
