import {
  DEFORMATION_BINDING,
  DEFORMATION_COMPUTE_WGSL,
  deformationBindings,
} from './computeWgsl.ts'

/** A binding of the stage: a buffer, or the normal atlas's view (`DEFORMATION_BINDING.normals`). */
type DeformationResource = GPUBuffer | GPUTextureView
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import { ANIMATION_BANK_PASS, DEFORMATION_PASS } from './pass.ts'
import { buildComputeStage } from '../gpu/core/computeStages.ts'
import { uniformSlots } from '../session/memory/pools.ts'
import { bufferEntries, sequentialEntries } from '../gpu/core/computeBindings.ts'
import { heldGroup } from '../gpu/bind/bindIdentity.ts'
import { ANIMATION_BANK_WGSL, animationBankBindings } from './bankWgsl.ts'
import type { SessionDeformation } from './session.ts'

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

/**
 * The bank pass (`bankWgsl.ts`) on `pipeline`, its group made by `layout`: every track's palettes
 * posed into its record in the float pool `positions`, before the stage reads them. Each image it
 * sends the tracks' table and its own record — the tracks, whether they blend their keys, the
 * deformation block's first float in the pool —; the banks' floats only when a banks joined the
 * session's tracks since they were last sent (the tracks' `revision`). Each buffer is made again,
 * at its size, when what it holds grew.
 */
function animationBankPass(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  pipeline: GPUComputePipeline,
) {
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const record = device.createBuffer({
    label: 'Trillion3D animation bank record',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array(4)
  let banks: GPUBuffer | undefined,
    table: GPUBuffer | undefined,
    sent = -1
  const held = heldGroup()
  return {
    encode(
      encoder: GPUCommandEncoder,
      positions: GPUBuffer,
      { tracks, base }: Pick<SessionDeformation, 'tracks' | 'base'>,
    ) {
      if (!banks || sent !== tracks.revision) {
        const floats = tracks.pool()
        banks?.destroy()
        banks = device.createBuffer({
          label: 'Trillion3D animation banks',
          size: floats.byteLength,
          usage: STORAGE,
        })
        device.queue.writeBuffer(banks, 0, floats)
        sent = tracks.revision
      }
      if (!table || table.size < tracks.table.byteLength) {
        table?.destroy()
        table = device.createBuffer({
          label: 'Trillion3D animation bank tracks',
          size: tracks.table.byteLength,
          usage: STORAGE,
        })
      }
      device.queue.writeBuffer(table, 0, tracks.table)
      words[0] = tracks.count
      words[1] = tracks.interpolate ? 1 : 0
      words[2] = base
      device.queue.writeBuffer(record, 0, words)
      // The group, in `ANIMATION_BANK_BINDING`'s order, made again when a buffer it names moved.
      const { next } = held.identity
      next[0] = positions
      next[1] = banks
      next[2] = table
      next[3] = record
      next.length = 4
      if (held.identity.moved())
        held.group = device.createBindGroup({
          layout,
          entries: bufferEntries([positions, banks, table, record]),
        })
      const pass = encoder.beginComputePass({ label: ANIMATION_BANK_PASS })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, held.group!)
      dispatchRows(pass, tracks.count)
      pass.end()
    },
    dispose() {
      banks?.destroy()
      table?.destroy()
      record.destroy()
    },
  }
}

/** Builds once; binding identities follow cache relocation and table growth, never a steady frame.
 *  The stage's pipeline and the bank pass's are built together. */
export async function createDeformationCompute(device: GPUDevice) {
  const layout = device.createBindGroupLayout({ entries: deformationBindings() })
  const bankLayout = device.createBindGroupLayout({ entries: animationBankBindings() })
  const [pipeline, bankPipeline] = await Promise.all([
    buildComputeStage(
      device,
      [layout],
      device.createShaderModule({ code: DEFORMATION_COMPUTE_WGSL }),
      'deform',
      undefined,
      DEFORMATION_PASS,
    ),
    buildComputeStage(
      device,
      [bankLayout],
      device.createShaderModule({ code: ANIMATION_BANK_WGSL }),
      'poseTracks',
      undefined,
      ANIMATION_BANK_PASS,
    ),
  ])
  const banks = animationBankPass(device, bankLayout, bankPipeline)
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
    deformation?: Pick<SessionDeformation, 'tracks' | 'base'>,
  ) => {
    if (!rows && !pooled?.count) return
    // The tracks' palettes first: the rows of the placements playing them read them below.
    if (deformation?.tracks.count)
      banks.encode(encoder, buffers[DEFORMATION_BINDING.positions] as GPUBuffer, deformation)
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
  return {
    encode,
    dispose() {
      image.buffer.destroy()
      banks.dispose()
    },
  }
}

export type DeformationCompute = Awaited<ReturnType<typeof createDeformationCompute>>
