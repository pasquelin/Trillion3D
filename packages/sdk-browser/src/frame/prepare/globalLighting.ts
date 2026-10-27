import { intensityOf, lightColour } from '../../../../sdk-core/src/scene/light/fields.ts'
import { contactShadowOfLight } from '../../../../sdk-core/src/scene/light/lightContactShadow.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { skyLightColor } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import { readSurfaceCacheSetting } from '../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import { heldSkyLight } from '../render/skyLightHeld.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The factor a colour must grow or shrink by to be a big change of the lighting. */
const BIG_CHANGE = 4
/** The least colour a change is measured against, so that a light that appears or goes is a change of its whole. */
const LEAST_COLOUR = 0.00001

/** The greatest channel of the declared colour times the intensity of the first directional light of the store that gives indirect light
 *  (before the air tints it, which follows the sun's height and is no change of the light); zero where none does. */
function sunColourOf(store: Pick<SceneLightStore, 'ids' | 'light'>) {
  for (const id of store.ids) {
    const light = store.light(id)
    if (light?.kind !== 'directional' || contactShadowOfLight(light).indirectLightingIntensity <= 0)
      continue
    return Math.max(...lightColour(light)) * intensityOf(light)
  }
  return 0
}

/** Whether `now` is more than `BIG_CHANGE` times, or less than its inverse, what `before` was. */
const changedGreatly = (before: number, now: number) => {
  const ratio = Math.max(before, LEAST_COLOUR) / Math.max(now, LEAST_COLOUR)
  return ratio > BIG_CHANGE || ratio < 1 / BIG_CHANGE
}

/**
 * The colours of the sun and of the sky light this image against the last: a change of either by more than four times, up or down, is
 * a big change of the lighting, and the probes it left are of a lighting that was. Where the setting
 * allows (`surfaceCachePropagateGlobalLightingChange`), the cache the probes hold is discarded and the image traces every probe it reads at no
 * budget (`probes.discard`), and the screen probes read no history in it (`bounce.historyLost`). The colours are kept either way.
 */
export function followGlobalLighting(rt: WebgpuPagesRuntime, probes: { discard(): void }) {
  const { bounce, lights } = rt
  const part = heldSkyLight(rt)
  const sun = sunColourOf(lights.store)
  const sky = part ? Math.max(...skyLightColor(part, true)) : 0
  const changed = changedGreatly(bounce.sunColour, sun) || changedGreatly(bounce.skyColour, sky)
  bounce.sunColour = sun
  bounce.skyColour = sky
  bounce.historyLost =
    changed && readSurfaceCacheSetting(rt, 'surfaceCachePropagateGlobalLightingChange')
  if (bounce.historyLost) probes.discard()
}
