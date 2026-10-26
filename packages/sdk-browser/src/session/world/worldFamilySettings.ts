import {
  memberOf,
  SETTING_FAMILIES,
  type FamilyTable,
} from '../../../../sdk-core/src/runtime/settingFamilies.ts'
import type { WorldImageSettings } from './worldImageTypes.ts'
import type { WorldParts } from './worldParts.ts'
import type { WorldSceneSettings } from './worldSceneTypes.ts'

/**
 * The accessors of the families of `table` that the world's interface `surface` carries
 * (`SETTING_FAMILIES`, each row's `world`): a getter that reads the family's settings resolved over
 * the page and the quality preset, and a setter that checks the world is live and writes the
 * page's settings the options name (`switches`, `ruledAccessors.ts`). Each is defined as an
 * accessor, never a copy: the object reads and writes its source at every call.
 */
function familyMembers(
  { switches, live }: WorldParts,
  surface: 'scene' | 'image',
  table: FamilyTable,
) {
  const held = switches as unknown as Record<string, unknown>
  const members: PropertyDescriptorMap = {}
  for (const [name, family] of Object.entries(table)) {
    if (family.world !== surface) continue
    const member = memberOf(name, table)
    members[member] = {
      enumerable: true,
      configurable: true,
      get: () => held[member],
      set: (options: unknown) => {
        live()
        held[member] = options
      },
    }
  }
  return Object.defineProperties({}, members)
}

/** The world's scene settings by rule (`WorldSceneSettings`, `worldSceneTypes.ts`), one accessor for
 *  each family of `table` the interface carries. */
export const worldSceneSettings = (
  parts: WorldParts,
  table: FamilyTable = SETTING_FAMILIES,
): WorldSceneSettings => familyMembers(parts, 'scene', table) as WorldSceneSettings

/** The world's image settings by rule (`WorldImageSettings`, `worldImageTypes.ts`), one accessor for
 *  each family of `table` the interface carries. */
export const worldImageSettings = (
  parts: WorldParts,
  table: FamilyTable = SETTING_FAMILIES,
): WorldImageSettings => familyMembers(parts, 'image', table) as WorldImageSettings
