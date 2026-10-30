import { normalizeVector3OrZero } from '../../../../../math/src/vector/vector.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { foldsProfiles } from '../../../gpu/core/objectShadowRead.ts'
import { viewKey } from '../../../frame/backend/state/viewKey.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import {
  objectShadowAtlasesOf,
  releaseObjectShadowAtlases,
  type ObjectShadowAtlases,
} from './objectShadowAtlas.ts'
import { objectShadowSettingsOf, objectShadowSubjectsOf } from './objectShadowFeed.ts'
import { releaseObjectShadowDraw } from '../../../blend/objectShadow/objectShadowDraw.ts'
import {
  createObjectShadowProjector,
  releaseObjectShadowProjector,
  type ObjectShadowProjector,
} from './objectShadowProject.ts'
import { translucentAtlasSide } from './objectShadowSize.ts'
import type { ObjectShadowSettings } from './translucentShadowRules.ts'
import type { ObjectShadowSubject } from './objectShadowSubjects.ts'

/**
 * THE TRANSLUCENT OBJECT SHADOWS OF AN IMAGE: for the lights the shadow plan projects, the subjects the scene gives (`objectShadowSubjectsOf`), their
 * atlases (`objectShadowAtlasesOf`), and the projection that reads them back into the lights' masks (`createObjectShadowProjector`). The image's frame
 * replaces the last one's, whose buffers are retired. With the project switch off, or no subject, nothing is made and nothing is held. The frame record,
 * the suns' entries and the projector belong to the view and are refilled each image.
 */

export interface ObjectShadowFrame {
  readonly projector: ObjectShadowProjector
  readonly atlases: ObjectShadowAtlases
  readonly subjects: readonly ObjectShadowSubject[]
  /** The suns of the frame by the light's id in the plan (`ObjectShadowSubject.lightId`): the rank of its record in the projection, which is also the layer of the suns' mask it is read from and
   *  what its shadow slice names (`shadowSliceOf`), and the direction it shines in. The translucent surfaces read their own shadow from the sun's subject (`blend/objectShadow/objectShadowSelf.ts`). */
  readonly suns: ReadonlyMap<
    number,
    {
      readonly rank: number
      /** The sun's place in the lights buffer the programs walk (`LightStore.slotOf`), which the translucent surfaces read its colour from. */
      readonly slot: number
      readonly direction: readonly [number, number, number]
    }
  >
  /** Whether the depth pass filled this image's atlases (`encodeObjectShadowDepths`): the projections read nothing before, as the atlases then hold a past image's. */
  drawn: boolean
  /** The settings the subjects were sized by, which the hold compares (`objectShadowHoldKey`). */
  readonly settings?: ObjectShadowSettings
  /** What the hold compares the frame to: the last tuple it held and the count of the times it changed, kept by the view. */
  readonly hold: ObjectShadowHold
}

/** The tuple of values a frame's masks are made of and how many times it moved (`objectShadowHoldKey`). */
export interface ObjectShadowHold {
  readonly tuple: number[]
  epoch: number
}

/** What a view keeps of its frame from one image to the next. */
interface Kept {
  frame: { -readonly [K in keyof ObjectShadowFrame]: ObjectShadowFrame[K] } | undefined
  readonly suns: Map<number, { rank: number; slot: number; direction: [number, number, number] }>
  readonly entries: { rank: number; slot: number; direction: [number, number, number] }[]
}
const kept = new WeakMap<object, Kept>()

/** Lets go of the view's frame, atlases and projection buffers (retired: the image's commands may still name them). */
export function releaseObjectShadows(gpu: { viewKey?: object }) {
  kept.delete(viewKey(gpu))
  releaseObjectShadowAtlases(gpu)
  releaseObjectShadowProjector(viewKey(gpu))
}

/** A light the plan projects: its scene record and its id in the plan. */
export interface ProjectedLight {
  readonly light: SceneLight
  readonly mapId: number
}

/**
 * The frame of this image, or none: made from the lights the plan projects. `depth` is the image's depth pyramid (the projection reads its level 0).
 * `on` is whether the project switch is on, read once for the image by the caller (`objectShadowsOn`).
 */
