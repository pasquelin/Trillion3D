import { FULLSCREEN_XY } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ndcToUv } from '../../../../math/src/wgsl/projection.ts'
/** The composed image times the tint, plus the added value (`displayFilterProgram.ts`); on the
 *  capture target, and the canvas too when presented (an output without a target is dropped). The
 *  layers, at the frame's size or resolved to the display's, are sampled at the display pixel's
 *  place `uv`, the full-screen triangle's. */
export const DISPLAY_FILTER_SHADER = wgslProgram(
  `
@group(0) @binding(0) var tintMap:texture_2d<f32>;
@group(0) @binding(1) var addMap:texture_2d<f32>;
@group(0) @binding(2) var layerSampler:sampler;
@group(0) @binding(3) var<uniform> drawn:vec4f;
struct Screen{@builtin(position) position:vec4f,@location(0) uv:vec2f,}
@vertex fn screen(@builtin(vertex_index) i:u32)->Screen{let c=vec2f(${FULLSCREEN_XY});return Screen(vec4f(c,0.0,1.0),ndcToUv(c)*drawn.xy);}
struct Both{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
fn layer(map:texture_2d<f32>,uv:vec2f)->Both{let v=vec4f(textureSampleLevel(map,layerSampler,uv,0.0).rgb,1.0);return Both(v,v);}
@fragment fn tint(s:Screen)->Both{return layer(tintMap,s.uv);}
@fragment fn add(s:Screen)->Both{return layer(addMap,s.uv);}`,
  [ndcToUv],
)
