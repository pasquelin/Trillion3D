import { vsmInvalidationWgsl } from '../../vsm/invalidationWgsl.ts';
import {
  vsmMarkingClears,
  vsmResetPageTableWgsl,
  vsmPixelPageMarkingWgsl,
  vsmPageRectInitWgsl,
  vsmCoarseMarkingWgsl,
} from '../../vsm/markingWgsl.ts';
import { vsmPageManagementKernels } from '../../vsm/pageManagementWgsl.ts';
import { vsmPhysicalPageKernels } from '../../vsm/physicalPagesWgsl.ts';
import { VSM_MASK_TABLE_WGSL, vsmProjectionWgsl } from '../../vsm/projectionWgsl.ts';
import {
  VSM_RENDER_ARGS_WGSL,
  vsmRenderCandidatesWgsl,
  vsmRenderCullWgsl,
  vsmRenderExpandWgsl,
} from '../../vsm/renderCullWgsl.ts';
import { vsmRenderRasterWgsl } from '../../vsm/renderRasterWgsl.ts';
import {
  vsmTransmissionBinWgsl,
  vsmTransmissionCandidatesWgsl,
  vsmTransmissionClearWgsl,
  vsmTransmissionNumberWgsl,
  vsmTransmissionPagesWgsl,
  vsmTransmissionPlaceWgsl,
  vsmTransmissionResolveWgsl,
} from '../../vsm/transmissionWgsl.ts';
import { vsmLayout } from '../../vsm/layout.ts';

/** Every virtual shadow map module, for the layout the engine makes for one sun (`../../webgpu/pages/render/vsm/vsmEncode.ts`)
 *  at WebGPU's default binding size: the projection with and without subgroups and the receiver
 *  target, the page management with and without its counters. The transmission's cull is the
 *  opaque cull with its dirty marking left out: fewer names, no new one. */
export function vsmVariants() {
  const layout = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27);
  const upper = (name: string) => name.replace(/[A-Z]/g, '_$&').toUpperCase();
  const variants: Record<string, string> = {
    VSM_MARKING_RECTS: vsmPageRectInitWgsl(layout),
    VSM_MARKING_COARSE: vsmCoarseMarkingWgsl(layout),
    VSM_MARKING_PIXELS: vsmPixelPageMarkingWgsl(layout),
    VSM_INVALIDATION: vsmInvalidationWgsl(layout),
    VSM_RENDER_CANDIDATES: vsmRenderCandidatesWgsl(),
    VSM_RENDER_CULL: vsmRenderCullWgsl(layout),
    VSM_RENDER_EXPAND: vsmRenderExpandWgsl(layout),
    VSM_RENDER_ARGS_WGSL,
    VSM_MASK_TABLE_WGSL,
    VSM_RENDER_RASTER: vsmRenderRasterWgsl(layout),
    VSM_TRANSMISSION_CANDIDATES: vsmTransmissionCandidatesWgsl(),
    VSM_TRANSMISSION_CLEAR: vsmTransmissionClearWgsl(layout),
    VSM_TRANSMISSION_PAGES: vsmTransmissionPagesWgsl(layout),
    VSM_TRANSMISSION_NUMBER: vsmTransmissionNumberWgsl(layout),
    VSM_TRANSMISSION_PLACE: vsmTransmissionPlaceWgsl(layout),
    VSM_TRANSMISSION_BIN: vsmTransmissionBinWgsl(layout),
    VSM_TRANSMISSION_RESOLVE: vsmTransmissionResolveWgsl(layout),
  };
  for (const subgroups of [false, true])
    for (const receiver of [false, true]) {
      variants[`VSM_PROJECTION${subgroups ? '_SUBGROUPS' : ''}${receiver ? '_RECEIVER' : ''}`] =
        vsmProjectionWgsl(layout, { subgroups, receiver });
    }
  // The marking's clears as each receiver mask makes them (`vsmMarkingClears`): every map's
  // tables, with a receiver mask of every map or without, and a receiver mask of the suns' alone.
  const local = vsmMarkingClears({ ...layout, coverMode: 'local' }),
    suns = vsmMarkingClears({ ...layout, coverMode: 'directional' });
  variants.VSM_MARKING_CLEAR = vsmResetPageTableWgsl(suns.all, layout);
  variants.VSM_MARKING_CLEAR_LOCAL_RECEIVER = vsmResetPageTableWgsl(local.all, layout);
  variants.VSM_MARKING_CLEAR_RECEIVER = vsmResetPageTableWgsl(suns.directionalOnly, layout);
  for (const stats of [false, true]) {
    const kernels = {
      ...vsmPhysicalPageKernels(layout, { stats }),
      ...vsmPageManagementKernels(layout),
    };
    for (const [name, kernel] of Object.entries(kernels))
      variants[`VSM_PM_${upper(name)}${stats ? '_STATS' : ''}`] = kernel.code;
  }
  return variants;
}
