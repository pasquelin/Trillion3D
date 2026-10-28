import { heldColour } from '../../gpu/core/heldAttachment.ts'
import { preparedPipeline, type PreparedPipeline } from '../deferred/fullscreen.ts'
import type { sphereBuffers } from './ao/sphere.ts'

/** What a scatter's pipeline is made of: its pipeline `layout`, its shader `module` and the entries of its vertex stage and of its
 *  fragment stage (`fragment`), the `format` of the stand-in target that no colour is written to, and whether it draws the bounding
 *  sphere's faces (`sphere`, the front faces culled, for the eye may be inside) or the bounding boxes' (the back faces culled). */
export interface TileScatterSpec {
  label: string
  layout: GPUPipelineLayout
  module: GPUShaderModule
  vertex: string
  fragment: string
  format: GPUTextureFormat
  sphere: boolean
}

/** The scatter's draw into a stand-in target no colour is written to: the pass that lists the meshes by the tiles they reach. */
export const tileScatterPipeline = (device: GPUDevice, spec: TileScatterSpec) =>
  preparedPipeline(device, {
    label: spec.label,
    layout: spec.layout,
    vertex: {
      module: spec.module,
      entryPoint: spec.vertex,
      ...(spec.sphere && {
        buffers: [
          {
            arrayStride: 16,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' as const }],
          },
        ],
      }),
    },
    fragment: {
      module: spec.module,
      entryPoint: spec.fragment,
      targets: [{ format: spec.format, writeMask: 0 }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: spec.sphere ? 'front' : 'back',
      frontFace: 'ccw',
    },
  })

/** The scatter's target held by its call site, and the descriptors of its two passes, the count and the write: the target's `view`
 *  is set before each (`encodeTileScatter`'s `descriptor`). */
export function tileScatterTargets(label: string) {
  const target = heldColour({ loadOp: 'clear', storeOp: 'discard' })
  const pass = (which: string): GPURenderPassDescriptor => ({
    label: `${label} ${which} tiles`,
    colorAttachments: [target],
  })
  return { target, count: pass('count'), write: pass('write') }
}

/** The meshes drawn into the grid of `width` × `height` tiles by `descriptor`: one draw of the arguments `args` the culling wrote —
 *  indexed over `sphere`'s buffers where the bounding spheres are drawn, over the boxes otherwise — with the group 0 `group` at the
 *  dynamic `offset` where it has one. False, nothing drawn, while the pipeline is not compiled. */
export function encodeTileScatter(
  encoder: GPUCommandEncoder,
  descriptor: GPURenderPassDescriptor,
  pipeline: PreparedPipeline<GPURenderPipeline>,
  group: GPUBindGroup,
  width: number,
  height: number,
  args: GPUBuffer,
  sphere?: ReturnType<typeof sphereBuffers>,
  offset?: number,
) {
  const compiled = pipeline.get()
  if (!compiled) return false
  const pass = encoder.beginRenderPass(descriptor)
  pass.setViewport(0, 0, width, height, 0, 1)
  pass.setPipeline(compiled)
  if (offset === undefined) pass.setBindGroup(0, group)
  else pass.setBindGroup(0, group, [offset])
  if (sphere) {
    pass.setVertexBuffer(0, sphere.vertices)
    pass.setIndexBuffer(sphere.indices, 'uint16')
    pass.drawIndexedIndirect(args, 0)
  } else pass.drawIndirect(args, 0)
  pass.end()
  return true
}
