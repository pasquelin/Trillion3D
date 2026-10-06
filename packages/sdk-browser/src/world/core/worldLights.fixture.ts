import { mock } from 'node:test'
import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import { Light } from '../../../../sdk-core/src/world/light/light.ts'
import { addLightIrradiance, lampRecord } from '../../../../sdk-core/src/world/light/lightRecord.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { emptyIrradiance, type SceneLight } from '../../../../sdk-core/src/index.ts'
import { sameSceneLight } from '../../../../sdk-core/src/scene/light/equal.ts'
import { rootedUnder } from '../../host/world/rooted.ts'
import { createWorldLights } from './worldLights.ts'
import { createWorldLink } from './worldLink.ts'

/** A light store keeping what is written into it, and the order lamps were added in. */
export const lightStore = () => {
  const held = new Map<string, SceneLight>()
  const added: string[] = []
  return {
    held,
    added,
    addLight: (record: SceneLight) => void (held.set(record.id, record), added.push(record.id)),
    setLight: (id: string, patch: Partial<SceneLight>) =>
      void held.set(id, { ...held.get(id)!, ...patch }),
    removeLight: (id: string) => void held.delete(id),
  }
}
export type LightStore = ReturnType<typeof lightStore>

/** A scene whose link tells a world's lights, as a world's runtime wires them; the frames it
 *  asked are counted. */
export function wiredLights(scene: Object3D = object.group()) {
  const lights = createWorldLights(scene)
  const calls = { relight: 0, invalidate: 0 }
  const contents = {
    poses: { moved() {}, touchRange() {} },
    changed() {},
    entered() {},
    stale() {},
  }
  scene._link = createWorldLink({
    contents: contents as never,
    lights,
    invalidate: () => void calls.invalidate++,
    relight: () => void calls.relight++,
    schedule: () => {},
  })
  return { scene, lights, calls }
}

/** How many times `run` asks whether a node is a light (`isLightNode`, an `instanceof`). */
export function lightChecks(run: () => void) {
  let checks = 0
  const is = (node: unknown) => (checks++, Function.prototype[Symbol.hasInstance].call(Light, node))
  Object.defineProperty(Light, Symbol.hasInstance, { configurable: true, value: is })
  try {
    run()
  } finally {
    delete (Light as { [Symbol.hasInstance]?: unknown })[Symbol.hasInstance]
  }
  return checks
}

/** How many children lists `run` reads, of the nodes `on` names. */
export function childReads(run: () => void, on: (node: object) => boolean) {
  const spy = mock.getter(Object3D.prototype, 'children')
  try {
    run()
    return spy.mock.calls.filter((call) => call.this instanceof Object3D && on(call.this)).length
  } finally {
    spy.mock.restore()
  }
}

/** How many content boxes `run` reads: what measuring the scene's extent costs. */
export function boxReads(run: () => void) {
  const spy = mock.method(Mesh.prototype, 'localBounds')
  try {
    run()
    return spy.mock.callCount()
  } finally {
    spy.mock.restore()
  }
}

/**
 * The light sync as a walk of the whole scene performs it: every node visited for its lights, the
 * extent measured on every sync. The reference every index is held to, to the bit.
 */
export function walkedLights(scene: Object3D) {
  const stored = new Map<Light, { id: string; record: SceneLight }>()
  let next = 1
  const state = { held: 0 }
  const sync = (api: LightStore) => {
    const lights: Light[] = []
    const sh = emptyIrradiance()
    let surrounding = false
    state.held = 0
    // Every node visited, each light shown by its own chain: none of the index's bookkeeping.
    scene.traverse((node) => {
      if (!(node instanceof Light)) return
      state.held++
      if (!rootedUnder(node, scene, true)) return
      lights.push(node)
      if (addLightIrradiance(node, sh)) surrounding = true
    })
    const { min, max } = new Box3().setFromObject(scene)
    const reach = (at: Vector3) => {
      const dx = Math.max(Math.abs(min.x - at.x), Math.abs(max.x - at.x)),
        dy = Math.max(Math.abs(min.y - at.y), Math.abs(max.y - at.y)),
        dz = Math.max(Math.abs(min.z - at.z), Math.abs(max.z - at.z))
      const far = Math.sqrt(dx * dx + dy * dy + dz * dz)
      return Number.isFinite(far) && far > 0 ? far : 1
    }
    for (const [light, { id }] of stored)
      if (!lights.includes(light)) {
        api.removeLight(id)
        stored.delete(light)
      }
    for (const light of lights) {
      const last = stored.get(light)
      const id = last?.id ?? `world-light-${next++}`
      const record = lampRecord(light, id, reach)
      if (!record) {
        if (last) {
          api.removeLight(id)
          stored.delete(light)
        }
        continue
      }
      if (last && sameSceneLight(last.record, record)) continue
      const keys = Object.keys(record)
      const same = last && keys.length === Object.keys(last.record).length
      if (same && keys.every((key) => key in last.record)) api.setLight(id, record)
      else {
        if (last) api.removeLight(id)
        api.addLight(record)
      }
      stored.set(light, { id, record })
    }
    return surrounding ? sh : undefined
  }
  return { sync, state }
}
