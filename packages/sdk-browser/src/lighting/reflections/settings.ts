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
  type WaterFrontSettings,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'

/** Whether two asks of the front layer are the same: both none, or equal in each of their seven values. */
const sameWater = (a: WaterFrontSettings | undefined, b: WaterFrontSettings | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.block[0] === b.block[0] &&
    a.block[1] === b.block[1] &&
    a.reconstruction === b.reconstruction &&
    a.temporal === b.temporal &&
    a.bilateral === b.bilateral &&
    a.sceneTraces === b.sceneTraces &&
    a.distantTraces === b.distantTraces)

/**
 * THE ONE READER OF THE REFLECTIONS' SETTINGS (`reflectionOptions.ts`): from a context that holds them as options
 * — the reflections' own and the screen probes' they share (the scene trace's switch, the bias, the longest
 * ray) —, each image asks and gets the settings of the last image back while no value moved:
 * nothing is resolved, nothing allocated.
 */
export function createReflectionSettingsReader() {
  const own = settingsWatch(REFLECTION_RULES)
  const probes = settingsWatch(SCREEN_PROBE_RULES)
  let held: ReflectionSettings | undefined, heldWater: WaterFrontSettings | undefined
  return (options: ReflectionOptions & ScreenProbeOptions, water?: WaterFrontSettings) => {
    const values = own.read(options)
    const shared = probes.read(options)
    if (!held || own.moved || probes.moved || !sameWater(water, heldWater)) {
      held = resolveReflections(values, resolveScreenProbes(shared), water)
      // A copy: the caller may write the one it hands in again.
      heldWater = water && { ...water, block: [water.block[0], water.block[1]] }
    }
    return held
  }
}

/** Whether the settings `options` hold trace the transparents' front layer (`ReflectionSettings.frontLayer`), `water`
 *  being whether the scene's single-layer water asks for it: what the front stage is compiled for, before any
 *  image reads the reflections' own reader. */
export const tracesFrontLayer = (
  options: ReflectionOptions & ScreenProbeOptions,
  water?: WaterFrontSettings,
) => createReflectionSettingsReader()(options, water).frontLayer
