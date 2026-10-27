/**
 * WHICH LIGHTS A PERSPECTIVE VIEW DRAWS, the part that belongs to the view (the part that belongs to the light, and the rule
 * itself, `inDrawRange`, are in `sdk-core/src/scene/light/drawRange.ts`): a point, spot or rectangle light is drawn while
 *
 *   (min(0.02, lightMinScreenRadius / W) * factor * d)^2 < 1
 *
 * and, if it names a `maxDrawDistance` above 0, while `d < maxDrawDistance * lightMaxDrawDistanceScale`, `d` the distance from the
 * eye to the centre of the light's bounding sphere, `W` its radius. The share and the greatest distance are the store's draw lanes (`SceneLightStore.draw`);
 * `factor` is the view's: its horizontal field of view in degrees over 90 where the setting `lightDrawRangeFollowsFieldOfView` is on,
 * else 1. An orthographic view draws every light, and so does any view a directional light.
 *
 * The decision is made once for each light and each view, here, on the CPU: `drawLights` writes it into the kind word of every
 * light (`LIGHT_UNDRAWN_SHIFT`) and sends the words that changed, and every pass that walks the lights of a view reads that bit —
 * the light grid's lists leave the light out, the all-lights walk skips it (`lightUndrawn`) — while the shadows' plan asks
 * `lightDrawn` itself.
 */
import {
  DRAW_FARTHEST,
  DRAW_LANES,
  DRAW_SHARE,
  LIGHT_FIELD,
  baseOf,
} from '../../../sdk-core/src/scene/light/fields.ts'
import { LIGHT_KIND, SCENE_LIGHT_FLOATS } from '../../../sdk-core/src/scene/light/contracts.ts'
import { coneSphereAlong, inDrawRange } from '../../../sdk-core/src/scene/light/drawRange.ts'
import type { SceneLightStore } from '../../../sdk-core/src/scene/light/store.ts'
import { createChangedRuns } from '../geometry/residency/ranges.ts'
import { LIGHT_BUFFER_AT } from '../frame/backend/state/lightBufferLayout.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { horizontalFieldOfView } from '../frame/render/drawDistanceView.ts'

/** The field of view a factor of 1 is: the reference camera's default, in degrees. */
const DEFAULT_FIELD_OF_VIEW = 90

/** The view's setting of its draw range (`ShadowValues`). */
export interface LightDrawSettings {
  lightDrawRangeFollowsFieldOfView: boolean
}

/** A perspective view: its eye in world metres, its factor on the draw range and the lights it is asked of. An orthographic view has
 *  none: it draws every light. */
export interface LightDrawView {
  eye: ArrayLike<number>
  factor: number
  lights: Pick<SceneLightStore, 'packed' | 'draw' | 'kindOf'>
}

/** The draw view of `cam` for the lights of `lights` under `settings`: its horizontal field of view in degrees over
 *  `DEFAULT_FIELD_OF_VIEW` for the factor, or 1 where the setting is off; none for an orthographic one, which draws every light. */
export const lightDrawViewOf = (
  cam: Pick<EngineCamera, 'eye' | 'perspective' | 'fov' | 'aspect'>,
  lights: LightDrawView['lights'],
  settings: LightDrawSettings,
): LightDrawView | undefined =>
  cam.perspective === 1
    ? {
        eye: cam.eye,
        factor: settings.lightDrawRangeFollowsFieldOfView
          ? horizontalFieldOfView(cam) / DEFAULT_FIELD_OF_VIEW
          : 1,
        lights,
      }
    : undefined

/** Whether the view `view` (none: an orthographic one) draws the light of slot `slot`, by the lanes of its record: the one rule
 *  of the lights' draw range, `inDrawRange`, on the squared distance from the eye to the centre of the light's bounding sphere —
 *  its position, a spot's the centre of the sphere that holds its cone. */
