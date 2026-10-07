import {
  DEFORMATION_COMPUTE_WGSL,
  DEFORMATION_NORMALS,
  deformationBindings,
} from './computeWgsl.ts'

/** A binding of the stage: a buffer, or the normal atlas's view (`DEFORMATION_NORMALS`). */
type DeformationResource = GPUBuffer | GPUTextureView
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import { DEFORMATION_PASS } from './pass.ts'
import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { uniformStride } from '../residency/pools.ts'

/** The stage's image records, one per dispatch at its own aligned offset (`slot`): the image
 *  number, then the rows that dispatch deforms — its padding groups leave past them. */
function deformationImage(device: GPUDevice) {
  const stride = uniformStride(device.limits)
  const buffer = device.createBuffer({
    label: 'Trillion3D deformation image',
    size: stride + 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // A record's two words that change, written at each slot; the queue copies them at the call.
  const words = new Uint32Array(2)
  return {
    buffer,
    entry: (slot: number) => ({ buffer, offset: slot * stride, size: 16 }),
    write(frame: number, rows: number, wholeRows: number) {
      words[0] = frame
      words[1] = rows
      device.queue.writeBuffer(buffer, 0, words)
      words[1] = wholeRows
      device.queue.writeBuffer(buffer, stride, words)
    },
  }
}

/** Builds once; binding identities follow cache relocation and table growth, never a steady frame. */
export async function createDeformationCompute(device: GPUDevice) {
  const layout = device.createBindGroupLayout({ entries: deformationBindings() })
  const pipeline = await buildComputePipeline(device, {
    label: DEFORMATION_PASS,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: DEFORMATION_COMPUTE_WGSL }),
      entryPoint: 'deform',
    },
  })
  const image = deformationImage(device)
  const wholeBuffers: DeformationResource[] = []
  const held: { buffers: readonly DeformationResource[]; group: GPUBindGroup }[] = []
  const moved = (buffers: readonly DeformationResource[], slot: number) => {
    if (!held[slot]) return true
    for (let i = 0; i < buffers.length; i++) if (buffers[i] !== held[slot].buffers[i]) return true
    return false
  }
  const bind = (buffers: readonly DeformationResource[], slot: number) => {
    if (moved(buffers, slot))
      held[slot] = {
        buffers: [...buffers],
        group: device.createBindGroup({
          layout,
          entries: [...buffers, image.buffer].map((resource, binding) => ({
            binding,
            resource:
              binding === DEFORMATION_NORMALS
                ? (resource as GPUTextureView)
                : resource === image.buffer
                  ? image.entry(slot)
                  : { buffer: resource as GPUBuffer },
          })),
        }),
      }
    return held[slot].group
  }
  const encode = (
    encoder: GPUCommandEncoder,
    buffers: readonly DeformationResource[],
    rows: number,
    frame: number,
    whole?: { table: GPUBuffer; count: number },
  ) => {
    if (!rows && !whole?.count) return
    image.write(frame, rows, whole?.count ?? 0)
    const pass = encoder.beginComputePass({ label: DEFORMATION_PASS })
    pass.setPipeline(pipeline)
    if (rows) {
      pass.setBindGroup(0, bind(buffers, 0))
      dispatchRows(pass, rows)
    }
    if (whole?.count) {
      for (let i = 0; i < 5; i++) wholeBuffers[i] = i === 3 ? whole.table : buffers[i]
      pass.setBindGroup(0, bind(wholeBuffers, 1))
      dispatchRows(pass, whole.count)
    }
    pass.end()
  }
  return { encode, dispose: () => image.buffer.destroy() }
}

export type DeformationCompute = Awaited<ReturnType<typeof createDeformationCompute>>
