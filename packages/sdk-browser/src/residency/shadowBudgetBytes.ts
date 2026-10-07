import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts'
import { bounceProbeBytes } from '../bounce/limits.ts'
import { vsmLayout, vsmResourceBytes } from '../vsm/layout.ts'
import {
  VSM_RENDER_PAIR_CAPACITY,
  VSM_RENDER_CMD_BYTES,
  VSM_RENDER_PAIR_BYTES,
} from '../vsm/constants.ts'
import { vsmTransmissionBytes } from '../vsm/transmissionLayout.ts'
import { MIB } from '../../../math/src/constants.ts'
import { alignUp } from '../../../math/src/scalar/integers.ts'

/**
 * The virtual shadow maps of one sun on a device whose storage bindings hold `binding` bytes, at
 * the default pool — `vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 })`, one
 * page-table row (`fullMapsFor`) and 2048 physical pages in two slices —: every buffer of the set
 * (`vsmResourceBytes`, `../vsm/layout.ts`), the raster's pair and command lists at their ceiling
 * (`VSM_RENDER_PAIR_CAPACITY`, one command a pair at most, `../vsm/constants.ts`) and the
 * coloured transmission's first atlas (`vsmTransmissionBytes`, `../vsm/transmissionLayout.ts`).
 * The projection's mask, sized by the canvas, is a frame target. Only the shadows' size modules,
 * never a pass: the core holds this budget, and no shadow pass (`scripts/core-sources.ts`).
 */
function oneSunShadowMaps(binding = 128 * MIB) {
  const layout = vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 }, binding)
  const lists = VSM_RENDER_PAIR_CAPACITY * (VSM_RENDER_PAIR_BYTES + VSM_RENDER_CMD_BYTES)
  return { layout, bytes: vsmResourceBytes(layout) + lists + vsmTransmissionBytes(layout) }
}

/**
 * THE SHADOWS' GPU SHARE: the virtual shadow maps of one sun at the default pool and a 128 MiB
 * binding (`oneSunShadowMaps`), rounded up to whole MiB. Derived from the maps' own sizes, so it
 * cannot drift from them; `world/core/worldBudget.test.ts` holds it, within a MiB, to the same maps
 * summed again from their parts (`budget.fixture.ts`).
 */
export const SHADOW_POOL_BYTES = alignUp(oneSunShadowMaps().bytes, MIB)

/**
 * GPU bytes of the bounce probe cascades at their largest — every level of `cascadeSize³` probes,
 * the nine RGB coefficients, visibility and state of each, in both copies the pass binds (the
 * probes and the snapshot frozen before each update). Fixed whatever the scene.
 */
export const BOUNCE_PROBE_BYTES =
  2 * bounceProbeBytes(BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3)