export function objectShadowFrameOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  lights: readonly ProjectedLight[],
  depth: Parameters<typeof createObjectShadowProjector>[0]['depth'] | undefined,
  on: boolean,
): ObjectShadowFrame | undefined {
  const key = viewKey(rt.gpu)
  // The project switch off lets go of the view's atlases and buffers and of the depth pass's; the table of the light profiles stays while the programs in place read them from it.
  if (!on) {
    releaseObjectShadows(rt.gpu)
    releaseObjectShadowDraw(rt, foldsProfiles(rt.vis.blendPipelines?.objectShadowRead))
    return undefined
  }
  if (!depth) {
    releaseObjectShadowAtlases(rt.gpu)
    return undefined
  }
  const side = device.limits.maxTextureDimension2D
  const found = objectShadowSubjectsOf(rt, cam, lights, side)
  const settings = objectShadowSettingsOf(rt, side)
  const atlases = found
    ? objectShadowAtlasesOf(rt, device, found.subjects, translucentAtlasSide(settings))
    : undefined
  if (!found || !atlases) {
    releaseObjectShadowAtlases(rt.gpu)
    return undefined
  }
  let keep = kept.get(key)
  if (!keep) kept.set(key, (keep = { frame: undefined, suns: new Map(), entries: [] }))
  // The suns by their light's id, their entries held.
  const { suns, entries } = keep
  suns.clear()
  let sunCount = 0
  lights.forEach(({ light, mapId }, rank) => {
    if (light.kind !== 'directional') return
    const d = light.direction ?? [0, -1, 0]
    const entry = (entries[sunCount] ??= { rank: 0, slot: 0, direction: [0, 0, 0] })
    sunCount++
    entry.rank = rank
    entry.slot = rt.lights.store.slotOf(light.id)
    normalizeVector3OrZero(entry.direction, d, Number.MIN_VALUE)
    suns.set(mapId, entry)
  })
  const projector = createObjectShadowProjector({
    key,
    device,
    image: {
      view: rt.gpu.targetSize,
      projection: cam.projection,
      world: cam.world,
      perspective: cam.perspective > 0.5,
      near: cam.near,
      far: cam.far,
    },
    depth,
    atlases: atlases.atlases,
    subjects: found.subjects,
    slots: atlases.slots,
    suns,
    eye: found.view.origin,
    atlasSide: atlases.atlases[0]!.side,
  })
  const frame = (keep.frame ??= {
    projector,
    atlases,
    subjects: found.subjects,
    suns,
    drawn: false,
    settings,
    hold: { tuple: [], epoch: 0 },
  })
  frame.settings = settings
  frame.projector = projector
  frame.atlases = atlases
  frame.subjects = found.subjects
  frame.drawn = false
  return frame
}

/**
 * The key the held projection of the masks compares for this frame (`vsmProjectionHold.ts`): the count of the times the frame's tuple moved, which is compared whole
 * (value by value, against the last one held, never reduced to a hash that can meet another's): whether the depth pass drew the atlases, the settings the subjects
 * were sized by, and for each subject its light, caster, place, fade, size, border, light frame and depth terms, and the slot it was given (atlas, corner) with
 * the atlas's side. The casters' and lights' transforms, the materials and the camera also move the projection's own revisions (scene, view), which the hold compares too.
 */
export function objectShadowHoldKey(frame: ObjectShadowFrame) {
  const { tuple } = frame.hold
  let n = 0
  let moved = false
  walkHold(frame, frame.drawn, (value) => {
    if (tuple[n] !== value) {
      tuple[n] = value
      moved = true
    }
    n++
  })
  if (tuple.length !== n) {
    tuple.length = n
    moved = true
  }
  if (moved) frame.hold.epoch++
  return frame.hold.epoch
}

/**
 * Whether the tuple the hold last kept is the one this frame has with its atlases drawn, asked without touching the hold (the epoch is not moved, nothing is written): the depth pass
 * that skips its redraw asks it before it knows whether it draws, so the one `objectShadowHoldKey` of the image is the projection's, taken once the draw is decided.
 */
export function objectShadowHeldDrawn(frame: ObjectShadowFrame) {
  const { tuple } = frame.hold
  let n = 0
  let same = true
  walkHold(frame, true, (value) => {
    if (tuple[n] !== value) same = false
    n++
  })
  return same && tuple.length === n
}

/** The values of the frame's tuple, in order, given to `put` (the frame counted drawn or not as `drawn` says). */
function walkHold(frame: ObjectShadowFrame, drawn: boolean, put: (value: number) => void) {
  put(drawn ? 1 : 2)
  put(frame.subjects.length)
  const settings = frame.settings
  if (settings) for (const name in settings) put(Number(settings[name as keyof typeof settings]))
  frame.subjects.forEach((subject, k) => {
    const p = subject.projection
    put(subject.lightId)
    put(subject.primitiveId)
    put(subject.place)
    put(subject.fade)
    put(p.resolutionX)
    put(p.resolutionY)
    put(p.border)
    put(p.maxScreenPercent)
    put(p.invMaxSubjectDepth)
    put(p.fadeStart)
    put(p.invFadeLength)
    put(p.minSubjectZ)
    put(p.maxSubjectZ)
    put(p.directional ? 1 : 0)
    for (let i = 0; i < 16; i++) put(p.translatedWorldToClipInner[i]!)
    for (let i = 0; i < 3; i++) put(p.preShadowTranslation[i]!)
    const slot = frame.atlases.slots[k]
    put(slot ? slot.atlas : -1)
    put(slot ? slot.x : -1)
    put(slot ? slot.y : -1)
    put(slot ? frame.atlases.atlases[slot.atlas]!.side : 0)
  })
}
