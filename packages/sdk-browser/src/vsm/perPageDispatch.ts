/**
 * The per-page dispatch pass for the page management kernels.
 *
 * The binning, the id upload into `res.perPageIds` and the WGSL of the dispatch setup belong to the
 * page marking (`markingPass.ts` / `markingWgsl.ts`) and are
 * reused here: this module only declares the setup's bindings in its own group and replays the
 * `all` bins of that frame (`VsmPerPageBins.all`), one 256-byte uniform slot per bin.
 */
import {
  VSM_PER_PAGE_BIN_COUNT,
  vsmDispatchPerPageBin,
  vsmWritePerPageBinArgs,
  type VsmPerPageBin,
} from './markingPass.ts';
import { VSM_PER_PAGE_DISPATCH_STRIDE, VSM_PER_PAGE_DISPATCH_WGSL } from './markingWgsl.ts';
import { vsmBufferEntry, vsmDynamicUniformEntry } from './passKit.ts';
import type { VsmResources } from './resources.ts';
import { vsmWriteChanged } from './writeChanged.ts';

/**
 * Bindings of the per-page dispatch setup in `group` (0 = `vsmPerPage` dynamic uniform, 1 = `vsmPerPageIds`)
 * and the setup itself (`vsmMapWalkOf`, `vsmPagesAcross`). Needs `vsmProjectionData`.
 */
export function vsmPerPageDispatchWgsl(group: number) {
  return /* wgsl */ `
@group(${group}) @binding(0) var<uniform> vsmPerPage:VsmMapWalkParams;
@group(${group}) @binding(1) var<storage,read> vsmPerPageIds:array<u32>;
${VSM_PER_PAGE_DISPATCH_WGSL}`;
}

/** The layout entries of the dispatch setup's group: its slot (dynamic uniform) and the ids. */
export const vsmPerPageDispatchEntries = (): GPUBindGroupLayoutEntry[] => [
  vsmDynamicUniformEntry(0, 16),
  vsmBufferEntry(1, GPUShaderStage.COMPUTE, 'read-only-storage'),
];

/** Bytes a dispatcher holds on the device: its slots' words. */
export const VSM_PER_PAGE_DISPATCHER_BYTES = VSM_PER_PAGE_DISPATCH_STRIDE * VSM_PER_PAGE_BIN_COUNT;

/** One per `VsmResources`: per-bin uniform slots and the bind group over them and `res.perPageIds`. */
export class VsmPerPageDispatcher {
  readonly bindGroupLayout: GPUBindGroupLayout;
  bindGroup!: GPUBindGroup;
  bins: readonly VsmPerPageBin[] = [];
  private readonly params: GPUBuffer;
  private readonly device: GPUDevice;
  /** The slots' words, written again each frame. */
  private readonly args = new Uint32Array(
    (VSM_PER_PAGE_DISPATCH_STRIDE / 4) * VSM_PER_PAGE_BIN_COUNT,
  );

  /** The dynamic offset of each bin's slot, made once. */
  private readonly offsets = Array.from({ length: VSM_PER_PAGE_BIN_COUNT }, (_, b) => [
    b * VSM_PER_PAGE_DISPATCH_STRIDE,
  ]);

  constructor(device: GPUDevice, res: VsmResources) {
    this.device = device;
    this.params = device.createBuffer({
      label: 'vsm.pm.perPage',
      size: VSM_PER_PAGE_DISPATCHER_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'vsm.pm.perPage',
      entries: vsmPerPageDispatchEntries(),
    });
    this.rebind(res);
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
    });
  }

  /** This frame's `all` bins (ids already in `res.perPageIds`); the slots that changed go up by
   *  queue write, before this frame's submit (`vsmWriteChanged`). */
  setBins(bins: readonly VsmPerPageBin[]) {
    const words = VSM_PER_PAGE_DISPATCH_STRIDE / 4;
    this.args.fill(0);
    for (let b = 0; b < bins.length; b++) vsmWritePerPageBinArgs(this.args, b * words, bins[b], b);
    vsmWriteChanged(this.device, this.params, this.args, 0, this.args.length);
    this.bins = bins;
  }

  /** One dispatch per non-empty bin; pipeline and the other groups already set. */
  encode(pass: GPUComputePassEncoder, group: number) {
    for (let b = 0; b < this.bins.length; b++) {
      const bin = this.bins[b];
      if (bin.count === 0) continue;
      pass.setBindGroup(group, this.bindGroup, this.offsets[b]);
      vsmDispatchPerPageBin(pass, bin, b);
    }
  }

  destroy() {
    this.params.destroy();
  }
}
