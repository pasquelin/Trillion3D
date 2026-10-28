import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { hasSubgroups } from '../../../gpu/core/subgroups.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { DAG_BINDING, dagBindEntries } from '../../../geometry/dag/shader/bindings.ts'
import { dagArmPipe } from '../../../geometry/dag/shader/armWgsl.ts'
import { rasterLayoutEntries } from '../../../visibility/raster/raster.ts'
import { MODE_DEPTH, MODE_ID, rasterEntry } from '../../../visibility/raster/contract.ts'
import { vsmComputePipe, type VsmComputePipe } from '../../shadows/vsm/passKit.ts'
import { CAPTURE_FORMATS } from '../layout.ts'
import { CARD_DESCENT_ENTRY, cardDescentWgsl } from './cardDescentWgsl.ts'
import {
  CARD_CLEAR_IDS_ENTRY,
  CARD_CLEAR_SURFACES_ENTRY,
  CARD_EXPORT_ENTRY,
  CARD_EXPORT_VIEWS_ENTRY,
  CARD_ROWS_ENTRY,
  cardClearSurfacesSource,
  cardExportSource,
  cardRasterSource,
  cardRowsSource,
} from './cardRasterWgsl.ts'

/**
 * THE PIPELINES OF THE CARDS' CAPTURE, compiled off the frame (`prepared`) the first time a session
 * asks for them: the descent and the cull of the views (`cardDescentWgsl.ts`), the rows' views, the
 * raster of the clusters, the clear before it and the export (`cardRasterWgsl.ts`). The raster holds no graph of the session:
 * the capture draws no alpha mask and no world position offset.
 */

/** The descent's group 1: the parameters, the table of views, the counters. */
const descentGroup = () => [
  computeBufferEntry(0, 'uniform', COMPUTE),
  computeBufferEntry(1, 'storage', COMPUTE),
  computeBufferEntry(2, 'storage', COMPUTE),
]

/** The cut's group 0 as the descent and the cull read it: every table but the clusters' edges. */
const cutGroup = () => dagBindEntries().filter((entry) => entry.binding !== DAG_BINDING.edges)

const LABEL = 'Trillion3D card capture'

/** The descent's pipes, one a device. */
export const cardDescentPipes = oncePerDevice((device: GPUDevice) => {
  const code = cardDescentWgsl()
  const groups = [cutGroup(), descentGroup()]
  const pipe = (entry: string, of = groups, constants?: Record<string, number>) =>
    vsmComputePipe(device, `${LABEL} ${entry}`, code, entry, of, constants)
  const arm = dagArmPipe()
  const width = groupWidthConstants(groupWidth(device.limits))
  return {
    prepare: pipe(CARD_DESCENT_ENTRY.prepare),
    levels: CARD_DESCENT_ENTRY.levels.map((entry) => pipe(entry)),
    close: pipe(CARD_DESCENT_ENTRY.close),
    emit: pipe(CARD_DESCENT_ENTRY.emit),
    done: pipe(CARD_DESCENT_ENTRY.done, groups, width),
    arm: pipe(CARD_DESCENT_ENTRY.arm, arm.groups, arm.constants),
  }
})

/** One entry of the export: the buffer, the table of views, the two textures written, the atlas's side. */
const exportPipe = (device: GPUDevice, which: string, entry: string) =>
  vsmComputePipe(device, `${LABEL} export ${which}`, cardExportSource(), entry, [
    [
      computeBufferEntry(0, 'read-only-storage', COMPUTE),
      computeBufferEntry(1, 'read-only-storage', COMPUTE),
      computeStorageTextureEntry(2, CAPTURE_FORMATS.ids),
      computeStorageTextureEntry(3, CAPTURE_FORMATS.depth),
      computeBufferEntry(4, 'uniform', COMPUTE),
    ],
  ])

/** The clear of the albedo, the normal and the emission over the views' rectangles: the table of views, the three textures written. */
const clearSurfacesPipe = (device: GPUDevice) =>
  vsmComputePipe(
    device,
    `${LABEL} clear surfaces`,
    cardClearSurfacesSource(),
    CARD_CLEAR_SURFACES_ENTRY,
    [
      [
        computeBufferEntry(1, 'read-only-storage', COMPUTE),
        computeStorageTextureEntry(2, CAPTURE_FORMATS.albedo),
        computeStorageTextureEntry(3, CAPTURE_FORMATS.normal),
        computeStorageTextureEntry(4, CAPTURE_FORMATS.emissive),
      ],
    ],
  )

/** The clear of the identifiers and the depth over the views' rectangles: the table of views, the two textures written. */
const clearIdsPipe = (device: GPUDevice) =>
  vsmComputePipe(device, `${LABEL} clear ids`, cardExportSource(), CARD_CLEAR_IDS_ENTRY, [
    [
      computeBufferEntry(1, 'read-only-storage', COMPUTE),
      computeStorageTextureEntry(2, CAPTURE_FORMATS.ids),
      computeStorageTextureEntry(3, CAPTURE_FORMATS.depth),
    ],
  ])

/** The kernels that follow the decode and the raster, and the clear that precedes them, one a device. */
export const cardEndPipes = oncePerDevice((device: GPUDevice) => ({
  rows: vsmComputePipe(device, `${LABEL} rows`, cardRowsSource(), CARD_ROWS_ENTRY, [
    [
      computeBufferEntry(0, 'read-only-storage', COMPUTE),
      computeBufferEntry(1, 'storage', COMPUTE),
    ],
  ]),
  exportIds: exportPipe(device, 'ids', CARD_EXPORT_ENTRY),
  exportViews: exportPipe(device, 'views', CARD_EXPORT_VIEWS_ENTRY),
  clearIds: clearIdsPipe(device),
  clearSurfaces: clearSurfacesPipe(device),
}))

/** The raster's pipes, one a device: the depth phase and the identifier phase. */
export const cardRasterPipes = oncePerDevice((device: GPUDevice) => {
  const code = cardRasterSource(hasSubgroups(device))
  const phase = (mode: number) =>
    vsmComputePipe(device, `${LABEL} raster ${mode}`, code, rasterEntry(mode), [
      rasterLayoutEntries(),
    ])
  return { depth: phase(MODE_DEPTH), ids: phase(MODE_ID) }
})

/** Every pipe of the capture asked now, off the frame; `failed` hears the first compile a device refuses. */
export function askCardPipes(device: GPUDevice, failed: (error: unknown) => void) {
  const descent = cardDescentPipes(device),
    end = cardEndPipes(device),
    raster = cardRasterPipes(device)
  const pipes: VsmComputePipe[] = [
    descent.prepare,
    ...descent.levels,
    descent.close,
    descent.emit,
    descent.done,
    descent.arm,
    end.rows,
    end.exportIds,
    end.exportViews,
    end.clearIds,
    end.clearSurfaces,
    raster.depth,
    raster.ids,
  ]
  for (const pipe of pipes) pipe.prepared.ask().prepare().catch(failed)
  return pipes
}
