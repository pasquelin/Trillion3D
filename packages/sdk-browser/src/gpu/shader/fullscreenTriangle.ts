/**
 * The full-screen triangle: corners (−1, −1), (3, −1) and (−1, 3) from the vertex index alone, no
 * buffer and no attribute, covering the viewport. One home for every program that draws it: each
 * axis is an expression of the vertex index `i`, so a program writes the corner as it needs it —
 * a position, a depth of its own, a coordinate it derives. Expressions, not declarations: a
 * program writes them in its own text.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

const FULLSCREEN_X = 'f32(i32(i&1u)*4-1)'
const FULLSCREEN_Y = 'f32(i32(i>>1u)*4-1)'
export const FULLSCREEN_XY = `${FULLSCREEN_X},${FULLSCREEN_Y}`
/** The full-screen triangle's vertex stage, which every full-screen pass lists. */
export const FULLSCREEN_VERTEX = wgslBlock(
  'FULLSCREEN_VERTEX',
  [],
  `@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}`,
)

/** One full-screen triangle drawn through `descriptor` with `pipeline`, `groups` bound at 0, 1, … (`offsets` the
 *  dynamic offsets of the last), over the first `width × height` pixels where given, else the whole target;
 *  nothing drawn while the pipeline is not compiled. */
export function drawFullscreenTriangle(
  encoder: GPUCommandEncoder,
  descriptor: GPURenderPassDescriptor,
  pipeline: GPURenderPipeline | undefined,
  groups: GPUBindGroup | readonly GPUBindGroup[],
  width?: number,
  height?: number,
  offsets?: readonly number[],
) {
  if (!pipeline) return
  const pass = encoder.beginRenderPass(descriptor)
  if (width !== undefined) pass.setViewport(0, 0, width, height!, 0, 1)
  pass.setPipeline(pipeline)
  if ('length' in groups) {
    const last = groups.length - 1
    for (let at = 0; at <= last; at++) {
      if (at === last && offsets) pass.setBindGroup(at, groups[at], offsets)
      else pass.setBindGroup(at, groups[at])
    }
  } else if (offsets) pass.setBindGroup(0, groups, offsets)
  else pass.setBindGroup(0, groups)
  pass.draw(3)
  pass.end()
}
