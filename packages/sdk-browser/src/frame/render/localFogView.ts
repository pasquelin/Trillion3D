import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { LIGHT_FIELD, baseOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { sameRange } from '../../../../math/src/matrix/matrixElements.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import {
  LOCAL_FOG_FLOATS,
  LOCAL_FOG_INSTANCE,
  LOCAL_FOG_SLOT,
} from '../../lighting/fog/localLayout.ts'
import {
  planLocalFog,
  type LocalFogPlanSettings,
  type LocalFogSun,
  type LocalFogView,
} from '../../lighting/fog/localPlan.ts'
import type { LocalFogTiling } from '../../lighting/fog/localTiling.ts'
import { viewProj } from '../backend/helpers.ts'
import { LIGHT_BUFFER_AT } from '../backend/state/lightBufferLayout.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The block this image writes (`LOCAL_FOG_FLOATS`), rewritten in place. */
const block = new Float32Array(LOCAL_FOG_FLOATS)

/** The view it is planned for, rewritten in place: where nothing is planned yet, no eye, no matrix. */
const view: LocalFogView = {
  eye: new Float64Array(3),
  viewProj: new Float64Array(16),
  near: 0,
  size: [0, 0],
}

/** The words before the sky's rows — the header, the sun and the view — and the words of the volumes. */
const HEAD_FLOATS = LOCAL_FOG_SLOT.sky * 4
const FIRST_INSTANCE = LOCAL_FOG_SLOT.instances * 4

/** What the block last written into each light buffer held: the header, the sun and the view, the volumes'
 *  own words, and how many volumes it drew. An image whose block is the same writes nothing, and a
 *  buffer not in it holds zeros, as it was made. */
interface Published {
  head: Float32Array
  instances: Float32Array
  count: number
}
const published = new WeakMap<GPUBuffer, Published>()
const newPublished = (): Published => ({
  head: new Float32Array(HEAD_FLOATS),
  instances: new Float32Array(LOCAL_FOG_FLOATS - FIRST_INSTANCE),
  count: 0,
})

/** The sun's light and the direction toward it, rewritten in place by `localFogSunOf`. */
const sun: LocalFogSun & { light: Float64Array; toward: Float64Array } = {
  light: new Float64Array(3),
  toward: new Float64Array(3),
}

/**
 * The directional light the local fog volumes are lit by: the one the forward readers take
 * (`SceneLightStore.forwardDirectionalSlot`), its colour times its strength, through the air toward it
 * where it is the air's sun (the transmittance the atmosphere's block holds), and the unit direction
 * toward it; none where the store holds no directional light.
 */
function localFogSunOf(
  store: Pick<SceneLightStore, 'forwardDirectionalSlot' | 'packed' | 'atmospherePacked'>,
): LocalFogSun | undefined {
  const slot = store.forwardDirectionalSlot
  if (slot < 0) return undefined
  const at = baseOf(slot)
  const { packed } = store
  const strength = packed[at + LIGHT_FIELD.intensity]
  const air = store.atmospherePacked
  const aired =
    air[ATMOSPHERE_SLOT.planet * 4] !== 0 && air[ATMOSPHERE_SLOT.lightSlots * 4] === slot
  for (let c = 0; c < 3; c++) {
    sun.light[c] =
      packed[at + LIGHT_FIELD.color + c] *
      strength *
      (aired ? air[ATMOSPHERE_SLOT.sunTransmittance * 4 + c] : 1)
    sun.toward[c] = -packed[at + LIGHT_FIELD.direction + c]
  }
  const length = length3(sun.toward[0], sun.toward[1], sun.toward[2]) || 1
  for (let c = 0; c < 3; c++) sun.toward[c] /= length
  return sun
}

/**
 * The local fog volumes of this view written into the light buffer (`LIGHT_BUFFER_AT.localFog`), where
 * the programs that lay the fog over a point and the volume's cells read them: the volumes of the scene
 * (`SceneLocalFogStore`) as the plan draws them from this camera (`planLocalFog`), under `settings` — the
 * run's — and the `tiling` the culling pass lists them by, none where `settings` are none: the run
 * draws none, the fog is off or the view paints no lit image. Written once it differs from what the
 * buffer holds. Returns how many volumes it drew.
 */
export function publishLocalFog(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  buffer: GPUBuffer,
  cam: EngineCamera,
  settings?: LocalFogPlanSettings,
  tiling?: LocalFogTiling,
) {
  const last = published.get(buffer)
  let count = 0
  if (settings) {
    view.eye = cam.eye
    view.viewProj = viewProj
    view.near = cam.near
    view.size = rt.gpu.targetSize
    count = planLocalFog(
      block,
      rt.context.sceneLocalFog!.values,
      view,
      localFogSunOf(rt.lights.store),
      settings,
      tiling,
    )
  } else block.fill(0, 0, HEAD_FLOATS)
  const kept = last ?? newPublished()
  const length = count * LOCAL_FOG_INSTANCE.slots * 4
  if (!last || !sameRange(kept.head, block, HEAD_FLOATS))
    device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.localFog, block, 0, HEAD_FLOATS)
  if (
    count &&
    (!last || kept.count !== count || !sameRange(kept.instances, block, length, 0, FIRST_INSTANCE))
  )
    device.queue.writeBuffer(
      buffer,
      LIGHT_BUFFER_AT.localFog + FIRST_INSTANCE * 4,
      block,
      FIRST_INSTANCE,
      length,
    )
  kept.head.set(block.subarray(0, HEAD_FLOATS))
  kept.instances.set(block.subarray(FIRST_INSTANCE, FIRST_INSTANCE + length))
  kept.count = count
  published.set(buffer, kept)
  return count
}
