import {
  resolveScreenProbes,
  SCREEN_PROBE_RULES,
  type ScreenProbeOptions,
} from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import {
  REFLECTION_RULES,
  resolveReflections,
  type ReflectionOptions,
  type ReflectionSettings,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'

/**
 * THE ONE READER OF THE REFLECTIONS' SETTINGS (`reflectionOptions.ts`): from a context that holds them as options
 * — the reflections' own and the screen probes' they share (the scene trace's switch, the detail window's, its
 * length and fade, the bias) —, each image asks and gets the settings of the last image back while no value moved:
 * nothing is resolved, nothing allocated.
 */
export function createReflectionSettingsReader() {
  const own = settingsWatch(REFLECTION_RULES)
  const probes = settingsWatch(SCREEN_PROBE_RULES)
  let held: ReflectionSettings | undefined
  return (options: ReflectionOptions & ScreenProbeOptions) => {
    const values = own.read(options)
    const shared = probes.read(options)
    if (!held || own.moved || probes.moved)
      held = resolveReflections(values, resolveScreenProbes(shared))
    return held
  }
}
