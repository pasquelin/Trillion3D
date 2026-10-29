import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { RENDER_CURVE_PARAMS_WGSL } from './paramsWgsl.ts'

/** The levels of the furthest-depth pyramid of an image `width` by `height`: the first holds half the pixels a side, the last one texel. */
export const renderCurveHzbLevels = (width: number, height: number) =>
  Math.max(1, Math.ceil(Math.log2(Math.max(width, height, 2))))

/** The size of a level of the pyramid, its offset in the buffer `hzb` (the levels one after another, row after row): read by the build and by the culls. */
export const RENDER_CURVE_HZB_LEVEL_WGSL = wgslBlock(
  'RENDER_CURVE_HZB_LEVEL_WGSL',
  [RENDER_CURVE_PARAMS_WGSL],
  `fn hzbSize(level:u32)->vec2u{
 let s=1u<<(level+1u);
 return max((curve.resolution+vec2u(s-1u))/vec2u(s),vec2u(1u));
}
fn hzbOffset(level:u32)->u32{
 var offset=0u;
 for(var l=0u;l<level;l++){
  let d=hzbSize(l);
  offset+=d.x*d.y;
 }
 return offset;
}`,
)

/** The words the pyramid of an image holds. */
export function renderCurveHzbWords(width: number, height: number) {
  let words = 0
  const levels = renderCurveHzbLevels(width, height)
  for (let level = 0; level < levels; level++) {
    const side = 2 ** (level + 1)
    words += ceilDiv(width, side) * ceilDiv(height, side)
  }
  return words
}

/**
 * THE FURTHEST DEPTH PYRAMID OF THE SCENE: level `buildLevel.x` of the buffer `hzb`, one invocation a texel, the least (reverse-Z: the
 * furthest) depth of the four texels below it (level 0: of the scene's depth `sceneDepth`, the pixels past the image's edge left out).
 * Group 0: the shared block (binding 0), the level (1), the scene's depth (2), the pyramid (3).
 */
export const RENDER_CURVE_HZB_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> curve:RenderCurveParams;
@group(0) @binding(1) var<uniform> buildLevel:vec4u;
@group(0) @binding(2) var sceneDepth:texture_depth_2d;
@group(0) @binding(3) var<storage,read_write> hzb:array<f32>;
@compute @workgroup_size(8,8)
fn hzbBuild(@builtin(global_invocation_id) id:vec3u){
 let size=hzbSize(buildLevel.x);
 if(any(id.xy>=size)){return;}
 var furthest=1.0;
 for(var k=0u;k<4u;k++){
  let at=id.xy*2u+vec2u(k&1u,k>>1u);
  if(buildLevel.x==0u){
   if(all(at<curve.resolution)){furthest=min(furthest,textureLoad(sceneDepth,vec2i(at),0));}
  }else{
   let below=hzbSize(buildLevel.x-1u);
   if(all(at<below)){furthest=min(furthest,hzb[hzbOffset(buildLevel.x-1u)+at.y*below.x+at.x]);}
  }
 }
 hzb[hzbOffset(buildLevel.x)+id.y*size.x+id.x]=furthest;
}`,
  [RENDER_CURVE_PARAMS_WGSL, RENDER_CURVE_HZB_LEVEL_WGSL],
)
