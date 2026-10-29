import { DISPLAY_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'

/** The vertex stage of a screen pass: one triangle that covers the viewport; the fragment stage chooses the pixels it paints. */
export const SCREEN_PASS_VERTEX = `@vertex fn screenPassVs(@builtin(vertex_index) vertex:u32)->@builtin(position) vec4f{
 let corner=vec2f(f32((vertex<<1u)&2u),f32(vertex&2u));
 return vec4f(corner*2.0-vec2f(1.0),0.0,1.0);
}`

/**
 * THE ONE SCREEN PASS OF THE DIAGNOSTIC VIEWS: a fragment stage `entry` of `code` (which includes `SCREEN_PASS_VERTEX`) over the display image, painting only the
 * pixels it does not discard. Compiled off the frame.
 */
export function screenPassPipeline(
  device: GPUDevice,
  label: string,
  code: string,
  entry: string,
  layout: GPUPipelineLayout | 'auto' = 'auto',
) {
  const module = device.createShaderModule({ label, code })
  return preparedPipeline(device, {
    label,
    layout,
    vertex: { module, entryPoint: 'screenPassVs' },
    fragment: { module, entryPoint: entry, targets: [{ format: DISPLAY_FORMAT }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  }).ask()
}

/** The bind group of a screen pass whose layout the pipeline derives: `resources` at the bindings 0, 1, 2... */
export const screenPassGroup = (
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  resources: GPUBindingResource[],
) =>
  device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: sequentialEntries(resources),
  })

/** Draws `pipeline` over `target` with `groups` at the groups 0, 1... , inside `rect` (x, y, width, height in pixels) or the whole image. */
export function drawScreenPass(
  encoder: GPUCommandEncoder,
  label: string,
  pipeline: GPURenderPipeline,
  target: GPUTextureView,
  groups: readonly GPUBindGroup[],
  rect?: readonly [number, number, number, number],
) {
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
  })
  if (rect) pass.setViewport(rect[0], rect[1], rect[2], rect[3], 0, 1)
  pass.setPipeline(pipeline)
  groups.forEach((group, at) => pass.setBindGroup(at, group))
  pass.draw(3)
  pass.end()
}
