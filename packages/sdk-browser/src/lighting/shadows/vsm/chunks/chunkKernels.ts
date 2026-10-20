/**
 * THE KERNELS OF A CHUNKED RASTER OVER CASTER ROWS (`../render/renderCullWgsl.ts`): the views, the cull and
 * the arguments — the opaque raster's, and the transmission's with its own cull —, what a pass
 * holds of its chunks.
 */
import { COMPUTE, computeBufferEntry } from '../../../../gpu/core/computeBindings.ts'
import {
  createWebgpuBindIdentity,
  type WebgpuBindIdentity,
} from '../../../../gpu/bind/bindIdentity.ts'
import type { UniformSlots } from '../../../../session/memory/pools.ts'
import type { VsmLayout } from '../layout.ts'
import { vsmComputePipe, type VsmComputePipe } from '../passKit.ts'
import { vsmBindGroupLayoutEntries, vsmFrameSetHeld, type VsmPerFrameSet } from '../resources.ts'
import type { VsmListName } from './chunkSizing.ts'
import { VSM_RENDER_CULL_SPECS } from '../render/renderCullWgsl.ts'
import { VSM_RENDER_ARGS_WGSL } from '../render/renderParamsWgsl.ts'
import { VSM_RENDER_VIEWS_SPECS, vsmRenderViewsWgsl } from '../render/renderViewsWgsl.ts'
import { createVsmRowBound, type VsmRowBound } from '../rows/rowPageBound.ts'
import { vsmChunkParamSlots, vsmRenderParamsEntry } from './chunkParams.ts'

/** The views, cull and argument kernels of a raster over caster rows (`../render/renderCullWgsl.ts`): the
 *  opaque raster's, and the transmission atlas's with its own cull. */
export interface VsmChunkKernels {
  /** The views with pages to draw, listed on the GPU (`../render/renderViewsWgsl.ts`). */
  views: VsmComputePipe
  cull: VsmComputePipe
  /** One source, one group layout: each pipe's `groups[0]` is the same entries. */
  args: { cull: VsmComputePipe; expand: VsmComputePipe; draw: VsmComputePipe }
}

/** The views, cull (`cullCode`) and argument kernels, labelled under `label`: pipes made once a
 *  device and source (`vsmComputePipe`), so a pass whose kernel is another's shares its pipe — the
 *  raster's and the transmission's views and arguments are one — and their groups' layouts. Each
 *  pipeline is read from its pipe where it is bound. */
export function vsmChunkKernels(
  device: GPUDevice,
  layout: VsmLayout,
  label: string,
  cullCode: string,
): VsmChunkKernels {
  const P = vsmRenderParamsEntry
  const pipe = (
    name: string,
    code: string,
    entryPoint: string,
    groups: GPUBindGroupLayoutEntry[][],
  ) => vsmComputePipe(device, `${label}.${name}`, code, entryPoint, groups)
  const views = pipe('views', vsmRenderViewsWgsl(layout), 'vsmRenderViews', [
    vsmBindGroupLayoutEntries(VSM_RENDER_VIEWS_SPECS, layout, COMPUTE),
    [P(0), computeBufferEntry(1, 'storage', COMPUTE), computeBufferEntry(2, 'storage', COMPUTE)],
  ])
  const cull = pipe('cull', cullCode, 'vsmRenderCull', [
    vsmBindGroupLayoutEntries(VSM_RENDER_CULL_SPECS, layout, COMPUTE),
    [
      P(0),
      computeBufferEntry(1, 'read-only-storage', COMPUTE),
      computeBufferEntry(2, 'read-only-storage', COMPUTE),
      computeBufferEntry(3, 'storage', COMPUTE),
      computeBufferEntry(4, 'storage', COMPUTE),
    ],
  ])
  const argsEntries = [
    P(0),
    computeBufferEntry(1, 'storage', COMPUTE),
    computeBufferEntry(2, 'storage', COMPUTE),
  ]
  const args = (entryPoint: string) => pipe('args', VSM_RENDER_ARGS_WGSL, entryPoint, [argsEntries])
  return {
    views,
    cull,
    args: {
      cull: args('vsmRenderArgsCull'),
      expand: args('vsmRenderArgsExpand'),
      draw: args('vsmRenderArgsDraw'),
    },
  }
}

/** What a chunked raster holds of its chunks (`vsmChunkContext`): the raster's and the
 *  transmission's draw contexts alike. */
export interface VsmChunkContext<Tables> {
  /** Its lists, by name (`vsmEnsureLists`). */
  buffers: Partial<Record<VsmListName, GPUBuffer>>
  /** The chunks' parameter slots (`vsmChunkParamSlots`). */
  slots: UniformSlots
  /** The chunks' pass labels and parameter offsets, made once a context (`vsmChunkPasses`). */
  passes: ReturnType<typeof vsmChunkPasses>
  /** The scene's rows and the lists the chunk groups bound when made. */
  bound: WebgpuBindIdentity
  /** The groups over the tables of a frame set (`res.current`, the two in turn) and the lists'
   *  groups, made again when one of them moved. */
  tables: VsmPerFrameSet<Tables>
  /** Where the rows are, binned for the chunks' bound. */
  rowBound: VsmRowBound
}

/** What a pass named `label` holds of its chunks on `device`: the lists `existing` held on the
 *  same device, the chunks' parameter slots at the device's dynamic-offset alignment, their
 *  passes, the bind identity, the tables, and the row bound `existing` kept. */
export function vsmChunkContext<Tables>(
  label: string,
  device: GPUDevice,
  existing?: {
    device: GPUDevice
    buffers: VsmChunkContext<Tables>['buffers']
    rowBound: VsmRowBound
  },
): VsmChunkContext<Tables> {
  const slots = vsmChunkParamSlots(device.limits)
  return {
    buffers: existing?.device === device ? existing.buffers : {},
    slots,
    passes: vsmChunkPasses(label, slots),
    bound: createWebgpuBindIdentity(),
    tables: vsmFrameSetHeld<Tables>(),
    rowBound: existing?.rowBound ?? createVsmRowBound(),
  }
}

/** The pass labels of a chunked raster under `prefix`, and chunk `c`'s parameter offset in `slots`:
 *  made once for every frame (the raster's and the transmission's). */
function vsmChunkPasses(prefix: string, slots: UniformSlots) {
  const held: { cullPass: GPUComputePassDescriptor; raster: string; offset: number[] }[] = []
  return {
    chunk: (c: number) =>
      (held[c] ??= {
        cullPass: { label: `${prefix}.cull ${c}` },
        raster: `${prefix}.raster ${c}`,
        offset: slots.offset(c),
      }),
  }
}
