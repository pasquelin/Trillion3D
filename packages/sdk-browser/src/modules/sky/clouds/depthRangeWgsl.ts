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

/** The three passes: the first reads the scene's depth, the second the range the first wrote, the
 *  third reads the scene's depth too and writes the half-size checkerboard. */
export type DepthRangePass = 'depth' | 'range' | 'checkerboard'

const B = DEPTH_RANGE_BINDING

/** The four pixels at the source position of the pixel written, the lowest and highest depths
 *  folded into `(lowest, highest)`. */
const RANGE_OF_FOUR = `
 let at=vec2i(vec2f(vec2i(position.xy))*view.scale);
 let r0=sourceRange(at);
 let r1=sourceRange(at+vec2i(0,1));
 let r2=sourceRange(at+vec2i(1,1));
 let r3=sourceRange(at+vec2i(1,0));
 let lowest=min(min(r0.x,r1.x),min(r2.x,r3.x));
 let highest=max(max(r0.y,r1.y),max(r2.y,r3.y));`

const FRAGMENT_RANGE = `
@fragment fn depthRangeMain(@builtin(position) position:vec4f)->@location(0) vec4f{${RANGE_OF_FOUR}
 return vec4f(lowest,highest,0.0,0.0);
}`

const FRAGMENT_CHECKERBOARD = `
@fragment fn depthRangeMain(@builtin(position) position:vec4f)->@location(0) vec4f{${RANGE_OF_FOUR}
 let pixel=vec2i(position.xy);
 let column=u32(pixel.x&1);
 let black=select(1u-column,column,(pixel.y&1)==0);
 return vec4f(select(lowest,highest,black>0u),0.0,0.0,0.0);
}`

/**
 * THE SCENE DEPTH RANGE, one pass of the downsample by two: per pixel written, the four pixels at
 * its source position and the one right and below it, each clamped to the source's bounds, give
 * the lowest and the highest device depth, written as `(lowest, highest)`. Under a reversed depth
 * the lowest is the furthest and the highest the closest.
 *
 * The first pass reads the finished opaque depth; the second reads the range the first wrote, and
 * takes the lowest of the lowests and the highest of the highests. Two passes make a texel of
 * the 4×4 block of the view it covers.
 *
 * The checkerboard pass reads the depth as the first does and writes, in the first channel, the
 * highest of the four depths where the pixel written has its column and row both even or both odd
 * and the lowest elsewhere: the half-size depth of the traces that keep no range.
 */
const program = (pass: DepthRangePass) =>
  `${DEPTH_RANGE_VIEW.wgsl}
@group(0) @binding(${B.view}) var<uniform> view:DepthRangeView;
@group(0) @binding(${B.source}) var source:${pass === 'range' ? 'texture_2d<f32>' : 'texture_depth_2d'};
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}
fn sourceRange(at:vec2i)->vec2f{
 let c=clamp(at,view.source.xy,view.source.zw);
${pass === 'range' ? ' return textureLoad(source,c,0).xy;' : ' let z=textureLoad(source,c,0);\n return vec2f(z,z);'}
}${pass === 'checkerboard' ? FRAGMENT_CHECKERBOARD : FRAGMENT_RANGE}
`

const programs: Partial<Record<DepthRangePass, string>> = {}

/** The text of `pass`'s program, made on its first ask. */
export const depthRangeProgram = (pass: DepthRangePass) => (programs[pass] ??= program(pass))

export const DEPTH_RANGE_ENTRY = { vertex: 'fullscreen', fragment: 'depthRangeMain' } as const
