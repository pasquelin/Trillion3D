import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/texture/previewFormat.ts'
import type { AtlasBindings } from '../../gpu/bind/bindLayout.ts'

/**
 * THE MAPS OF A LIGHT FUNCTION are read as a surface's emission map is: the colour atlas of the
 * materials (`../../materials/virtual/`), its pools and page table bound as the passes of the
 * surfaces bind them, the texture in a slot of it, its tiles asked from the streamer at the
 * pixels the light function slot shows of it. The atlas binds them at the numbers below, after the
 * pass's own uniform at 0.
 */
export const MAP_BINDINGS: AtlasBindings = {
  lanes: PREVIEW_LAYOUT_NAMES.map((_, lane) => 1 + lane),
  pages: 1 + PREVIEW_LAYOUT_NAMES.length,
}
/** The binding of the sampler the pools are read through. */
export const MAP_SAMPLER_BINDING = MAP_BINDINGS.pages + 1
