import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { readLightProfileSetting } from '../../../../sdk-core/src/contracts/lightProfileOptions.ts'
import { createLightProfileAtlas, type LightProfileAtlas } from './profileAtlas.ts'
import type { LightProfileResources } from './profileBindings.ts'
import {
  createLightProfileRegistry,
  createLightProfileSync,
  requestLightProfiles,
  type LightProfileRegistry,
} from './profileSync.ts'

/** What the frame keeps of the light profiles: the atlas, the profiles read, and the sync that follows the lights. */
export interface LightProfileFrame {
  readonly atlas: LightProfileAtlas
  readonly registry: LightProfileRegistry
  readonly sync: ReturnType<typeof createLightProfileSync>
  /** The store's profile epoch the files were last asked at: the lights are looked at again only when it moves. */
  requestedEpoch: number
  /** The files asked of the cache and not yet answered: an image drawn meanwhile is drawn again, never held. */
  loading: number
}

type Rt = WebgpuPagesRuntime

const frameOf = (rt: Rt, device: GPUDevice) => {
  const held = rt.lights.lightProfile
  if (held) return held
  const atlas = createLightProfileAtlas(device)
  const registry = createLightProfileRegistry()
  return (rt.lights.lightProfile = {
    atlas,
    registry,
    sync: createLightProfileSync(atlas, registry),
    requestedEpoch: -1,
    loading: 0,
  })
}

/**
 * The light profiles of an image, before the light buffer goes up: for the lights that name a profile
 * not yet held, its file asked of the cache (`EngineContext.lightProfileFile`; a host that registers its own
 * profiles has none to ask), then the atlas and the lights' slices brought up to date (`createLightProfileSync`). Nothing is
 * made, and no light is looked at, while the scene has no profiled light.
 */
export function encodeLightProfiles(rt: Rt, device: GPUDevice) {
  const { store } = rt.lights
  if (store.profiled === 0 && !rt.lights.lightProfile) return
  const frame = frameOf(rt, device)
  const read = rt.context.lightProfileFile
  if (read && frame.requestedEpoch !== store.profileEpoch) {
    frame.requestedEpoch = store.profileEpoch
    const loads = requestLightProfiles(store, frame.registry, read)
    frame.loading += loads.length
    for (const load of loads)
      load
        .catch((error) => rt.diag.diagnosticFailure('light-profile-failed', error))
        .finally(() => frame.loading--)
  }
  frame.sync.sync(
    store,
    readLightProfileSetting(rt, 'lightProfileAtlasResolution'),
    readLightProfileSetting(rt, 'lightProfileAtlasMaxProfiles'),
  )
  // No light names a profile any more: the texture goes, and is made again with the next profile a light names.
  if (store.profiled === 0) frame.atlas.destroy()
}

/** Whether a profile file is still being read, or one has been read, or a setting of the atlas moved, that the lights have not been given the slice of yet: the image drawn meanwhile
 *  is drawn again (`holdWebgpuFrame`), and the next syncs the atlas. */
export const lightProfilesWaiting = (rt: Rt) => {
  const frame = rt.lights.lightProfile
  return (
    !!frame &&
    (frame.loading > 0 ||
      !frame.sync.upToDate(
        rt.lights.store,
        readLightProfileSetting(rt, 'lightProfileAtlasResolution'),
        readLightProfileSetting(rt, 'lightProfileAtlasMaxProfiles'),
      ))
  )
}

/** What a program that reads the light profiles binds, or none where the scene names no profile. */
export function lightProfileResources(rt: Rt): LightProfileResources | undefined {
  const frame = rt.lights.lightProfile
  return frame && rt.lights.store.profiled > 0
    ? { view: frame.atlas.view, sampler: frame.atlas.sampler }
    : undefined
}

/** Hands the atlas to the retire list: the session's end. */
export function releaseLightProfiles(rt: Rt) {
  rt.lights.lightProfile?.atlas.destroy()
  rt.lights.lightProfile = undefined
}
