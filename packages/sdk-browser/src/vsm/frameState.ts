/**
 * WHAT A FRAME SET'S PLAN HOLDS FROM FRAME TO FRAME (`frameSetup.ts`): its cache, its upload images,
 * the id allocator, and each light's shape as last seen, which tells the cache which lights moved.
 */
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import { VSM_PROJECTION_RECORD_BYTES, VSM_UNIFORMS_BYTES } from './constants.ts'
import type { VsmResources } from './resources.ts'
import {
  VsmCacheManager,
  advanceLightMobility,
  newLightMobility,
  type LightMobility,
} from './cacheManager.ts'
import { VSM_NEXT_MAP_BYTES, VsmMapIds } from './mapIds.ts'
import type { VsmFrameLight } from './frameSetup.ts'

export interface VsmFrameState {
  device: GPUDevice
  resources: VsmResources
  cache: VsmCacheManager
  /** The scene frame number: bumped by every plan. */
  frameStamp: number
  /** CPU images of the uploads. */
  projectionImage: ArrayBuffer
  /** Holds the records of the ids `nextMapsHeld` lists (the last frame's), zero elsewhere. */
  nextMapsImage: ArrayBuffer
  nextMapsHeld: number[]
  nextMapsHeldCount: number
  uniformsImage: ArrayBuffer
  /** Last seen shape of each light, for the mobility factor. */
  lightShapes: Map<string, VsmLightShape>
  /** The id allocator, emptied each frame (`VsmMapIds.reset`). */
  ids: VsmMapIds
}

/** A light's shape as last seen (its kind and numeric fields), the frame it was last seen and its
 *  mobility (the one map of lights' memory): compared and rewritten in place, never rebuilt per
 *  frame. */
interface VsmLightShape extends LightMobility {
  kind: SceneLight['kind']
  values: Float64Array
  seen: number
}
const SHAPE_VALUES = 13

export function createVsmFrameState(
  device: GPUDevice,
  resources: VsmResources,
  cache?: VsmCacheManager,
): VsmFrameState {
  const layout = resources.layout
  return {
    device,
    resources,
    cache:
      cache ??
      new VsmCacheManager({
        poolPages: layout.poolPages,
        cacheEnabled: layout.staticSlice === 1,
      }),
    frameStamp: 0,
    projectionImage: new ArrayBuffer(layout.mapSlots * VSM_PROJECTION_RECORD_BYTES),
    nextMapsImage: new ArrayBuffer(layout.mapSlots * VSM_NEXT_MAP_BYTES),
    nextMapsHeld: [],
    nextMapsHeldCount: 0,
    uniformsImage: new ArrayBuffer(VSM_UNIFORMS_BYTES),
    lightShapes: new Map(),
    ids: new VsmMapIds(),
  }
}

/** Writes `l`'s shape into `shape`; true when it differs from what it held (NaN for an absent
 *  field, compared as equal to NaN). */
function updateShape(shape: VsmLightShape, l: SceneLight) {
  const v = shape.values
  let changed = shape.kind !== l.kind
  shape.kind = l.kind
  for (let k = 0; k < 3; k++) {
    changed = putShape(v, k, l.position?.[k]) || changed
    changed = putShape(v, 3 + k, l.direction?.[k]) || changed
  }
  changed = putShape(v, 6, l.position ? 1 : 0) || changed
  changed = putShape(v, 7, l.direction ? 1 : 0) || changed
  changed = putShape(v, 8, l.range) || changed
  changed = putShape(v, 9, l.coneAngle) || changed
  changed = putShape(v, 10, l.penumbra) || changed
  changed = putShape(v, 11, l.emitterRadius) || changed
  changed = putShape(v, 12, l.castsShadow ? 1 : 0) || changed
  return changed
}

/** Writes `x` (NaN when absent) at `k` of `v`; true when it differs from what `v` held. */
function putShape(v: Float64Array, k: number, x: number | undefined) {
  const value = x ?? Number.NaN
  if (Object.is(v[k], value)) return false
  v[k] = value
  return true
}

/** Light scene changes (added and removed lights) and mobility: each light's shape is compared
 *  with the one it had, and the cache learns which lights moved. */
export function trackLightShapes(state: VsmFrameState, lights: readonly VsmFrameLight[]) {
  const { cache } = state,
    frame = state.frameStamp,
    shapes = state.lightShapes
  for (const { light } of lights) {
    let shape = shapes.get(light.id)
    // A new light is an update whatever its fields.
    let updated = !shape
    if (!shape) {
      shape = {
        kind: '' as SceneLight['kind'],
        values: new Float64Array(SHAPE_VALUES).fill(Number.NaN),
        seen: 0,
        ...newLightMobility(),
      }
      shapes.set(light.id, shape)
    }
    shape.seen = frame
    updated = updateShape(shape, light) || updated
    advanceLightMobility(shape, updated, frame)
  }
  cache.dropRemovedLights((id) => shapes.get(id)?.seen !== frame)
  for (const [id, shape] of shapes) if (shape.seen !== frame) shapes.delete(id)
}
