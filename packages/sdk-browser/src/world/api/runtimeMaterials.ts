import { EngineError } from '../../../../sdk-core/src/index.ts'
import type { RenderBackend } from '../../backend/types.ts'
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

/** Created surfaces and their map admissions, bounded before allocation and owned until drop. */
export function runtimeMaterials(check: () => void, backends: RenderBackend[]) {
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
    const held = created.size + pending
    if (held >= RUNTIME_MATERIAL_CEILING)
      throw new EngineError('MATERIAL_CEILING', 'runtime material ceiling reached', {
        held,
        asked: 1,
        ceiling: RUNTIME_MATERIAL_CEILING,
      })
    const id = `created-${next++}`
    validateCreated(id, props)
    if (props.map && backends.some((backend) => !backend.admitMaterial || !backend.releaseMaterial))
      throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'an engine cannot admit runtime maps', {
        id,
      })
    const map = props.map ? maps.take(props.map) : undefined
    const surface = createdSurface(props)
    if (map) surface.map = map.texture
    const variants = new Map([[PLAIN, surface]])
    const admitted: RenderBackend[] = []
    const release = () => {
      for (const backend of admitted)
        if (!backend.signal?.aborted) backend.releaseMaterial?.(surface)
      admitted.length = 0
      for (const variant of (created.get(id) ?? variants).values()) variant.dispose()
      map?.release()
      releases.delete(id)
      created.delete(id)
    }
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
    return (async () => {
      try {
        for (const backend of backends) {
          check()
          if (disposed) throw new Error('Runtime material admission cancelled')
          // Include the current backend so a partially failed admission also rolls back.
          admitted.push(backend)
          await backend.admitMaterial!(surface)
        }
        return publish()
      } catch (error) {
        release()
        throw error
      } finally {
        pending--
      }
    })()
  }
  return {
    created,
    createMaterial,
    mapBytes: () => maps.bytes,
    drop(id: string) {
      const release = releases.get(id)
      if (!release)
        throw new EngineError('UNKNOWN_MATERIAL', `the page created no material ${id}`, { id })
      release()
    },
    dispose() {
      disposed = true
      for (const release of releases.values()) release()
    },
  }
}
