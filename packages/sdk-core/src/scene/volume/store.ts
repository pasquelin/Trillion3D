import { EngineError } from '../../contracts/cache.ts'
import { resolveFogVolume, sameFogVolume, type SceneFogVolume } from './contracts.ts'
import type { ResolvedFogVolume } from './contracts.ts'

/** The volume objects of a scene (`createSceneFogVolumeStore`). */
export type SceneFogVolumeStore = ReturnType<typeof createSceneFogVolumeStore>

/**
 * The objects voxelised into the fog's volume, by name, in the order they were added. A change
 * bumps `revision`, which tells a reader (the frame that voxelises them) to read them again;
 * setting an object to what it already is changes nothing.
 */
export function createSceneFogVolumeStore() {
  const records = new Map<string, ResolvedFogVolume>()
  let revision = 0
  return {
    /** Bumped when an object is added, changed or removed. */
    get revision() {
      return revision
    },
    /** How many objects. */
    get count() {
      return records.size
    },
    /** The held objects, the store's own: the frame reads them and copies nothing. */
    get values() {
      return records.values()
    },
    /** One held object. */
    get: (id: string) => records.get(id),
    /** Adds an object. */
    add(volume: SceneFogVolume) {
      const resolved = resolveFogVolume(volume)
      if (records.has(resolved.id))
        throw new EngineError('DUPLICATE_SCENE_FOG_VOLUME', `fog volume ${resolved.id} exists`, {
          id: resolved.id,
        })
      records.set(resolved.id, resolved)
      revision++
    },
    /** Changes an object: the fields of `patch` replace its own. */
    set(id: string, patch: Partial<Omit<SceneFogVolume, 'id'>>) {
      const current = records.get(id)
      if (!current)
        throw new EngineError('UNKNOWN_SCENE_FOG_VOLUME', `unknown fog volume ${id}`, { id })
      const merged = resolveFogVolume({ ...current, ...patch, id })
      if (sameFogVolume(current, merged)) return
      records.set(id, merged)
      revision++
    },
    /** Removes an object. */
    remove(id: string) {
      if (!records.delete(id))
        throw new EngineError('UNKNOWN_SCENE_FOG_VOLUME', `unknown fog volume ${id}`, { id })
      revision++
    },
  }
}
