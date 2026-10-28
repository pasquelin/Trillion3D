import { CONTACT_SHADOW_VIEW_RULES } from '../../../../sdk-core/src/contracts/contactShadowOptions.ts'
import { resolveSettingsStamped } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  NO_CONTACT_SHADOW_VIEW,
  type ContactShadowView,
} from '../../../../sdk-core/src/scene/light/contactShadowView.ts'
import { chainReady } from '../../lighting/deferred/fullscreen.ts'
import { FLAGS_VIEW } from '../../materials/surface/surfaceOutputs.ts'
import {
  bendSettingsOf,
  bendStages,
  encodeBendContactShadow,
} from '../../lighting/contactShadow/bendPass.ts'
import { BEND_MAX_LAYERS } from '../../lighting/contactShadow/bendDispatches.ts'
import {
  bendTargetFor,
  clearBendTarget,
  dropBendTarget,
  writeBendRanks,
} from '../../lighting/contactShadow/bendTarget.ts'
import {
  castsContactShadow,
  writeContactShadow,
} from '../../../../sdk-core/src/scene/light/contactShadowView.ts'
import { contactShadowOfLight } from '../../../../sdk-core/src/scene/light/lightContactShadow.ts'
import { NO_LIGHT_SHADOW_VIEW } from '../../../../sdk-core/src/scene/light/shadowedBits.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

const contactView: ContactShadowView = { ...NO_CONTACT_SHADOW_VIEW }
const shadowView = { ...NO_LIGHT_SHADOW_VIEW, dynamicShadows: true }
const intensities = new Float32Array(3)

/** A point's clip position without the divide by w: `viewProjection` (column-major) times `(x, y, z, w)`. */
function clipOf(m: ArrayLike<number>, x: number, y: number, z: number, w: number) {
  return [0, 1, 2, 3].map((k) => m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k] * w) as [
    number,
    number,
    number,
    number,
  ]
}

/** A light the image marches: the clip position its march starts from (a sun's as a direction, w 0; a local light's as a point, w 1), its rank
 *  in the light buffer and the pixels its light can reach. */
interface Marched {
  id: string
  rank: number
  projection: [number, number, number, number]
  min: [number, number]
  max: [number, number]
}

/** The pixels a local light of the sphere (`position`, `range`) can reach: the box of its sphere's corners on the screen, the whole screen where a corner is
 *  at or behind the eye's plane; none (undefined) where the box is off the screen. */
function reachOf(
  m: ArrayLike<number>,
  position: ArrayLike<number>,
  range: number,
  width: number,
  height: number,
): Pick<Marched, 'min' | 'max'> | undefined {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let corner = 0; corner < 8; corner++) {
    const clip = clipOf(
      m,
      position[0] + (corner & 1 ? range : -range),
      position[1] + (corner & 2 ? range : -range),
      position[2] + (corner & 4 ? range : -range),
      1,
    )
    if (clip[3] <= 0) return { min: [0, 0], max: [width - 1, height - 1] }
    x0 = Math.min(x0, (0.5 + 0.5 * (clip[0] / clip[3])) * width)
    x1 = Math.max(x1, (0.5 + 0.5 * (clip[0] / clip[3])) * width)
    y0 = Math.min(y0, (0.5 - 0.5 * (clip[1] / clip[3])) * height)
    y1 = Math.max(y1, (0.5 - 0.5 * (clip[1] / clip[3])) * height)
  }
  const min: [number, number] = [Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0))]
  const max: [number, number] = [
    Math.min(width - 1, Math.ceil(x1)),
    Math.min(height - 1, Math.ceil(y1)),
  ]
  return min[0] > max[0] || min[1] > max[1] ? undefined : { min, max }
}

