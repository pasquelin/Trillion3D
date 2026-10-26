import type { EngineContext } from '../session/engine/types.ts'
import { settingWriter } from '../../../sdk-core/src/contracts/settingRules.ts'
import {
  setterOf,
  SETTING_FAMILIES,
  type FamilyTable,
} from '../../../sdk-core/src/runtime/settingFamilies.ts'

/**
 * The writers of the families of `table` (`SETTING_FAMILIES`) into `context`, one for each, named
 * `set` and the family's name (`setterOf`): every family but the ones whose settings have a writer
 * of their own each (`named`), which `createExplorerRuleApi` writes. A family added to the table
 * has its writer here, and its documented type in `ExplorerRuleApi`.
 */
export function familyWriters(
  context: EngineContext,
  check: () => void,
  table: FamilyTable = SETTING_FAMILIES,
) {
  const writers: Record<string, unknown> = {}
  for (const [name, family] of Object.entries(table))
    if (!family.named)
      writers[setterOf(name)] = settingWriter(family.rules, context as never, check)
  return writers
}
