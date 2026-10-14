/**
 * THE TRANSMISSION'S PIPES (`transmissionContext.ts`): its kernels over a layout and the group
 * layouts they bind — the clear, the candidates, the pages, the bin, the number, the place and the
 * resolve, its two entry points one module.
 */
import { computeBufferEntry } from '../gpu/core/computeBindings.ts'
import { shadowPageEntries } from '../webgpu/shadow/pageGroup.ts'
import type { VsmLayout } from './layout.ts'
import { vsmComputePipe } from './passKit.ts'
import { vsmBindGroupLayoutEntries } from './resources.ts'
import { vsmRenderParamsEntry } from './chunkParams.ts'
import {
  VSM_TRANSMISSION_CLEAR_SPECS,
  VSM_TRANSMISSION_PAGES_SPECS,
  vsmTransmissionBinWgsl,
  vsmTransmissionCandidatesWgsl,
  vsmTransmissionClearWgsl,
  vsmTransmissionNumberWgsl,
  vsmTransmissionPagesWgsl,
  vsmTransmissionPlaceWgsl,
  vsmTransmissionResolveWgsl,
} from './transmissionWgsl.ts'
import { VSM_TRANSMISSION_FORMAT } from './transmissionLayout.ts'
import { TRANSMISSION_LABEL } from './transmissionMade.ts'

/** The group layout entries the transmission's kernels bind over `layout`, one table a kernel —
 *  the resolve's shared by its two entry points. */
function transmissionGroupTables(layout: VsmLayout) {
  const C = GPUShaderStage.COMPUTE
  const buf = (binding: number, type: GPUBufferBindingType) => computeBufferEntry(binding, type, C)
  const resolve = [
    [
      buf(0, 'uniform'),
      ...[1, 2, 3, 4].map((b) => buf(b, 'storage')),
      {
        binding: 5,
        visibility: C,
        storageTexture: { access: 'write-only', format: VSM_TRANSMISSION_FORMAT },
      } as GPUBindGroupLayoutEntry,
    ],
  ]
  return {
    clear: [
      vsmBindGroupLayoutEntries(VSM_TRANSMISSION_CLEAR_SPECS, layout, C),
      [
        buf(0, 'uniform'),
        buf(1, 'storage'),
        buf(2, 'storage'),
        buf(3, 'storage'),
        buf(4, 'storage'),
      ],
    ],
    candidates: [
      [
        vsmRenderParamsEntry(0),
        ...[1, 2, 3, 4].map((b) => buf(b, 'read-only-storage')),
        buf(5, 'storage'),
        buf(6, 'storage'),
        buf(7, 'uniform'),
      ],
    ],
    pages: [
      vsmBindGroupLayoutEntries(VSM_TRANSMISSION_PAGES_SPECS, layout, C),
      [
        vsmRenderParamsEntry(0),
        buf(1, 'read-only-storage'),
        buf(2, 'storage'),
        buf(3, 'storage'),
        buf(4, 'read-only-storage'),
        buf(5, 'uniform'),
      ],
    ],
    bin: [
      shadowPageEntries(),
      [
        buf(0, 'read-only-storage'),
        buf(1, 'read-only-storage'),
        buf(2, 'uniform'),
        buf(3, 'storage'),
      ],
    ],
    number: [[buf(0, 'uniform'), buf(1, 'storage'), buf(2, 'storage')]],
    place: [[buf(0, 'uniform'), buf(1, 'storage')]],
    resolve,
  } satisfies Record<string, GPUBindGroupLayoutEntry[][]>
}

/** The transmission's compute pipes of `layout` (`vsmComputePipe`: prepared, shared a device and
 *  text — the resolve's two entry points one module), with the group layouts their kernels bind. */
export function vsmTransmissionPipes(device: GPUDevice, layout: VsmLayout) {
  const groups = transmissionGroupTables(layout)
  const pipe = (name: string, code: string, entry: string, tables: GPUBindGroupLayoutEntry[][]) =>
    vsmComputePipe(device, `${TRANSMISSION_LABEL}.${name}`, code, entry, tables)
  const resolveCode = vsmTransmissionResolveWgsl(layout)
  return {
    clear: pipe('clear', vsmTransmissionClearWgsl(layout), 'vsmTransmissionClear', groups.clear),
    candidates: pipe(
      'candidates',
      vsmTransmissionCandidatesWgsl(),
      'vsmTransmissionCandidates',
      groups.candidates,
    ),
    pages: pipe('pages', vsmTransmissionPagesWgsl(layout), 'vsmTransmissionPages', groups.pages),
    bin: pipe('bin', vsmTransmissionBinWgsl(layout), 'vsmTransmissionBin', groups.bin),
    number: pipe(
      'number',
      vsmTransmissionNumberWgsl(layout),
      'vsmTransmissionNumber',
      groups.number,
    ),
    place: pipe('place', vsmTransmissionPlaceWgsl(layout), 'vsmTransmissionPlace', groups.place),
    resolve: pipe('resolve', resolveCode, 'vsmTransmissionResolve', groups.resolve),
    headers: pipe('resolve', resolveCode, 'vsmTransmissionHeaders', groups.resolve),
  }
}
