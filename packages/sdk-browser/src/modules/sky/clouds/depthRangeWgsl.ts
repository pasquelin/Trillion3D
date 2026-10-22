import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_XY } from '../../../gpu/shader/fullscreenTriangle.ts'

/** The downsample's uniform: how many source pixels a pixel written stands for along each axis
 *  (the source's texture size over the written one's), and the source's bounds, the first and the
 *  last pixel its view fills, which the reads are clamped to. */
export const DEPTH_RANGE_VIEW = fieldLayout('DepthRangeView', [
  ['scale', 'vec2f'],
  ['source', 'vec4i'],
] as const)

/** Where the downsample binds what it reads, in group 0. */
export const DEPTH_RANGE_BINDING = { view: 0, source: 1 } as const

/** The two passes: the first reads the scene's depth, the second the range the first wrote. */
export type DepthRangePass = 'depth' | 'range'

const B = DEPTH_RANGE_BINDING

/**
 * THE SCENE DEPTH RANGE, one pass of the downsample by two: per pixel written, the four pixels at
 * its source position and the one right and below it, each clamped to the source's bounds, give
 * the lowest and the highest device depth, written as `(lowest, highest)`. Under a reversed depth
 * the lowest is the furthest and the highest the closest.
 *
 * The first pass reads the finished opaque depth; the second reads the range the first wrote, and
 * takes the lowest of the lowests and the highest of the highests. Two passes make a texel of
 * the 4×4 block of the view it covers.
 */
export const depthRangeProgram = (pass: DepthRangePass) =>
  `${DEPTH_RANGE_VIEW.wgsl}
@group(0) @binding(${B.view}) var<uniform> view:DepthRangeView;
@group(0) @binding(${B.source}) var source:${pass === 'depth' ? 'texture_depth_2d' : 'texture_2d<f32>'};
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}
fn sourceRange(at:vec2i)->vec2f{
 let c=clamp(at,view.source.xy,view.source.zw);
${pass === 'depth' ? ' let z=textureLoad(source,c,0);\n return vec2f(z,z);' : ' return textureLoad(source,c,0).xy;'}
}
@fragment fn depthRangeMain(@builtin(position) position:vec4f)->@location(0) vec4f{
 let at=vec2i(vec2f(vec2i(position.xy))*view.scale);
 let r0=sourceRange(at);
 let r1=sourceRange(at+vec2i(0,1));
 let r2=sourceRange(at+vec2i(1,1));
 let r3=sourceRange(at+vec2i(1,0));
 return vec4f(min(min(r0.x,r1.x),min(r2.x,r3.x)),max(max(r0.y,r1.y),max(r2.y,r3.y)),0.0,0.0);
}
`

export const DEPTH_RANGE_ENTRY = { vertex: 'fullscreen', fragment: 'depthRangeMain' } as const
