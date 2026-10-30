import { length3 } from '../../../../../math/src/vector/vector.ts'
import { boxTransform } from '../../../../../math/src/geometry/box.ts'
import { readShadowSetting } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import {
  holdsOffsetSwitches,
  offsetSwitchEdits,
  offsetSwitchesOf,
} from '../../../../../sdk-core/src/world/object/offsetSwitches.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { shadowResolutionScaleOf } from '../../../../../sdk-core/src/scene/light/fields.ts'
import { rootSource } from '../../../placement/hidden.ts'
import { itemNode } from '../../../blend/items.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import type { ObjectShadowView } from './objectShadowSize.ts'
import type { Bounds, ObjectShadowLight } from './objectShadowSetup.ts'
import {
  objectShadowSubjects,
  type ObjectShadowLightRecord,
  type ObjectShadowSubject,
  type ObjectShadowTableInput,
} from './objectShadowSubjects.ts'
import { OBJECT_SHADOW_DEFAULTS, type ObjectShadowSettings } from './translucentShadowRules.ts'

/**
 * THE FEED OF THE TRANSLUCENT OBJECT SHADOWS: what the scene tells the subjects' table (`objectShadowSubjects`) each image. The objects are
 * the roots whose nodes cast a volumetric translucent shadow (`castVolumetricTranslucentShadow`), found again only when the roots, any
 * node's switches or the blend items moved; their bounds are read from their world each image. The lights are the shadowed ones the shadow plan projects, with
 * the classic maps (`shadowVirtualEnable` off) the only kind that takes these shadows. Lengths are centimetres, the unit the table is written in.
 * A scene with no such object, or the project switch off, costs a compare and holds nothing. The records the table reads are held and
 * refilled each image.
 */

const CM = 100

/** A root that casts a volumetric translucent shadow. */
export interface TranslucentCaster {
  /** The rank of the root in the cut. */
  readonly rank: number
  readonly node: Object3D
  /** The root's local box (min then max), in its node's space. */
  readonly localBox: ArrayLike<number>
}

/** A primitive record and a light record the table reads, held and refilled. */
interface HeldPrimitive {
  id: number
  readonly bounds: {
    origin: [number, number, number]
    extent: [number, number, number]
    radius: number
  }
  hasTranslucent: boolean
}
interface HeldLight {
  id: number
  light: ObjectShadowLight
  castTranslucentShadows: boolean
  resolutionScale: number
  readonly directional: { kind: 'directional'; direction: [number, number, number] }
  readonly local: { kind: 'local'; position: [number, number, number]; radius: number }
}

interface Held {
  roots: unknown
  length: number
  switches: number
  /** The blend items the translucent nodes were read from: the list and its count. */
  blend: unknown
  items: number
  /** The roots whose nodes switch the volumetric translucent shadow on and hold a box, scanned again only when the above moved. */
  candidates: TranslucentCaster[]
  /** The candidates that cast now (`castShadow`, `castsShadowMaps` read each call). */
  casters: TranslucentCaster[]
  /** The nodes that wear a translucent item, for the casters. */
  translucent: Set<Object3D>
  /** The records the table is filled from, the subjects it gives and the view it is sized for, refilled each image. */
  primitives: HeldPrimitive[]
  lights: HeldLight[]
  readonly subjects: ObjectShadowSubject[]
  readonly view: ObjectShadowView & {
    origin: [number, number, number]
    projectionScale: [number, number]
  }
  readonly found: { subjects: ObjectShadowSubject[]; view: ObjectShadowView }
}
const held = new WeakMap<object, Held>()

/** The frame the project switch was read at, by context: it is read once an image. */
const read = new WeakMap<object, { frame: number; on: boolean }>()

/** Whether the project switch is on: the one gate of the whole feature, read once an image. */
export function objectShadowsOn(rt: Pick<WebgpuPagesRuntime, 'context' | 'run'>) {
  const frame = rt.run.frame
  const memo = read.get(rt.context)
  if (memo?.frame === frame) return memo.on
  const on =
    !readShadowSetting(rt, 'shadowVirtualEnable') &&
    readShadowSetting(rt, 'translucentObjectShadows')
  if (memo) {
    memo.frame = frame
    memo.on = on
  } else read.set(rt.context, { frame, on })
  return on
}

