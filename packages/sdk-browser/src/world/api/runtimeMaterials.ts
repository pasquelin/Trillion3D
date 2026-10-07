import { EngineError } from '../../../../sdk-core/src/index.ts'
import type { Engine } from '../../engine/types.ts'
import type { GraphSurface } from '../../host/graph/surface.ts'
import { read, type SceneMaterial } from './materialValues.ts'
import {
  createdSurface,
  PLAIN,
  RUNTIME_MATERIAL_CEILING,
  validateCreated,
  type CreatedMaterial,
} from './createdMaterials.ts'
import { runtimeMaps } from './runtimeMaps.ts'

const unknownMaterial = (id: string): never => {
  throw new EngineError('UNKNOWN_MATERIAL', `the page created no material ${id}`, { id })
}

/** Refused by name: `held` materials, those still admitting counted, are the ceiling. */
function refuseCeiling(held: number) {
  if (held >= RUNTIME_MATERIAL_CEILING)
    throw new EngineError('MATERIAL_CEILING', 'runtime material ceiling reached', {
      held,
      asked: 1,
      ceiling: RUNTIME_MATERIAL_CEILING,
    })
}

/** What a created material holds on the engine: its admission, marked before it starts so a
 *  failed one also rolls back, and given back with the rest (`forget`) on release. */
function ownership(engine: Engine, surface: GraphSurface, forget: () => void) {
  let admitted = false
  return {
    admit: () => ((admitted = true), engine.admitMaterial(surface)),
    release() {
      if (admitted && !engine.signal.aborted) engine.releaseMaterial(surface)
      admitted = false
      forget()
    },
  }
}

/** A map admitted by the engine, then the material published; a failure releases it whole. */
async function admit(
  start: () => Promise<void>,
  publish: () => SceneMaterial,
  release: () => void,
) {
  try {
    await start()
    return publish()
  } catch (error) {
    release()
    throw error
  }
}

/** Created surfaces and their map admissions, bounded before allocation and owned until drop. */
export function runtimeMaterials(check: () => void, engine: Engine) {
  const created = new Map<string, Map<string, GraphSurface>>()
  const releases = new Map<string, () => void>()
  const maps = runtimeMaps()
  let next = 0,
    pending = 0,
    disposed = false
  function createMaterial(props?: CreatedMaterial & { map?: undefined }): SceneMaterial
  function createMaterial(props: CreatedMaterial & { map: ImageBitmap }): Promise<SceneMaterial>
  function createMaterial(props: CreatedMaterial): SceneMaterial | Promise<SceneMaterial>
  function createMaterial(props: CreatedMaterial = {}): SceneMaterial | Promise<SceneMaterial> {
    check()
    if (disposed) throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'session is disposed', {})
    refuseCeiling(created.size + pending)
    const id = `created-${next++}`
    validateCreated(id, props)
    const map = props.map ? maps.take(props.map) : undefined
    const surface = createdSurface(props)
    if (map) surface.map = map.texture
    const variants = new Map([[PLAIN, surface]])
    const owned = ownership(engine, surface, () => {
      for (const variant of (created.get(id) ?? variants).values()) variant.dispose()
      map?.release()
      releases.delete(id)
      created.delete(id)
    })
    const { release } = owned
    const publish = () => {
      check()
      if (disposed)
        throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'session closed during admission', {
          id,
        })
      created.set(id, variants)
      releases.set(id, release)
      return read(id, surface)
    }
    if (!map) return publish()
    pending++
    const start = () => {
      check()
      if (disposed) throw new Error('Runtime material admission cancelled')
      return owned.admit()
    }
    return admit(start, publish, release).finally(() => pending--)
  }
  return {
    created,
    createMaterial,
    mapBytes: () => maps.bytes,
    drop: (id: string) => (releases.get(id) ?? unknownMaterial(id))(),
    dispose() {
      disposed = true
      for (const release of releases.values()) release()
    },
  }
}
