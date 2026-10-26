import type { WebgpuLightState } from '../../../frame/backend/state/lights.ts'
import { releaseCastChanges } from './castChanges.ts'
import { releaseCastDiff } from './castDiff.ts'
import { releaseCasterFeed } from './casterFeed.ts'

/** Frees what the shadows keep of the casters with the session: the placements' words, the shadow
 *  changes with the diff's memory, the casters' list and decoded clusters. */
export function releaseShadowCasters(lights: WebgpuLightState) {
  lights.rootWords?.destroy()
  lights.rootWords = undefined
  releaseCastDiff(lights.casts)
  releaseCastChanges(lights.casts)
  lights.casts = undefined
  releaseCasterFeed(lights.casters)
  lights.casters = undefined
}