/** The settings of the table: the defaults, the project switch from the view and the device's largest texture. */
export function objectShadowSettingsOf(
  rt: Pick<WebgpuPagesRuntime, 'context' | 'run'>,
  maxTextureSide: number,
): ObjectShadowSettings {
  return {
    ...OBJECT_SHADOW_DEFAULTS,
    projectEnabled: objectShadowsOn(rt),
    maxResolution: readShadowSetting(rt, 'shadowMaxCsmResolution'),
    maxBufferSide: maxTextureSide,
  }
}

/** Whether a candidate's node casts into the shadow maps now: the two flags it can be edited by any time. */
const casts = (caster: TranslucentCaster) => caster.node.castShadow && caster.node.castsShadowMaps

/** The state of a runtime, made at its first use. */
function heldOf(rt: WebgpuPagesRuntime): Held {
  let h = held.get(rt)
  if (!h) {
    const subjects: ObjectShadowSubject[] = []
    const view = {
      origin: [0, 0, 0] as [number, number, number],
      screenScale: 0,
      projectionScale: [0, 0] as [number, number],
    }
    held.set(
      rt,
      (h = {
        roots: undefined,
        length: -1,
        switches: -1,
        blend: undefined,
        items: -1,
        candidates: [],
        casters: [],
        translucent: new Set(),
        primitives: [],
        lights: [],
        subjects,
        view,
        found: { subjects, view },
      }),
    )
  }
  return h
}

/**
 * The casters of the cut: the roots whose nodes switch the volumetric translucent shadow on, found again when the roots, any node's
 * switches or the blend items (the list, its count) moved; of those, the ones whose node casts now, chosen each call from the
 * two flags (a compare per candidate) and handed back as the same list while the choice stands.
 */
export function translucentCastersOf(rt: WebgpuPagesRuntime): readonly TranslucentCaster[] {
  const { blendGpu } = rt.blendState
  const h = heldOf(rt)
  const roots = rt.layout.selectionRoots
  const switches = offsetSwitchEdits()
  if (
    h.roots !== roots ||
    h.length !== roots.length ||
    h.switches !== switches ||
    h.blend !== blendGpu ||
    h.items !== blendGpu.length
  ) {
    h.roots = roots
    h.length = roots.length
    h.switches = switches
    h.blend = blendGpu
    h.items = blendGpu.length
    h.candidates = []
    h.casters = []
    h.translucent.clear()
    for (const item of blendGpu) {
      const node = itemNode(item)
      if (node) h.translucent.add(node)
    }
    roots.forEach((root, rank) => {
      const node = rootSource(root)
      const box = root.localBox
      if (!node || !holdsOffsetSwitches(node) || !box || !(box[3]! >= box[0]!)) return
      if (!offsetSwitchesOf(node).castVolumetricTranslucentShadow) return
      h.candidates.push({ rank, node, localBox: box })
    })
  }
  // The held list stands while the candidates that cast are exactly its, in order.
  let at = 0
  let same = true
  for (const candidate of h.candidates)
    if (casts(candidate)) {
      if (h.casters[at] !== candidate) same = false
      at++
    }
  if (!same || at !== h.casters.length) h.casters = h.candidates.filter(casts)
  return h.casters
}

/** The box of a caster's local box under its world, held. */
const worldBox = new Float64Array(6)

/** The world bounds of a caster in centimetres into `into`: the box of its local box under its node's world, and the sphere round it. */
export function casterBounds(
  caster: TranslucentCaster,
  into: { origin: [number, number, number]; extent: [number, number, number]; radius: number },
): Bounds {
  boxTransform(worldBox, 0, caster.localBox, 0, caster.node.matrixWorld.elements)
  for (let a = 0; a < 3; a++) {
    into.origin[a] = ((worldBox[a]! + worldBox[3 + a]!) / 2) * CM
    into.extent[a] = ((worldBox[3 + a]! - worldBox[a]!) / 2) * CM
  }
  into.radius = length3(...into.extent)
  return into
}

