/**
 * The per-page dispatch pass for the page management kernels.
 *
 * The binning, the id upload into `res.perPageIds` and the WGSL of the dispatch setup belong to the
 * page marking (`markingPass.ts` / `markingWgsl.ts`) and are
 * reused here: this module only declares the setup's bindings in its own group and replays the
 * `all` bins of that frame (`VsmPerPageBins.all`), one uniform slot per bin, the device's
 * `uniformStride` apart.
 */
import {
  VSM_PER_PAGE_BIN_COUNT,
  VSM_PER_PAGE_BIN_WORDS,
  vsmDispatchPerPageBin,
  vsmWritePerPageBinArgs,
  type VsmPerPageBin,
} from './markingPass.ts'
import { VSM_PER_PAGE_DISPATCH_WGSL } from './markingWgsl.ts'
import { vsmBufferEntry, vsmDynamicUniformEntry } from './passKit.ts'
import type { VsmResources } from './resources.ts'
import { vsmWriteChangedSlots } from './writeChanged.ts'
import { uniformSlotBytes, uniformSlots, type UniformSlots } from '../residency/pools.ts'

/**
 * Bindings of the per-page dispatch setup in `group` (0 = `vsmPerPage` dynamic uniform, 1 = `vsmPerPageIds`)
 * and the setup itself (`vsmMapWalkOf`, `vsmPagesAcross`). Needs `vsmProjectionData`.
 */
export function vsmPerPageDispatchWgsl(group: number) {
  return /* wgsl */ `
@group(${group}) @binding(0) var<uniform> vsmPerPage:VsmMapWalkParams;
@group(${group}) @binding(1) var<storage,read> vsmPerPageIds:array<u32>;
${VSM_PER_PAGE_DISPATCH_WGSL}`
}

/** The layout entries of the dispatch setup's group: its slot (dynamic uniform) and the ids. */
export const vsmPerPageDispatchEntries = (): GPUBindGroupLayoutEntry[] => [
  vsmDynamicUniformEntry(0, 16),
  vsmBufferEntry(1, GPUShaderStage.COMPUTE, 'read-only-storage'),
]

/** Bytes a dispatcher holds on a device of `limits`: its slots, the device's `uniformStride` apart. */
export const vsmPerPageDispatcherBytes = (limits: Parameters<typeof uniformSlotBytes>[0]) =>
  uniformSlotBytes(limits, VSM_PER_PAGE_BIN_COUNT)

/** One per `VsmResources`: per-bin uniform slots, the device's `uniformStride` apart, and the bind
 *  group over them and `res.perPageIds`. */
export class VsmPerPageDispatcher {
  readonly bindGroupLayout: GPUBindGroupLayout
  bindGroup!: GPUBindGroup
  bins: readonly VsmPerPageBin[] = []
  private readonly params: GPUBuffer
  private readonly device: GPUDevice
  /** The bins' slots: their stride, offsets and words. */
  private readonly slots: UniformSlots
  /** The slots' words, laid as the buffer, written again each frame. */
  private readonly args: Uint32Array<ArrayBuffer>

  constructor(device: GPUDevice, res: VsmResources) {
    this.device = device
    this.slots = uniformSlots(device.limits, VSM_PER_PAGE_BIN_COUNT, VSM_PER_PAGE_BIN_WORDS)
    this.args = new Uint32Array(this.slots.bytes / 4)
    this.params = device.createBuffer({
      label: 'vsm.pm.perPage',
      size: this.slots.bytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'vsm.pm.perPage',
      entries: vsmPerPageDispatchEntries(),
    })
    this.rebind(res)
  }

  /** Binds the ids of `res` again: its tables grew (`growVsmTables`). */
  rebind(res: VsmResources) {
    this.bindGroup = this.device.createBindGroup({
      label: 'vsm.pm.perPage',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.params, offset: 0, size: 16 } },
        { binding: 1, resource: { buffer: res.perPageIds } },
      ],
    })
  }

  /** This frame's `all` bins (ids already in `res.perPageIds`); the slots that changed go up by
   *  queue write, before this frame's submit (`vsmWriteChangedSlots`). */
  setBins(bins: readonly VsmPerPageBin[]) {
    const { args, slots } = this
    for (let b = 0; b < slots.count; b++) {
      const at = b * slots.strideWords
      // A bin this frame does not have holds zeros; the padding is never compared.
      if (b < bins.length) vsmWritePerPageBinArgs(args, at, bins[b], b)
      else args.fill(0, at, at + slots.words)
    }
    vsmWriteChangedSlots(this.device, this.params, args, slots)
    this.bins = bins
  }

  /** One dispatch per non-empty bin; pipeline and the other groups already set. */
  encode(pass: GPUComputePassEncoder, group: number) {
    for (let b = 0; b < this.bins.length; b++) {
      const bin = this.bins[b]
      if (bin.count === 0) continue
      pass.setBindGroup(group, this.bindGroup, this.slots.offset(b))
      vsmDispatchPerPageBin(pass, bin, b)
    }
  }

  destroy() {
    this.params.destroy()
  }
}
