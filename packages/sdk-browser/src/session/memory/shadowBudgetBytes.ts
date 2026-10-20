import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { atlasBytes, probeAtlasExtent } from '../../lighting/bounce/atlas.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { vsmResourceBytes } from '../../lighting/shadows/vsm/layoutBytes.ts'
import {
  VSM_RENDER_PAIR_CAPACITY,
  VSM_RENDER_CMD_BYTES,
  VSM_RENDER_ORDER_BYTES,
  VSM_RENDER_PAIR_BYTES,
} from '../../lighting/shadows/vsm/constants.ts'
import { vsmTransmissionBytes } from '../../lighting/shadows/vsm/transmission/transmissionLayout.ts'
import { MIB } from '../../../../math/src/constants.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'

/**
 * The virtual shadow maps of one sun, on any device (the pool binds in windows every device holds), at
 * the default pool — `vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 })`, one
 * page-table row (`fullMapsFor`) and 2048 physical pages in two slices —: every buffer of the set
 * (`vsmResourceBytes`, `../../lighting/shadows/vsm/layoutBytes.ts`), the raster's pair and command lists at their ceiling
 * (`VSM_RENDER_PAIR_CAPACITY`, one command a pair at most, and its place in the tiers' order,
 * `../../lighting/shadows/vsm/constants.ts`) and the
 * coloured transmission's first atlas (`vsmTransmissionBytes`, `../../lighting/shadows/vsm/transmission/transmissionLayout.ts`).
 * The projection's mask, sized by the canvas, is a frame target. Only the shadows' size modules,
 * never a pass: the core holds this budget, and no shadow pass (`scripts/build/core-sources.ts`).
 */
function oneSunShadowMaps() {
  const layout = vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 })
  const lists =
    VSM_RENDER_PAIR_CAPACITY *
    (VSM_RENDER_PAIR_BYTES + VSM_RENDER_CMD_BYTES + VSM_RENDER_ORDER_BYTES)
  return { layout, bytes: vsmResourceBytes(layout) + lists + vsmTransmissionBytes(layout) }
}

/**
 * THE SHADOWS' GPU SHARE: the virtual shadow maps of one sun at the default pool
 * (`oneSunShadowMaps`), rounded up to whole MiB. Derived from the maps' own sizes, so it
 * cannot drift from them; `session/world/budget.test.ts` holds it, within a MiB, to the same maps
 * summed again from their parts (`budget.fixture.ts`).
 */
export const SHADOW_POOL_BYTES = alignUp(oneSunShadowMaps().bytes, MIB)

/**
 * GPU bytes of the bounce probe cascades at their largest — every level of `cascadeSize³` probes,
 * the nine RGB coefficients, visibility and state of each, in both copies the pass binds (the
 * probes and the snapshot frozen before each update). Fixed whatever the scene.
 */
export const BOUNCE_PROBE_BYTES =
  2 * atlasBytes(probeAtlasExtent(BOUNCE_SETTINGS.cascadeSize, BOUNCE_SETTINGS.cascadeLevels))
