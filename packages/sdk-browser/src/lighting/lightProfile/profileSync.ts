import type { LightProfileData } from './profileCodec.ts'
import type { LightProfileAtlas } from './profileAtlas.ts'

/** The profiles the engine has read, by id: from a cache's files, or registered by a host. */
export function createLightProfileRegistry() {
  const loaded = new Map<string, LightProfileData>()
  const asked = new Set<string>()
  let version = 0
  return {
    get: (id: string) => loaded.get(id),
    /** Holds `data` as profile `id`; the lights that name it pick it up at the next sync. */
    register(id: string, data: LightProfileData) {
      loaded.set(id, data)
      version++
    },
    /** Whether `id` was not asked for before and is not held: true once, for the caller to load it. */
    ask(id: string) {
      if (loaded.has(id) || asked.has(id)) return false
      asked.add(id)
      return true
    },
    /** Rises with each profile registered. */
    get version() {
      return version
    },
  }
}

/** The registry of the profiles read. */
export type LightProfileRegistry = ReturnType<typeof createLightProfileRegistry>

/** What the sync reads of the light store, and writes into it (`SceneLightStore`). */
export interface ProfileStore {
  readonly count: number
  readonly ids: readonly string[]
  /** Rises when a light that names a profile is added or removed, or a light's profile changes: the only
   *  changes of the store a sync follows. */
  readonly profileEpoch: number
  light(id: string): { readonly iesProfile?: string | undefined } | undefined
  assignLightProfile(slot: number, slice: number): void
}

/** The profiles the lights name that the registry does not hold and has not been asked for, each
 *  handed to `load` once; a profile `load` reads is registered, one it does not (`undefined`)
 *  leaves its lights as lamps with no profile. */
export function requestLightProfiles(
  store: ProfileStore,
  registry: LightProfileRegistry,
  load: (id: string) => Promise<LightProfileData | undefined>,
) {
  const loads: Promise<void>[] = []
  for (let slot = 0; slot < store.count; slot++) {
    const id = store.light(store.ids[slot])?.iesProfile
    if (id === undefined || !registry.ask(id)) continue
    loads.push(
      load(id).then((data) => {
        if (data) registry.register(id, data)
      }),
    )
  }
  return loads
}

/**
 * Keeps the atlas and the lights' lanes with the profiles the lights name. A light holds its profile
 * in the atlas (one hold a light, counted by profile); a sync takes holds for the lights that name a
 * loaded profile and frees those of the lights that went or changed, writes the atlas, and hands each
 * light the slice its profile is in (−1 for none). It follows
 * the store's profile epoch, which only a light's profile moves, and the registry's version: a light that
 * moves or flickers, a shadow slice that changes, wake it never.
 */
export function createLightProfileSync(atlas: LightProfileAtlas, registry: LightProfileRegistry) {
  /** The profile each light holds, and the sync that last saw the light name it. */
  const held = new Map<string, { profile: string; pass: number }>()
  let pass = 0
  let epoch = -1
  let version = -1
  let seenResolution = -1
  let seenMaxProfiles = -1
  const upToDate = (store: ProfileStore, resolution: number, maxProfiles: number) =>
    store.profileEpoch === epoch &&
    registry.version === version &&
    resolution === seenResolution &&
    maxProfiles === seenMaxProfiles
  return {
    /** Whether the last sync saw the store's profile epoch, the registry's version and the atlas's settings (the texels a side of a slice, the most profiles) as they are: the lights
     *  hold the slices of the profiles registered so far, in an atlas made as the settings say. */
    upToDate,
    /** Returns whether the atlas's texture was made by it (a bind group of its view is stale). */
    sync(store: ProfileStore, resolution: number, maxProfiles: number) {
      if (upToDate(store, resolution, maxProfiles)) return false
      pass++
      for (let slot = 0; slot < store.count; slot++) {
        const id = store.ids[slot]
        const profile = store.light(id)?.iesProfile
        const data = profile === undefined ? undefined : registry.get(profile)
        if (profile === undefined || !data) continue
        const had = held.get(id)
        if (had?.profile === profile) {
          had.pass = pass
          continue
        }
        if (had) atlas.slots.remove(had.profile)
        atlas.slots.add(profile, data)
        held.set(id, { profile, pass })
      }
      for (const [id, entry] of held)
        if (entry.pass !== pass) {
          atlas.slots.remove(entry.profile)
          held.delete(id)
        }
      const remade = atlas.sync(resolution, maxProfiles)
      for (let slot = 0; slot < store.count; slot++) {
        const mine = held.get(store.ids[slot])
        store.assignLightProfile(slot, mine ? atlas.slots.sliceOf(mine.profile) : -1)
      }
      epoch = store.profileEpoch
      version = registry.version
      seenResolution = resolution
      seenMaxProfiles = maxProfiles
      return remade
    },
  }
}
