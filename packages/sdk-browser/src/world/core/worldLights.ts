import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { Light } from '../../../../sdk-core/src/world/light/light.ts'
import { addLightIrradiance, lampRecord } from '../../../../sdk-core/src/world/light/lightRecord.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { isLightNode } from '../../host/graph/kinds.ts'
import { emptyIrradiance, type SceneLight } from '../../../../sdk-core/src/index.ts'
import { sameSceneLight } from '../../../../sdk-core/src/scene/light/equal.ts'

/** The light calls of a session (`world/api/lightApi.ts`) the world writes its lights through. */
type LightApi = {
  addLight(light: SceneLight): void
  setLight(id: string, patch: Partial<Omit<SceneLight, 'id'>>): void
  removeLight(id: string): void
}

const NONE: readonly Object3D[] = []

/** True when `node` is a light or one hangs under it: moving the node moves the light. */
function lightsUnder(node: Object3D): boolean {
  if (isLightNode(node)) return true
  for (const child of node.children) if (lightsUnder(child)) return true
  return false
}

/** The same optional members, so a patch of `next` over `last` leaves none of `last`'s behind. */
const sameKeys = (last: SceneLight, next: SceneLight) => {
  const keys = Object.keys(next)
  return keys.length === Object.keys(last).length && keys.every((key) => key in last)
}

/**
 * Keeps a session's light store equal to the lights of a scene. A light the page left unbounded
 * reaches the farthest corner of what the scene holds, seen from where it stands: the range is
 * derived from the scene's own extent, never picked. That extent is measured only for such a
 * lamp, and again only after something in the scene moved or changed (`boundsMoved`).
 *
 * The scene is walked for its lights once after its structure changed, by the first sync that
 * needs them: the walk keeps the nodes that hold a light — each light and every node above it,
 * whose move moves the light — and each holder's held children in its order. Every later sync
 * reads the lights through them alone, in the scene's order, and a pose write asks the holders
 * whether it moved a light. Until that walk, a pose write asks the moved subtree itself.
 */
export function createWorldLights(scene: Object3D) {
  const stored = new Map<Light, { id: string; record: SceneLight }>()
  const bounds = new Box3()
  /** Every light of the scene and every node above one, as the last walk found them. */
  const holders = new Set<Object3D>()
  /** Each holder's held children, in its order. */
  const below = new Map<Object3D, Object3D[]>()
  /** A sync's scratch, kept so it allocates none: the lights it shows, in the scene's order, and
   *  what they give from every direction — handed to the store, which copies it. */
  const shown = new Set<Light>(),
    sh = emptyIrradiance()
  let next = 1,
    boundsStale = true,
    indexed = false,
    held = 0,
    surrounding = false
  const reach = (at: Vector3) => {
    if (boundsStale) bounds.setFromObject(scene)
    boundsStale = false
    const { min, max } = bounds
    const dx = Math.max(Math.abs(min.x - at.x), Math.abs(max.x - at.x)),
      dy = Math.max(Math.abs(min.y - at.y), Math.abs(max.y - at.y)),
      dz = Math.max(Math.abs(min.z - at.z), Math.abs(max.z - at.z))
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz)
    return Number.isFinite(far) && far > 0 ? far : 1
  }
  /** Whether `node` holds a light; if so it is kept, and its held children listed in order. */
  const index = (node: Object3D): boolean => {
    let holds = isLightNode(node)
    for (const child of node.children) {
      if (!index(child)) continue
      holds = true
      const list = below.get(node)
      if (list) list.push(child)
      else below.set(node, [child])
    }
    if (holds) holders.add(node)
    return holds
  }
  /** The lights under `node`, in order: each counted, a shown one kept with what it gives from
   *  every direction. A light lights while it and every node above it are visible, as a mesh is
   *  drawn; a hidden one is still held, so showing it again relights. */
  const visit = (node: Object3D, lit: boolean) => {
    for (const child of below.get(node) ?? NONE) {
      const showing = lit && child.visible
      if (isLightNode(child)) {
        held++
        if (showing) shown.add(child)
        if (showing && addLightIrradiance(child, sh)) surrounding = true
      }
      visit(child, showing)
    }
  }
  const drop = (api: LightApi, light: Light, id: string) => {
    api.removeLight(id)
    stored.delete(light)
  }
  return {
    /** The session changed: its store starts empty. */
    reset() {
      stored.clear()
      boundsStale = true
    },
    /** Something that may hold content moved or changed: the extent is measured again. */
    boundsMoved() {
      boundsStale = true
    },
    /** A parent's children changed: the holders are let go — the next sync walks the scene for
     *  its lights — and the extent is measured again. */
    structure() {
      if (indexed) {
        holders.clear()
        below.clear()
        indexed = false
      }
      boundsStale = true
    },
    /** How many lights the scene held at the last sync. */
    get held() {
      return held
    },
    /** True when moving `node` moves a light. */
    holds: (node: Object3D) => (indexed ? holders.has(node) : lightsUnder(node)),
    /** Writes the lamps into the store and returns what every other light gives from every
     *  direction — ambient, sky over ground, probe — as the environment's irradiance, or
     *  undefined when none gives any. The coefficients are the next sync's to write again. */
    sync(api: LightApi): number[] | undefined {
      if (!indexed) {
        index(scene)
        indexed = true
      }
      shown.clear()
      sh.fill(0)
      surrounding = false
      held = 0
      visit(scene, scene.visible)
      for (const [light, { id }] of stored) if (!shown.has(light)) drop(api, light, id)
      for (const light of shown) {
        const last = stored.get(light)
        const id = last?.id ?? `world-light-${next++}`
        const record = lampRecord(light, id, reach)
        if (!record) {
          if (last) drop(api, light, id)
          continue
        }
        if (last && sameSceneLight(last.record, record)) continue
        // A lamp keeping its members is written in its slot; one gaining or losing one is
        // written anew, so no member of its former record survives.
        if (last && sameKeys(last.record, record)) api.setLight(id, record)
        else {
          if (last) api.removeLight(id)
          api.addLight(record)
        }
        stored.set(light, { id, record })
      }
      return surrounding ? sh : undefined
    },
  }
}
