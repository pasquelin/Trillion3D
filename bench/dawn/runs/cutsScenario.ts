// The scenario `cuts`: the same still view, once whole and then with one stochastic part cut at a time, by the world's public settings, each segment
// captured on its own — the grain of an image compared part by part (`--scenario cuts`). A setting given back as `null` returns to what the preset says.
import type { Scenario } from './scenario.ts'

const STILL = 240

/** A segment of the still view with the settings it applies, each by the name of the world's accessor. */
const cut = (name: string, world: Record<string, unknown>) => ({
  name,
  frames: STILL,
  capture: true,
  world,
})

export const CUTS_SCENARIO: Scenario = {
  name: 'cuts',
  segments: [
    cut('whole', {}),
    cut('taa off', { temporalAntialiasing: false }),
    cut('shadows off', { temporalAntialiasing: null, shadows: { shadowQuality: 0 } }),
    cut('probes off', {
      shadows: { shadowQuality: null },
      indirectLight: { screenProbes: 'off', bounce: false },
    }),
    cut('occlusion off', {
      indirectLight: { screenProbes: null, bounce: null },
      ambientOcclusion: { ambientOcclusion: false },
    }),
    cut('reflections off', {
      ambientOcclusion: { ambientOcclusion: null },
      reflections: { reflectionQuality: 'off' },
    }),
  ],
}
