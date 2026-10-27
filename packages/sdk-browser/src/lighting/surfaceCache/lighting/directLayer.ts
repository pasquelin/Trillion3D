import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'

/**
 * Whether the direct-light layer of the atlas has to be cleared in this image: the direct light is off and the layer may still hold
 * the light of the images it was on. It holds none after, and the passes that write the layer (the direct pass for the listed tiles,
 * the lights copy of a capture) write none while the light is off; a new atlas is cleared whole when it is made.
 */
export function directLayerStale(state: { directHeld: boolean }, settings: SurfaceCacheSettings) {
  const stale = state.directHeld && !settings.surfaceCacheDirectLighting
  state.directHeld = settings.surfaceCacheDirectLighting
  return stale
}