/** The lights the image marches, the suns first then the local lights nearest the eye, `BEND_MAX_LAYERS` at most. */
function marchedLights(
  plan: NonNullable<NonNullable<NonNullable<WebgpuPagesRuntime['lights']>['vsm']>['plan']>,
  store: NonNullable<WebgpuPagesRuntime['lights']>['store'],
  cam: EngineCamera,
  width: number,
  height: number,
): Marched[] {
  const suns: Marched[] = []
  const locals: (Marched & { distance: number })[] = []
  const full: Pick<Marched, 'min' | 'max'> = { min: [0, 0], max: [width - 1, height - 1] }
  for (const lane of plan.projected) {
    const sun = lane.clipmap?.light
    const light = store.light(sun?.id ?? lane.id)
    if (!light || !castsContactShadow(light, contactView, shadowView)) continue
    const rank = store.slotOf(light.id)
    if (rank < 0) continue
    if (sun) {
      const x = sun.direction[0] ?? 0,
        y = sun.direction[1] ?? 0,
        z = sun.direction[2] ?? 0
      suns.push({
        id: light.id,
        rank,
        projection: clipOf(cam.viewProjection, -x, -y, -z, 0),
        ...full,
      })
    } else if (lane.kind !== 'directional' && light.position && light.range) {
      const reach = reachOf(cam.viewProjection, light.position, light.range, width, height)
      if (!reach) continue
      const [x, y, z] = light.position
      locals.push({
        id: light.id,
        rank,
        projection: clipOf(cam.viewProjection, x, y, z, 1),
        ...reach,
        distance: Math.hypot(x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]),
      })
    }
  }
  locals.sort((a, b) => a.distance - b.distance)
  return [...suns, ...locals].slice(
    0,
    Math.min(contactView.contactShadowBendMaxLights, BEND_MAX_LAYERS),
  )
}

/** What every layer's march shares: the depth and flags the image was drawn with, its size and the settings. */
interface BendShared {
  depth: GPUTextureView
  flags: GPUTextureView
  width: number
  height: number
  settings: ReturnType<typeof bendSettingsOf>
}

/** One light's march into its layer; false where it is not marched (its pixels stay lit, as the layer was cleared to 1). */
function marchLayer(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  store: NonNullable<WebgpuPagesRuntime['lights']>['store'],
  output: GPUTextureView | undefined,
  { id, projection, min, max }: Marched,
  { depth, flags, width, height, settings }: BendShared,
) {
  const light = store.light(id)
  // A light with no layer or no longer in the store is not marched.
  if (!output || !light) return false
  writeContactShadow(intensities, 0, contactShadowOfLight(light), contactView)
  return encodeBendContactShadow(device, encoder, {
    depth,
    flags,
    output,
    size: [width, height],
    projection,
    casting: intensities[1],
    nonCasting: intensities[2],
    min,
    max,
    viewToClip: cam.projection,
    perspective: cam.perspective > 0.5,
    settings,
  })
}

/**
 * THE SCREEN-SPACE CONTACT SHADOWS OF THE LIGHTS (`contactShadowMethod` 1), marched for each light that casts a contact shadow of its own (the suns first, then the local
 * lights nearest the eye, `BEND_MAX_LAYERS` in all) into a layer of the image's array (`bendTarget.ts`), over the depth the image was drawn with and before the
 * lighting reads it: a light's term takes its layer at the pixel in place of the stochastic ray (`contactBendWgsl`), found by the light's rank in
 * the ranks the array comes with. A sun starts its march from its direction (w 0), a local light from its position (w 1) and over the pixels its sphere reaches. The kernels
 * are waited for like the other stages of the pre-light step (`bendStages`). An image that marches none gives the array up. Returns the marches encoded.
 */
export function encodeBendContactShadows(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  // No context: every setting is its default, the method 0.
  if (!rt.context) return 0
  resolveSettingsStamped(CONTACT_SHADOW_VIEW_RULES, rt.context, contactView)
  const { gpu } = rt
  const store = rt.lights?.store
  const flags = gpu?.surfaces?.views()[FLAGS_VIEW]
  const plan = rt.lights?.vsm?.plan
  if (
    contactView.contactShadowMethod !== 1 ||
    !store ||
    !plan ||
    !gpu.depthView ||
    !flags ||
    !gpu.deferred
  ) {
    dropBendTarget(rt, device)
    return 0
  }
  if (!chainReady(...bendStages(device))) {
    // A shadow of an earlier image would be served stale while the kernels compile.
    dropBendTarget(rt, device)
    return 0
  }
  const [width, height] = gpu.targetSize
  const settings = bendSettingsOf(contactView)
  const marching = marchedLights(plan, store, cam, width, height)
  if (!marching.length) {
    dropBendTarget(rt, device)
    return 0
  }
  const target = bendTargetFor(rt, device, width, height, marching.length)
  clearBendTarget(encoder, target)
  writeBendRanks(
    device,
    target,
    marching.map((m) => m.rank),
  )
  // Held in a constant: the narrowing of `gpu.depthView` does not reach into the closure below.
  const depth = gpu.depthView
  if (!depth) return 0
  let count = 0
  marching.forEach((m, layer) => {
    if (
      marchLayer(device, encoder, cam, store, target.layers[layer], m, {
        depth,
        flags,
        width,
        height,
        settings,
      })
    )
      count++
  })
  return count
}
