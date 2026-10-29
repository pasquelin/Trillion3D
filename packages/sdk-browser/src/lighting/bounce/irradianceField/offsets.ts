import type { IrradianceFieldSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import { namedEntries, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import type { AfterUpdate } from '../cache/radianceCache.ts'
import type { MarkSurface } from '../pool/pool.ts'
import { POOL_ARGS } from '../pool/poolLayout.ts'
import {
  FIELD_OFFSETS_PROGRAM,
  FIELD_OFFSET_BINDINGS,
  GBUFFER_OFFSETS_PROGRAM,
  GBUFFER_OFFSET_BINDINGS,
  fieldOffsetEntries,
  gbufferOffsetEntries,
} from './offsetsWgsl.ts'

/** The ways the probes are moved (`radianceCacheIrradianceProbeOffsetMode`) other than none. */
type OffsetMode = Exclude<IrradianceFieldSettings['probeOffsetMode'], 'none'>

/** The image's surfaces the pixels move the probes by: its depth, view and normals. */
interface OffsetSurface {
  depth: GPUTextureView
  view: GPUBuffer
  normals: GPUTextureView
}

/** The kernel of `mode`, made off the frame: its layout and pipeline. */
async function buildKernel(device: GPUDevice, mode: OffsetMode) {
  const byPixels = mode === 'gbuffer'
  const label = byPixels
    ? 'irradiance field offsets by pixels'
    : 'irradiance field offsets by field'
  const entry = byPixels ? 'gbufferOffsets' : 'fieldOffsets'
  const layout = device.createBindGroupLayout({
    label: `Trillion3D ${label}`,
    entries: byPixels ? gbufferOffsetEntries() : fieldOffsetEntries(),
  })
  const module = await createCheckedShaderModule(
    device,
    byPixels ? GBUFFER_OFFSETS_PROGRAM : FIELD_OFFSETS_PROGRAM,
    label,
  )
  const stages = await buildComputeStages(device, [layout], module, [entry])
  return { layout, pipeline: stages[entry] }
}

/**
 * THE MOVE OF THE FIELD'S PROBES OFF THE SURFACES (`ComputeProbeWorldOffsets`, `radianceCacheIrradianceProbeOffsetMode`), in the field's cache, before the probes the frame queued are traced: by the pixels
 * near them (`gbuffer`) or by the global distance field (`globalDistanceField`). `follow` takes the image's surfaces before the update; `before` is the pass, to hand to the cache. Nothing runs while the
 * kernel compiles (or failed to: `failed` hears it and the probes keep no offset) or the image has not given its surfaces: the probes stand where they did.
 */
export function createProbeOffsets(
  device: GPUDevice,
  mode: OffsetMode,
  failed: (error: unknown) => void,
) {
  let kernel: Awaited<ReturnType<typeof buildKernel>> | undefined
  let disposed = false
  buildKernel(device, mode).then(
    (built) => {
      if (!disposed) kernel = built
    },
    (error: unknown) => {
      if (!disposed) failed(error)
    },
  )
  let surface: OffsetSurface | undefined
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  const before: AfterUpdate = (pass, { wiring, reads, args }) => {
    if (!kernel || (mode === 'gbuffer' && !surface)) return
    const { next } = identity
    next[0] = kernel
    next[1] = wiring.queue
    next[2] = wiring.offsets
    next[3] = surface?.depth
    next[4] = surface?.view
    next[5] = surface?.normals
    next[6] = mode === 'gbuffer' ? undefined : reads.field.readGeneration
    next[7] = wiring.grid
    next[8] = wiring.table
    if (identity.moved() || !group) {
      const common = {
        grid: wholeBuffer(wiring.grid),
        table: wiring.table,
        queue: wholeBuffer(wiring.queue),
        slots: wholeBuffer(wiring.offsets),
      }
      group = device.createBindGroup({
        layout: kernel.layout,
        entries:
          mode === 'gbuffer'
            ? namedEntries(GBUFFER_OFFSET_BINDINGS, {
                ...common,
                view: { buffer: surface!.view },
                depth: surface!.depth,
                normals: surface!.normals,
              })
            : [
                ...namedEntries(FIELD_OFFSET_BINDINGS, common),
                ...reads.field.readEntries(FIELD_OFFSET_BINDINGS.field),
              ],
      })
    }
    pass.setPipeline(kernel.pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroupsIndirect(args, POOL_ARGS.probes * 4)
  }
  return {
    before,
    /** The image's surfaces, from the pool's mark surface and the normals; none while the image lacks any. */
    follow(from: MarkSurface | undefined, normals: GPUTextureView | undefined) {
      surface =
        from?.depth && from.view && normals
          ? { depth: from.depth, view: from.view, normals }
          : undefined
    },
    dispose() {
      disposed = true
    },
  }
}

/** The move of the probes, made. */
export type ProbeOffsets = ReturnType<typeof createProbeOffsets>
