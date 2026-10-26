import { resolveSettingsInto } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  SETTING_FAMILIES,
  type AllFamilyValues,
  type FamilyTable,
} from '../../../../sdk-core/src/runtime/settingFamilies.ts'

/**
 * The settings of every family of `table` (`SETTING_FAMILIES`) read from a session's `options`, in
 * the table's order, each by its field and its one resolver: a value of another kind or out of
 * range is refused at the opening, naming the field and the values it takes, as the world refuses
 * it. What the engine's context holds of them (`AllFamilyValues`).
 */
export function resolvedFamilies(
  options: object,
  table: FamilyTable = SETTING_FAMILIES,
): AllFamilyValues {
  const resolved: Record<string, unknown> = {}
  for (const { rules } of Object.values(table))
    resolveSettingsInto(rules, options as never, resolved as never)
  return resolved as AllFamilyValues
}
