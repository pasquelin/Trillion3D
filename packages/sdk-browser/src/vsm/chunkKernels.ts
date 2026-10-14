/**
 * THE KERNELS OF A CHUNKED RASTER OVER CASTER ROWS (`renderCullWgsl.ts`): the cull, the expand and
 * their arguments — the opaque raster's, and the transmission's with its own cull —, what a pass
 * holds of its chunks, and the chunk a frame's rows take.
 */
import { computeBufferEntry } from '../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import type { UniformSlots } from '../residency/pools.ts'
import type { VsmLayout } from './layout.ts'
import { vsmComputePipe, type VsmComputePipe } from './passKit.ts'
import { vsmBindGroupLayoutEntries, vsmFrameSetHeld } from './resources.ts'
import {
  VSM_RENDER_ARGS_WGSL,
  VSM_RENDER_CULL_SPECS,
  VSM_RENDER_EXPAND_SPECS,
  vsmRenderExpandWgsl,
} from './renderCullWgsl.ts'
import {
  createVsmRowBound,
  vsmBoundChunk,
  vsmWorstChunk,
  type VsmBoundLight,
  type VsmChunk,
  type VsmRowBound,
  type VsmRowSpheres,
  type VsmWorst,
} from './rowPageBound.ts'
import { vsmChunkParamSlots, vsmRenderParamsEntry } from './chunkParams.ts'

/** The cull, expand and argument kernels of a raster over caster rows (`renderCullWgsl.ts`):
 *  the opaque raster's, and the transmission atlas's with its own cull. */
export interface VsmChunkKernels {
  cull: VsmComputePipe
  expand: VsmComputePipe
  /** One source, one group layout: each pipe's `groups[0]` is the same entries. */
  args: { cull: VsmComputePipe; expand: VsmComputePipe; draw: VsmComputePipe }
}

/** The cull (`cullCode`), expand and argument kernels, labelled under `label`: pipes made once a
 *  device and source (`vsmComputePipe`), so a pass whose kernel is another's shares its pipe — the
 *  raster's and the transmission's expand and arguments are one — and their groups' layouts. Each
 *  pipeline is read from its pipe where it is bound. */
export function vsmChunkKernels(
  device: GPUDevice,
  layout: VsmLayout,
  label: string,
  cullCode: string,
): VsmChunkKernels {
  const C = GPUShaderStage.COMPUTE
  const P = vsmRenderParamsEntry
  const pipe = (
    name: string,
    code: string,
    entryPoint: string,
    groups: GPUBindGroupLayoutEntry[][],
  ) => vsmComputePipe(device, `${label}.${name}`, code, entryPoint, groups)
  const cull = pipe('cull', cullCode, 'vsmRenderCull', [
    vsmBindGroupLayoutEntries(VSM_RENDER_CULL_SPECS, layout, C),
    [
      P(0),
      computeBufferEntry(1, 'read-only-storage', C),
      computeBufferEntry(2, 'read-only-storage', C),
      computeBufferEntry(3, 'storage', C),
      computeBufferEntry(4, 'storage', C),
    ],
  ])
  const expand = pipe('expand', vsmRenderExpandWgsl(layout), 'vsmRenderExpand', [
    vsmBindGroupLayoutEntries(VSM_RENDER_EXPAND_SPECS, layout, C),
    [
      P(0),
      computeBufferEntry(1, 'read-only-storage', C),
      computeBufferEntry(2, 'storage', C),
      computeBufferEntry(3, 'storage', C),
    ],
  ])
  const argsEntries = [
    P(0),
    computeBufferEntry(1, 'storage', C),
    computeBufferEntry(2, 'storage', C),
  ]
  const args = (entryPoint: string) => pipe('args', VSM_RENDER_ARGS_WGSL, entryPoint, [argsEntries])
  return {
    cull,
    expand,
    args: {
      cull: args('vsmRenderArgsCull'),
      expand: args('vsmRenderArgsExpand'),
      draw: args('vsmRenderArgsDraw'),
    },
  }
}

/** What a pass named `label` holds of its chunk lists on a device of `limits`: the chunks'
 *  parameter slots at the device's dynamic-offset alignment, their passes, the bind identity, the
 *  tables, and the row bound `existing` kept. */
export function vsmChunkContext<Tables>(
  label: string,
  limits: GPUSupportedLimits,
  existing?: { rowBound: VsmRowBound },
) {
  const slots = vsmChunkParamSlots(limits)
  return {
    slots,
    passes: vsmChunkPasses(label, slots),
    bound: createWebgpuBindIdentity(),
    tables: vsmFrameSetHeld<Tables>(),
    rowBound: existing?.rowBound ?? createVsmRowBound(),
  }
}

/** The pass labels of a chunked raster under `prefix`, and chunk `c`'s parameter offset in `slots`:
 *  made once for every frame (the raster's and the transmission's). */
export function vsmChunkPasses(prefix: string, slots: UniformSlots) {
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

/**
 * The chunk of the rows `[first, end)`: by where they are (`vsmBoundChunk`), or, when the bound
 * cannot speak, the worst case.
 */
export function vsmChunkRows(
  bound: VsmRowBound,
  spheres: VsmRowSpheres,
  range: { first: number; end: number; candidates: number },
  lights: readonly VsmBoundLight[],
  worst: VsmWorst,
): VsmChunk {
  return (
    vsmBoundChunk(bound, spheres, range, lights, worst) ||
    vsmWorstChunk(worst.rows, worst.cmdsPerRow, worst.pages)
  )
}
