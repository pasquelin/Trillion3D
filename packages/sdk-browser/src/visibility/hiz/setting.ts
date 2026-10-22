import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { HIZ_RULES } from '../../../../sdk-core/src/contracts/hizOptions.ts'

/** The depth pyramid's setting `field` a runtime's session holds (`hizOptions.ts`), by its one
 *  resolver, read at each image: how the reflections' trace reads the pyramid, whether its trace
 *  layers fold the transparents, how the transparent clusters are tested. */
export const hizSetting = contextReader(HIZ_RULES)
