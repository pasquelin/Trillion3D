import type { ExplorerSwitch } from './explorerSwitches.ts'

/** Every explorer switch by name: the compiler refuses this record if one is missing or unknown. */
export const EXPLORER_SWITCH_NAMES = Object.keys({
  interactive: 0,
  temporalAntialiasing: 0,
  lodAdaptive: 0,
  bounce: 0,
  importedLights: 0,
  autonomousGeometry: 0,
  stageProfile: 0,
} satisfies Record<ExplorerSwitch, 0>) as ExplorerSwitch[]
