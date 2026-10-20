import {
  DEFORMATION_BINDING,
  DEFORMATION_COMPUTE_WGSL,
  deformationBindings,
} from './computeWgsl.ts'

/** A binding of the stage: a buffer, or the normal atlas's view (`DEFORMATION_BINDING.normals`). */
type DeformationResource = GPUBuffer | GPUTextureView
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import { DEFORMATION_PASS } from './pass.ts'
import { buildComputeStage } from '../gpu/core/computeStages.ts'
import { uniformSlots } from '../residency/pools.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { heldGroup } from '../webgpu/core/bindIdentity.ts'

/** The stage's image records, one per dispatch at its own aligned offset (`slot`): the image
 *  number, then the rows that dispatch deforms — its padding groups leave past them. */
function deformationImage(device: GPUDevice) {
  const slots = uniformSlots(device.limits, 2, 4)
  const buffer = device.createBuffer({
    label: 'Trillion3D deformation image',
    size: slots.offset(1)[0] + 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // A record's two words that change, written at each slot; the queue copies them at the call.
  const words = new Uint32Array(2)
  return {
    buffer,
    entry: (slot: number) => ({ buffer, offset: slots.offset(slot)[0], size: 16 }),
    write(frame: number, rows: number, pooledRows: number) {
      words[0] = frame
      words[1] = rows
      device.queue.writeBuffer(buffer, 0, words)
      if (!pooledRows) return
      words[1] = pooledRows
      device.queue.writeBuffer(buffer, slots.offset(1)[0], words)
    },
  }
}

/** Builds once; binding identities follow cache relocation and table growth, never a steady frame. */
export async function createDeformationCompute(device: GPUDevice) {
  const layout = device.createBindGroupLayout({ entries: deformationBindings() })
  const pipeline = await buildComputeStage(
    device,
    [layout],
    device.createShaderModule({ code: DEFORMATION_COMPUTE_WGSL }),
    'deform',
    undefined,
    DEFORMATION_PASS,
  )
  const image = deformationImage(device)
  const pooledBuffers: DeformationResource[] = []
  // One group per dispatch slot (0 rows, 1 pooled), made again when a resource it names moved.
  const held = [heldGroup(), heldGroup()]
  const bind = (buffers: readonly DeformationResource[], slot: number) => {
    const kept = held[slot],
      { next } = kept.identity
    next.length = buffers.length
    for (let i = 0; i < buffers.length; i++) next[i] = buffers[i]
    if (kept.identity.moved())
      kept.group = device.createBindGroup({
        layout,
        entries: sequentialEntries(
          [...buffers, image.buffer].map((resource, at) =>
            at === DEFORMATION_BINDING.normals
              ? (resource as GPUTextureView)
              : at === DEFORMATION_BINDING.image
                ? image.entry(slot)
                : { buffer: resource as GPUBuffer },
          ),
        ),
      })
    return kept.group!
  }
  const encode = (
    encoder: GPUCommandEncoder,
    buffers: readonly DeformationResource[],
    rows: number,
    frame: number,
    pooled?: { table: GPUBuffer; count: number },
  ) => {
    if (!rows && !pooled?.count) return
    image.write(frame, rows, pooled?.count ?? 0)
    const pass = encoder.beginComputePass({ label: DEFORMATION_PASS })
    pass.setPipeline(pipeline)
    if (rows) {
      pass.setBindGroup(0, bind(buffers, 0))
      dispatchRows(pass, rows)
    }
    if (pooled?.count) {
      // The float-pool blocks' set: the passes' resources, their rows the pooled table.
      pooledBuffers.splice(0, pooledBuffers.length, ...buffers)
      pooledBuffers[DEFORMATION_BINDING.pages] = pooled.table
      pass.setBindGroup(0, bind(pooledBuffers, 1))
      dispatchRows(pass, pooled.count)
    }
    pass.end()
  }
  return { encode, dispose: () => image.buffer.destroy() }
}

export type DeformationCompute = Awaited<ReturnType<typeof createDeformationCompute>>
