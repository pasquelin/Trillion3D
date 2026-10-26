import { retire } from '../gpu/core/frameRetire.ts'
import { ComputeRun } from '../gpu/core/lazyComputePass.ts'
import {
  DEFORMATION_BINDING,
  DEFORMATION_COMPUTE_WGSL,
  deformationBindings,
} from './computeWgsl.ts'

/** A binding of the stage: a buffer, or the normal atlas's view (`DEFORMATION_BINDING.normals`). */
type DeformationResource = GPUBuffer | GPUTextureView
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import { ANIMATION_BANK_PASS, DEFORMATION_PASS } from './pass.ts'

const BANK_PASS: GPUComputePassDescriptor = { label: ANIMATION_BANK_PASS }
const DEFORM_PASS: GPUComputePassDescriptor = { label: DEFORMATION_PASS }
/** The bank pass and the float-pool blocks' pass, one compute pass but on a frame timed per pass. */
const poolRun = new ComputeRun()
import { buildComputeStage } from '../gpu/core/computeStages.ts'
import { DEFORM } from '../visibility/decode/contract.ts'
import { uniformSlots } from '../session/memory/pools.ts'
import { bufferEntries, sequentialEntries } from '../gpu/core/computeBindings.ts'
import { heldGroup } from '../gpu/bind/bindIdentity.ts'
import { ANIMATION_BANK_WGSL, animationBankBindings } from './bankWgsl.ts'
import type { SessionDeformation } from './session.ts'

/** The stage's image records, one per dispatch at its own aligned offset (`slot`): the image
 *  number, then the rows that dispatch deforms — its padding groups leave past them. Slot 0 is the
 *  clusters' dispatch, which the decode's list sizes, slot 1 the float-pool blocks'. */
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
    /** The image number the clusters' dispatch reads. */
    writeFrame(frame: number) {
      words[0] = frame
      words[1] = 0
      device.queue.writeBuffer(buffer, 0, words)
    },
    /** The image number and the rows of the float-pool blocks' dispatch. */
    writePooled(frame: number, rows: number) {
      words[0] = frame
      words[1] = rows
      device.queue.writeBuffer(buffer, slots.offset(1)[0], words)
    },
  }
}

/** The buffers the bank pass reads: every banks' floats, and the tracks' table; the `revision` of
 *  the tracks the floats were sent at. */
type BankBuffers = { banks?: GPUBuffer; table?: GPUBuffer; sent: number }

/** The bank pass's buffers made again, at their size, when what they hold grew, and the tracks'
 *  table sent; nothing is allocated in a steady frame. */
