import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { tableBytes, tableExtent } from '../../lighting/bounce/atlas.ts'
import { vsmCoverModeOf, vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { vsmResourceBytes } from '../../lighting/shadows/vsm/layoutBytes.ts'
import { VSM_RENDER_RECORD_BYTES, vsmRecordCapacity } from '../../lighting/shadows/vsm/constants.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SHADOW_RULES } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { cutListCaps } from '../../geometry/dag/lists/cutListCaps.ts'
import { MIB } from '../../../../math/src/constants.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'

/**
 * The virtual shadow maps of one sun at the default pool — `vsmLayout({ coverMode: 'suns',
 * fullMapCapacity: 63, sunMapCapacity: 18 })`, one page-table row (`fullMapsFor`) and 4096 physical
 * pages in two
 * slices; a device whose binding holds fewer draws a smaller pool, a higher level asks the budget's
 * room for its pool (`ActiveGpuMemory.shadowReserve`) —, its receiver cover the one the default settings make,
 * the suns' alone (`shadowUseReceiverMaskDirectional` on, `shadowUseReceiverMaskLocal` off; a higher level
 * that asks every map's asks the room, as it asks its pool): every buffer of the set
 * (`vsmResourceBytes`, `../../lighting/shadows/vsm/layoutBytes.ts`), the raster's two record lists
 * — the cull's and the same sorted by tier — at the records the reference's rule gives them
 * (`vsmRecordCapacity`, `../../lighting/shadows/vsm/constants.ts`): the cut's cap of visible clusters
 * times the raster's indirection multiplier, both at their defaults.
 * The projection's mask, sized by the canvas, is a frame target. Only the shadows' size modules,
 * never a pass: the core holds this budget, and no shadow pass (`scripts/build/core-sources.ts`).
 */
function oneSunShadowMaps() {
  const coverMode = vsmCoverModeOf(
    readSetting(SHADOW_RULES, {}, 'shadowUseReceiverMaskLocal'),
    readSetting(SHADOW_RULES, {}, 'shadowUseReceiverMaskDirectional'),
  )
  const layout = vsmLayout({ coverMode, fullMapCapacity: 63, sunMapCapacity: 18 })
  const records = vsmRecordCapacity(
    cutListCaps().visible,
    readSetting(SHADOW_RULES, {}, 'shadowRasterIndirectionMultiplier'),
  )
  const lists = records * 2 * VSM_RENDER_RECORD_BYTES
  return { layout, bytes: vsmResourceBytes(layout) + lists }
}

/**
 * THE SHADOWS' GPU SHARE: the virtual shadow maps of one sun at the default pool
 * (`oneSunShadowMaps`), rounded up to whole MiB. Derived from the maps' own sizes, so it
 * cannot drift from them; `session/world/budget.test.ts` holds it, within a MiB, to the same maps
 * summed again from their parts (`budget.fixture.ts`).
 */
export const SHADOW_POOL_BYTES = alignUp(oneSunShadowMaps().bytes, MIB)

/**
 * GPU bytes of the bounce probes' table, the one that names the probe each cell of the levels holds. Fixed
 * whatever the scene.
 */
export const BOUNCE_PROBE_BYTES = tableBytes(
  tableExtent(BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3),
)