/** The view the shadows are sized for, from the image's camera: where it stands and how large a radius looks at a distance of one. */
export function objectShadowViewOf(
  cam: Pick<EngineCamera, 'world' | 'projection'>,
  viewport: readonly [number, number],
  into: {
    origin: [number, number, number]
    screenScale: number
    projectionScale: [number, number]
  } = { origin: [0, 0, 0], screenScale: 0, projectionScale: [0, 0] },
) {
  const sx = cam.projection[0]!
  const sy = cam.projection[5]!
  into.origin[0] = cam.world[12]! * CM
  into.origin[1] = cam.world[13]! * CM
  into.origin[2] = cam.world[14]! * CM
  into.screenScale = Math.max(0.5 * viewport[0] * sx, 0.5 * viewport[1] * sy)
  into.projectionScale[0] = sx
  into.projectionScale[1] = sy
  return into
}

const createHeldLight = (): HeldLight => ({
  id: 0,
  light: undefined as never,
  castTranslucentShadows: true,
  resolutionScale: 1,
  directional: { kind: 'directional', direction: [0, -1, 0] },
  local: { kind: 'local', position: [0, 0, 0], radius: 0 },
})

/** One light the shadow plan projects, as the table reads it, into `into` where one is held. `mapId` is the light's id in the plan (`VsmProjectionLight.mapId`). */
export function objectShadowLightRecord(
  light: SceneLight,
  mapId: number,
  into: HeldLight = createHeldLight(),
): ObjectShadowLightRecord {
  into.id = mapId
  into.castTranslucentShadows = light.castTranslucentShadows !== false
  into.resolutionScale = shadowResolutionScaleOf(light)
  if (light.kind === 'directional') {
    const d = light.direction ?? [0, -1, 0]
    into.directional.direction[0] = d[0]
    into.directional.direction[1] = d[1]
    into.directional.direction[2] = d[2]
    into.light = into.directional
  } else {
    const p = light.position!
    into.local.position[0] = p[0]! * CM
    into.local.position[1] = p[1]! * CM
    into.local.position[2] = p[2]! * CM
    into.local.radius = light.range! * CM
    into.light = into.local
  }
  return into
}

/** A light the plan projects: its scene record and its id in the plan. */
interface ProjectedLightInput {
  readonly light: SceneLight
  readonly mapId: number
}

/**
 * The translucent object shadows of a view for this image: none unless the project switch is on and a caster draws a translucent surface (the shadow of an object
 * outside the camera's view is kept, as it may be seen next image). The subjects and the view are held and refilled by the next call: read them before it.
 */
export function objectShadowSubjectsOf(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  lights: readonly ProjectedLightInput[],
  maxTextureSide: number,
): { subjects: ObjectShadowSubject[]; view: ObjectShadowView } | undefined {
  if (!objectShadowsOn(rt) || !lights.length) return undefined
  const all = translucentCastersOf(rt)
  if (!all.length) return undefined
  const h = heldOf(rt)
  while (h.primitives.length < all.length)
    h.primitives.push({
      id: 0,
      bounds: { origin: [0, 0, 0], extent: [0, 0, 0], radius: 0 },
      hasTranslucent: false,
    })
  h.primitives.length = all.length
  for (let place = 0; place < all.length; place++) {
    const caster = all[place]!
    const primitive = h.primitives[place]!
    primitive.id = caster.rank
    casterBounds(caster, primitive.bounds)
    primitive.hasTranslucent = h.translucent.has(caster.node)
  }
  while (h.lights.length < lights.length) h.lights.push(createHeldLight())
  h.lights.length = lights.length
  for (let k = 0; k < lights.length; k++)
    objectShadowLightRecord(lights[k]!.light, lights[k]!.mapId, h.lights[k])
  const input: ObjectShadowTableInput = {
    settings: objectShadowSettingsOf(rt, maxTextureSide),
    view: objectShadowViewOf(cam, rt.gpu.targetSize, h.view),
  }
  objectShadowSubjects(input, h.lights, h.primitives, h.subjects)
  return h.subjects.length ? h.found : undefined
}