function fitBankBuffers(
  device: GPUDevice,
  held: BankBuffers,
  tracks: Pick<SessionDeformation['tracks'], 'revision' | 'pool' | 'table'>,
) {
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  if (!held.banks || held.sent !== tracks.revision) {
    const floats = tracks.pool()
    if (held.banks) retire(device, held.banks)
    held.banks = device.createBuffer({
      label: 'Trillion3D animation banks',
      size: floats.byteLength,
      usage: STORAGE,
    })
    device.queue.writeBuffer(held.banks, 0, floats)
    held.sent = tracks.revision
  }
  if (!held.table || held.table.size < tracks.table.byteLength) {
    if (held.table) retire(device, held.table)
    held.table = device.createBuffer({
      label: 'Trillion3D animation bank tracks',
      size: tracks.table.byteLength,
      usage: STORAGE,
    })
  }
  device.queue.writeBuffer(held.table, 0, tracks.table)
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
  const record = device.createBuffer({
    label: 'Trillion3D animation bank record',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array(4)
  const held = heldGroup()
  const buffers: BankBuffers = { sent: -1 }
  return {
    encode(
      steps: ComputeRun,
      positions: GPUBuffer,
      { tracks, base }: Pick<SessionDeformation, 'tracks' | 'base'>,
    ) {
      fitBankBuffers(device, buffers, tracks)
      const banks = buffers.banks!,
        table = buffers.table!
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
      const pass = steps.pass(BANK_PASS)
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, held.group!)
      dispatchRows(pass, tracks.count)
    },
    dispose() {
      buffers.banks?.destroy()
      buffers.table?.destroy()
      record.destroy()
    },
  }
}

/** The stage's two pipelines and the bank pass's, built together. */
function buildDeformationStages(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  bankLayout: GPUBindGroupLayout,
) {
  const module = device.createShaderModule({ code: DEFORMATION_COMPUTE_WGSL })
  return Promise.all([
    buildComputeStage(device, [layout], module, 'deform', undefined, DEFORMATION_PASS),
    buildComputeStage(device, [layout], module, 'deformListed', undefined, DEFORMATION_PASS),
    buildComputeStage(
      device,
      [bankLayout],
      device.createShaderModule({ code: ANIMATION_BANK_WGSL }),
      'poseTracks',
      undefined,
      ANIMATION_BANK_PASS,
    ),
  ])
}

/** The group of the stage's resources `buffers` for dispatch `slot`, made again when a resource it
 *  names moved. */
function bindDeformation(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  image: ReturnType<typeof deformationImage>,
  kept: ReturnType<typeof heldGroup>,
  buffers: readonly DeformationResource[],
  slot: number,
) {
  const { next } = kept.identity
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

/** The clusters the decode listed because their vertices move, deformed: a group each, the
 *  dispatch the decode's plan wrote in the work buffer `buffers` holds (`DEFORMATION_BINDING.list`). */
function encodeListed(
  steps: ComputeRun,
  pipeline: GPUComputePipeline,
  buffers: readonly DeformationResource[],
  group: GPUBindGroup,
) {
  const pass = steps.pass(DEFORM_PASS)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroupsIndirect(
    buffers[DEFORMATION_BINDING.list] as GPUBuffer,
    (DEFORM.at + DEFORM.groups) * 4,
  )
}

/** Builds once; binding identities follow cache relocation and table growth, never a steady frame.
 *  The stage's pipeline and the bank pass's are built together. */
export async function createDeformationCompute(device: GPUDevice) {
  const layout = device.createBindGroupLayout({ entries: deformationBindings() })
  const bankLayout = device.createBindGroupLayout({ entries: animationBankBindings() })
  const [pipeline, listedPipeline, bankPipeline] = await buildDeformationStages(
    device,
    layout,
    bankLayout,
  )
  const banks = animationBankPass(device, bankLayout, bankPipeline)
  const image = deformationImage(device)
  const pooledBuffers: DeformationResource[] = []
  // One group per dispatch slot (0 rows, 1 pooled), made again when a resource it names moved.
  const held = [heldGroup(), heldGroup()]
  const bind = (buffers: readonly DeformationResource[], slot: number) =>
    bindDeformation(device, layout, image, held[slot], buffers, slot)
  /** The animation banks' tracks posed and the float-pool blocks deformed: once an image, before
   *  the cut. */
  const encode = (
    encoder: GPUCommandEncoder,
    buffers: readonly DeformationResource[],
    frame: number,
    pooled?: { table: GPUBuffer; count: number },
    deformation?: Pick<SessionDeformation, 'tracks' | 'base'>,
  ) => {
    // The tracks' palettes first: the clusters of the placements playing them read them later.
    const steps = poolRun.begin(encoder)
    if (deformation?.tracks.count)
      banks.encode(steps, buffers[DEFORMATION_BINDING.positions] as GPUBuffer, deformation)
    if (!pooled?.count) return void steps.end()
    image.writePooled(frame, pooled.count)
    const pass = steps.pass(DEFORM_PASS)
    pass.setPipeline(pipeline)
    // The float-pool blocks' set: the passes' resources, their rows the pooled table.
    pooledBuffers.splice(0, pooledBuffers.length, ...buffers)
    pooledBuffers[DEFORMATION_BINDING.pages] = pooled.table
    pass.setBindGroup(0, bind(pooledBuffers, 1))
    dispatchRows(pass, pooled.count)
    steps.end()
  }
  const encodeClusters = (
    steps: ComputeRun,
    buffers: readonly DeformationResource[],
    frame: number,
  ) => {
    image.writeFrame(frame)
    encodeListed(steps, listedPipeline, buffers, bind(buffers, 0))
  }
  return {
    encode,
    encodeClusters,
    dispose() {
      image.buffer.destroy()
      banks.dispose()
    },
  }
}

export type DeformationCompute = Awaited<ReturnType<typeof createDeformationCompute>>
