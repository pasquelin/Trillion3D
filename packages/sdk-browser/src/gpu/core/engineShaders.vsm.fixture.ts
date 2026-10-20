import {
  CAST_ARGS_WGSL,
  castInvalidationWgsl,
} from '../../lighting/shadows/vsm/invalidation/castInvalidationWgsl.ts'
import {
  vsmMarkingClears,
  vsmResetPageTableWgsl,
  vsmPixelPageMarkingWgsl,
  vsmPageRectInitWgsl,
  vsmCoarseMarkingWgsl,
} from '../../lighting/shadows/vsm/markingWgsl.ts'
import { vsmPageManagementKernels } from '../../lighting/shadows/vsm/pageManagementWgsl.ts'
import { vsmPhysicalPageKernels } from '../../lighting/shadows/vsm/physicalPagesWgsl.ts'
import { vsmProjectionWgsl } from '../../lighting/shadows/vsm/projection/projectionWgsl.ts'
import { vsmRenderCullWgsl } from '../../lighting/shadows/vsm/render/renderCullWgsl.ts'
import { vsmRenderViewsWgsl } from '../../lighting/shadows/vsm/render/renderViewsWgsl.ts'
import { VSM_RENDER_ARGS_WGSL } from '../../lighting/shadows/vsm/render/renderParamsWgsl.ts'
import { vsmRenderCandidatesWgsl } from '../../lighting/shadows/vsm/render/renderCandidatesWgsl.ts'
import { vsmRenderExpandWgsl } from '../../lighting/shadows/vsm/render/renderExpandWgsl.ts'
import { vsmRenderRasterWgsl } from '../../lighting/shadows/vsm/render/renderRasterWgsl.ts'
import { vsmTransmissionBinWgsl } from '../../lighting/shadows/vsm/transmission/transmissionBinWgsl.ts'
import {
  vsmTransmissionCandidatesWgsl,
  vsmTransmissionClearWgsl,
} from '../../lighting/shadows/vsm/transmission/transmissionClearWgsl.ts'
import {
  vsmTransmissionNumberWgsl,
  vsmTransmissionPlaceWgsl,
} from '../../lighting/shadows/vsm/transmission/transmissionNumberWgsl.ts'
import { vsmTransmissionPagesWgsl } from '../../lighting/shadows/vsm/transmission/transmissionPagesWgsl.ts'
import { vsmTransmissionResolveWgsl } from '../../lighting/shadows/vsm/transmission/transmissionResolveWgsl.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { ROW_BINS_WGSL } from '../../lighting/shadows/vsm/rows/rowBinsWgsl.ts'

/** Every virtual shadow map module, for the layout the engine makes for one sun
 *  (`../../lighting/shadows/vsm/frame/vsmEncode.ts`) at WebGPU's default binding size: the projection
 *  (one module, its kinds specialised by `VSM_TRACE_KINDS`), the page management with and without
 *  its counters. The transmission's cull is the opaque cull with its dirty marking left out: fewer
 *  names, no new one. */
export function vsmVariants() {
  const layout = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 })
  const upper = (name: string) => name.replace(/[A-Z]/g, '_$&').toUpperCase()
  const variants: Record<string, string> = {
    VSM_MARKING_RECTS: vsmPageRectInitWgsl(layout),
    VSM_MARKING_COARSE: vsmCoarseMarkingWgsl(layout),
    VSM_MARKING_PIXELS: vsmPixelPageMarkingWgsl(layout),
    VSM_INVALIDATION: castInvalidationWgsl(layout),
    CAST_ARGS_WGSL,
    VSM_RENDER_CANDIDATES: vsmRenderCandidatesWgsl(),
    VSM_RENDER_VIEWS: vsmRenderViewsWgsl(layout),
    VSM_RENDER_CULL: vsmRenderCullWgsl(layout),
    VSM_RENDER_EXPAND: vsmRenderExpandWgsl(layout),
    VSM_RENDER_ARGS_WGSL,
    VSM_RENDER_RASTER: vsmRenderRasterWgsl(layout),
    VSM_TRANSMISSION_CANDIDATES: vsmTransmissionCandidatesWgsl(),
    VSM_TRANSMISSION_CLEAR: vsmTransmissionClearWgsl(layout),
    VSM_TRANSMISSION_PAGES: vsmTransmissionPagesWgsl(layout),
    VSM_TRANSMISSION_NUMBER: vsmTransmissionNumberWgsl(layout),
    VSM_TRANSMISSION_PLACE: vsmTransmissionPlaceWgsl(layout),
    VSM_TRANSMISSION_BIN: vsmTransmissionBinWgsl(layout),
    VSM_TRANSMISSION_RESOLVE: vsmTransmissionResolveWgsl(layout),
    ROW_BINS_WGSL,
  }
  variants.VSM_PROJECTION = vsmProjectionWgsl(layout)
  // The marking's clears (`vsmMarkingClears`): every map's tables, and a receiver mask of the
  // suns'.
  const suns = vsmMarkingClears({ ...layout, coverMode: 'directional' })
  variants.VSM_MARKING_CLEAR = vsmResetPageTableWgsl(suns.all, layout)
  variants.VSM_MARKING_CLEAR_RECEIVER = vsmResetPageTableWgsl(suns.directionalOnly, layout)
  for (const stats of [false, true]) {
    const kernels = {
      ...vsmPhysicalPageKernels(layout, { stats }),
      ...vsmPageManagementKernels(layout),
    }
    for (const [name, kernel] of Object.entries(kernels))
      variants[`VSM_PM_${upper(name)}${stats ? '_STATS' : ''}`] = kernel.code
  }
  return variants
}
