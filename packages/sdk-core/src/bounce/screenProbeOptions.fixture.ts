import { resolveSettings } from '../contracts/settingRules.ts'
import {
  resolveScreenProbes,
  SCREEN_PROBE_RULES,
  type ScreenProbeOptions,
} from './screenProbeOptions.ts'

/** The settings of the screen probes a host's options name, resolved: what a test reads the numbers of a view from. */
export const screenProbeSettings = (options: ScreenProbeOptions = {}) =>
  resolveScreenProbes(resolveSettings(SCREEN_PROBE_RULES, options))