export function lightDrawn(slot: number, view?: LightDrawView) {
  if (!view) return true
  const { packed, draw } = view.lights
  const base = baseOf(slot)
  const at = base + LIGHT_FIELD.position
  let x = packed[at],
    y = packed[at + 1],
    z = packed[at + 2]
  if (view.lights.kindOf(slot) === LIGHT_KIND.spot) {
    const along = coneSphereAlong(
      packed[base + LIGHT_FIELD.range],
      packed[base + LIGHT_FIELD.cosCone],
    )
    const axis = base + LIGHT_FIELD.direction
    x += packed[axis] * along
    y += packed[axis + 1] * along
    z += packed[axis + 2] * along
  }
  const dx = x - view.eye[0],
    dy = y - view.eye[1],
    dz = z - view.eye[2]
  return inDrawRange(
    dx * dx + dy * dy + dz * dz,
    draw[slot * DRAW_LANES + DRAW_SHARE],
    draw[slot * DRAW_LANES + DRAW_FARTHEST],
    view.factor,
  )
}

/** What the decision was last made for: the view's eye and factor, the light table's epoch and count; and the slots whose word
 *  changed since it was sent, each once (`createChangedRuns`). */
export interface DrawnLights {
  readonly changed: ReturnType<typeof createChangedRuns>
  eye: [number, number, number]
  factor: number
  epoch: number
  count: number
}

export const createDrawnLights = (): DrawnLights => ({
  changed: createChangedRuns(SCENE_LIGHT_FLOATS),
  eye: [NaN, NaN, NaN],
  factor: NaN,
  epoch: -1,
  count: -1,
})

/**
 * The view's decision, written into the light table: for every light, whether `view` (none: an orthographic one) draws it
 * (`lightDrawn`), in the bit of its kind word that says it does not (`SceneLightStore.assignDrawn`). Made again only when the
 * view's eye or factor moved or the lights changed. The records of the lights whose bit changed then go up to `buffer`, the
 * runs of neighbours as one write, the rest of the buffer untouched; with no buffer yet the table alone holds them, and its first upload
 * carries them. Whether the decision was made.
 */
export function drawLights(
  device: GPUDevice,
  buffer: GPUBuffer | undefined,
  store: SceneLightStore,
  state: DrawnLights,
  view?: LightDrawView,
) {
  const eye = view?.eye ?? NO_EYE,
    factor = view?.factor ?? 0,
    { count } = store
  if (
    state.epoch === store.epoch &&
    state.count === count &&
    state.factor === factor &&
    state.eye[0] === eye[0] &&
    state.eye[1] === eye[1] &&
    state.eye[2] === eye[2]
  )
    return false
  state.epoch = store.epoch
  state.count = count
  state.factor = factor
  state.eye[0] = eye[0]
  state.eye[1] = eye[1]
  state.eye[2] = eye[2]
  for (let slot = 0; slot < count; slot++)
    if (store.assignDrawn(slot, lightDrawn(slot, view))) state.changed.mark(slot)
  if (buffer) sendDrawn(device, buffer, store, state.changed)
  else state.changed.clear()
  return true
}

/** The eye of a view with none: the factor 0 ignores it. */
const NO_EYE = [0, 0, 0]

/** The records of the slots `changed` lists, as the table holds them, up to `buffer`: a run of neighbours in one write. */
function sendDrawn(
  device: GPUDevice,
  buffer: GPUBuffer,
  store: SceneLightStore,
  changed: DrawnLights['changed'],
) {
  const { count, pairs } = changed.runs()
  for (let run = 0; run < count; run++) {
    const first = pairs[2 * run],
      last = pairs[2 * run + 1]
    device.queue.writeBuffer(
      buffer,
      LIGHT_BUFFER_AT.items + first * SCENE_LIGHT_FLOATS * 4,
      store.packed,
      baseOf(first),
      (last - first + 1) * SCENE_LIGHT_FLOATS,
    )
  }
  changed.clear()
}
