import { Box3, boxToFlat } from '../../../../sdk-core/src/world/math/box3.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { Light } from '../../../../sdk-core/src/world/light/light.ts'
import {
  addLightIrradiance,
  addSkyRadiance,
  lampRecord,
  type SkySource,
} from '../../../../sdk-core/src/world/light/lightRecord.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { isLightNode } from '../../scene/host/graph/kinds.ts'
import { emptyIrradiance } from '../../../../sdk-core/src/scene/core/environment.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { sameSceneLight } from '../../../../sdk-core/src/scene/light/equal.ts'
import { boxPointReach } from '../../../../math/src/geometry/boxDistance.ts'
import { srgbToLinear } from '../../../../math/src/color/color.ts'
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts'
import type { Color } from '../../../../sdk-core/src/world/math/color.ts'
import { RASTER_BACKGROUND } from '../../geometry/pages/raster.ts'
import type { ResolvedAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import type { SceneSky } from '../../../../sdk-core/src/scene/core/environmentSky.ts'

/** The light calls of a session (`api/lightApi.ts`) the world writes its lights through. */
type LightApi = {
  addLight(light: SceneLight): void
  setLight(id: string, patch: Partial<Omit<SceneLight, 'id'>>): void
  removeLight(id: string): void
}

const NONE: readonly Object3D[] = []

/** What a sky light reads of its scene: the colour behind it and the atmosphere in it. */
type SkyScene = { background?: Color | null; resolvedAtmosphere?: ResolvedAtmosphere }

/** The background the engine clears to when the scene sets none, linear. */
const DEFAULT_BACKGROUND = (() => {
  const { r, g, b } = clearValueOf(RASTER_BACKGROUND)
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
})()

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
    sky: { atmosphere: false, background: DEFAULT_BACKGROUND.slice() },
    // A world's scene is a `Scene`, which holds the background and the atmosphere a sky light reads.
    scene: scene as Object3D & SkyScene,
    stored: new Map(),
    bounds: new Box3(),
    holders: new Set(),
    below: new Map(),
    shown: new Set(),
    sh: emptyIrradiance(),
    skyBlock: { irradiance: emptyIrradiance(), upper: [0, 0, 0], lower: [0, 0, 0], light: false },
    skyShown: false,
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
    /** The engine captured the atmosphere's radiance (27 coefficients): the sky lights give it
     *  from the next sync, which the caller asks for. */
    skyCaptured(coefficients: ArrayLike<number>) {
      state.sky.captured = Float32Array.from(coefficients)
    },
    /** What the last sync found of the sky, or none: the sky light's irradiance and the radiance it
     *  shows a ray that leaves the scene, or, where the scene has an atmosphere and no sky light,
     *  that atmosphere's own sky (`SceneSky`). Handed to the store, which copies it. */
    sky: () => (state.skyShown ? state.skyBlock : undefined),
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

/** The sky block as a sync fills it: a `SceneSky` whose numbers are written in place. */
type SkyBlock = {
  [K in keyof SceneSky]: SceneSky[K] extends readonly number[] ? number[] : SceneSky[K]
}

/** What a world's lights hold between syncs (`createWorldLights`). */
type LightsState = {
  /** What the sky lights see, refreshed at each sync from the scene and the last capture. */
  sky: SkySource & { captured?: Float32Array }
  scene: Object3D & SkyScene
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
  /** What the sky lights gave at the last sync, apart from `sh` (`SceneSky`), and whether the scene
   *  shows a sky at all. */
  skyBlock: SkyBlock
  skyShown: boolean
  next: number
  boundsStale: boolean
  indexed: boolean
  held: number
  surrounding: boolean
}

/** `reach`'s scratch: the scene's bounds, flat. */
const boundsFlat = new Float64Array(6)

/** How far a lamp the page left unbounded reaches from `at`: the farthest corner of the scene. */
function reach(state: LightsState, at: Vector3) {
  const { bounds } = state
  if (state.boundsStale) bounds.setFromObject(state.scene)
  state.boundsStale = false
  const far = boxPointReach(boxToFlat(bounds, boundsFlat), 0, at.x, at.y, at.z)
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
      if (showing && child.kind === 'sky') addSkyLight(state, child)
      else if (showing && addLightIrradiance(child, state.sh, state.sky)) state.surrounding = true
    }
    visit(state, child, showing)
  }
}

/** A sky light's share of the sky block: its irradiance, apart from the other lights' (the bounce
 *  probes carry it where they answer), and the radiance it shows a ray that leaves the scene. */
function addSkyLight(state: LightsState, light: Light) {
  const { skyBlock, sky } = state
  if (!addLightIrradiance(light, skyBlock.irradiance, sky)) return
  addSkyRadiance(light, sky, skyBlock.upper, skyBlock.lower)
  skyBlock.light = state.skyShown = true
}

function drop(state: LightsState, api: LightApi, light: Light, id: string) {
  api.removeLight(id)
  state.stored.delete(light)
}

/** The sky the lights see, read off the scene: its air, else its background colour in linear. */
function skyOf({ sky, scene }: LightsState) {
  sky.atmosphere = !!scene.resolvedAtmosphere
  const colour = scene.background,
    background = sky.background as number[]
  background[0] = colour ? colour.r : DEFAULT_BACKGROUND[0]
  background[1] = colour ? colour.g : DEFAULT_BACKGROUND[1]
  background[2] = colour ? colour.b : DEFAULT_BACKGROUND[2]
}

/** The sky block empty, before a sync's sky lights fill it. */
function resetSky(state: LightsState) {
  const { skyBlock } = state
  skyBlock.irradiance.fill(0)
  skyBlock.upper.fill(0)
  skyBlock.lower.fill(0)
  skyBlock.light = state.skyShown = false
}

/** A scene with an atmosphere and no sky light shows the atmosphere's own sky, as drawn: a
 *  reflection sees it, and it lights nothing (`SceneSky.light`). */
function settleSky(state: LightsState) {
  if (state.skyShown || !state.sky.atmosphere) return
  state.skyBlock.upper.fill(1)
  state.skyShown = true
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
  skyOf(state)
  resetSky(state)
  state.surrounding = false
  state.held = 0
  visit(state, scene, scene.visible)
  settleSky(state)
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
