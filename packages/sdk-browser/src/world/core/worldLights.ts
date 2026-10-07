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
  const state: LightsState = {
    scene,
    stored: new Map(),
    bounds: new Box3(),
    holders: new Set(),
    below: new Map(),
    shown: new Set(),
    sh: emptyIrradiance(),
    next: 1,
    boundsStale: true,
    indexed: false,
    held: 0,
    surrounding: false,
  }
  const reachOf = (at: Vector3) => reach(state, at)
  return {
    /** The session changed: its store starts empty. */
    reset() {
      state.stored.clear()
      state.boundsStale = true
    },
    /** Something that may hold content moved or changed: the extent is measured again. */
    boundsMoved() {
      state.boundsStale = true
    },
    /** A parent's children changed: the holders are let go — the next sync walks the scene for
     *  its lights — and the extent is measured again. */
    structure() {
      if (state.indexed) {
        state.holders.clear()
        state.below.clear()
        state.indexed = false
      }
      state.boundsStale = true
    },
    /** How many lights the scene held at the last sync. */
    get held() {
      return state.held
    },
    /** True when moving `node` moves a light. */
    holds: (node: Object3D) => (state.indexed ? state.holders.has(node) : lightsUnder(node)),
    sync: (api: LightApi) => sync(state, api, reachOf),
  }
}

/** What a world's lights hold between syncs (`createWorldLights`). */
type LightsState = {
  scene: Object3D
  stored: Map<Light, { id: string; record: SceneLight }>
  bounds: Box3
  /** Every light of the scene and every node above one, as the last walk found them. */
  holders: Set<Object3D>
  /** Each holder's held children, in its order. */
  below: Map<Object3D, Object3D[]>
  /** A sync's scratch, kept so it allocates none: the lights it shows, in the scene's order, and
   *  what they give from every direction — handed to the store, which copies it. */
  shown: Set<Light>
  sh: number[]
  next: number
  boundsStale: boolean
  indexed: boolean
  held: number
  surrounding: boolean
}

/** How far a lamp the page left unbounded reaches from `at`: the farthest corner of the scene. */
function reach(state: LightsState, at: Vector3) {
  const { bounds } = state
  if (state.boundsStale) bounds.setFromObject(state.scene)
  state.boundsStale = false
  const { min, max } = bounds
  const dx = Math.max(Math.abs(min.x - at.x), Math.abs(max.x - at.x)),
    dy = Math.max(Math.abs(min.y - at.y), Math.abs(max.y - at.y)),
    dz = Math.max(Math.abs(min.z - at.z), Math.abs(max.z - at.z))
  const far = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return Number.isFinite(far) && far > 0 ? far : 1
}

/** Whether `node` holds a light; if so it is kept, and its held children listed in order. */
function index(state: LightsState, node: Object3D): boolean {
  let holds = isLightNode(node)
  for (const child of node.children) {
    if (!index(state, child)) continue
    holds = true
    const list = state.below.get(node)
    if (list) list.push(child)
    else state.below.set(node, [child])
  }
  if (holds) state.holders.add(node)
  return holds
}

/** The lights under `node`, in order: each counted, a shown one kept with what it gives from
 *  every direction. A light lights while it and every node above it are visible, as a mesh is
 *  drawn; a hidden one is still held, so showing it again relights. */
function visit(state: LightsState, node: Object3D, lit: boolean) {
  for (const child of state.below.get(node) ?? NONE) {
    const showing = lit && child.visible
    if (isLightNode(child)) {
      state.held++
      if (showing) state.shown.add(child)
      if (showing && addLightIrradiance(child, state.sh)) state.surrounding = true
    }
    visit(state, child, showing)
  }
}

function drop(state: LightsState, api: LightApi, light: Light, id: string) {
  api.removeLight(id)
  state.stored.delete(light)
}

/** Writes the lamps into the store and returns what every other light gives from every
 *  direction — ambient, sky over ground, probe — as the environment's irradiance, or
 *  undefined when none gives any. The coefficients are the next sync's to write again. */
function sync(
  state: LightsState,
  api: LightApi,
  reachOf: (at: Vector3) => number,
): number[] | undefined {
  const { scene, stored, shown, sh } = state
  if (!state.indexed) {
    index(state, scene)
    state.indexed = true
  }
  shown.clear()
  sh.fill(0)
  state.surrounding = false
  state.held = 0
  visit(state, scene, scene.visible)
  for (const [light, { id }] of stored) if (!shown.has(light)) drop(state, api, light, id)
  for (const light of shown) {
    const last = stored.get(light)
    const id = last?.id ?? `world-light-${state.next++}`
    const record = lampRecord(light, id, reachOf)
    if (!record) {
      if (last) drop(state, api, light, id)
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
  return state.surrounding ? sh : undefined
}
