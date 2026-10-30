import { DEG2RAD } from '../../../../../../math/src/constants.ts'
import { clamp } from '../../../../../../math/src/scalar/reals.ts'
import { normalizeVector3OrZero } from '../../../../../../math/src/vector/vector.ts'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { shadowOfLight } from '../../../../../../sdk-core/src/scene/light/lightShadow.ts'
import {
  computeBufferEntry,
  computeStorageEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { createCachedGroup } from '../../../../gpu/bind/cachedGroup.ts'
import type { askedComputeStage } from '../../../../gpu/core/computeStages.ts'
import { idleTooLong } from '../../../../gpu/core/idleKeep.ts'
import { perViewRunsOf } from '../../../../gpu/core/encoderUniforms.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { DFSH_MAX_LIGHTS } from '../../../distanceField/shadow/layout.ts'
import {
  createMeshShadowState,
  releaseMeshShadow,
} from '../../../surfaceCache/lighting/meshShadow.ts'
import { meshShadowLayoutEntries } from '../../../surfaceCache/lighting/meshShadowWgsl.ts'
import { VSM_CM_PER_UNIT } from '../../vsm/constants.ts'
import { sunCascadesOf } from '../../vsm/frame/vsmDense.ts'
import type { VsmFrame } from '../../vsm/frame/vsmProject.ts'
import { viewCascadesOf } from '../classicView.ts'
import { nearInCentimetres } from '../denseEntries.ts'
import { CENTIMETRES_PER_METRE as CM } from '../../../../../../sdk-core/src/page/format.ts'
import { fieldCascade, type FieldCascade } from './fieldCascade.ts'
import { FIELD_SHADOW_BINDINGS as B } from './fieldShadowWgsl.ts'
import { viewKey } from '../../../../frame/backend/state/viewKey.ts'

export const FIELD_SHADOW_LABEL = 'Trillion3D sun distance-field cascade'
/** The bounds of the sun's full angle, in degrees, held to before the tangent the cone widens by. */
const MIN_ANGLE = 0.001
const MAX_ANGLE = 5
const PARAM_WORDS = 28
const FACTORS_FORMAT: GPUTextureFormat = 'rg32float'
/** The ray bias of the lists' blocks: the cascade's rays have none of the cards' (the surface is offset along the ray instead). */
export const NO_RAY_BIAS = { surfaceCacheDirectLightingMeshSdfShadowRayBias: 0 }

/** What a run of the cascade over one image holds for the water's kernels, which run later in the same image on the water's depth. */
export interface PreparedField {
  /** The image the lists were made for. */
  frame: number
  /** What the lists were made of besides the suns (the fields' generation and revision, the drawn size, the resolution): the lists stand while it and the suns are the same (`sameRun`). */
  stamp: readonly number[]
  /** Whether the image that made the lists was submitted: the lists of a dropped image were never written, so a held image keeps only submitted ones. */
  submitted: boolean
  suns: readonly (CascadeSun & { block: number })[]
  factor: number
  low: [number, number]
  window: [number, number]
  forward: number[]
  /** The reflection group (the view) and the lists' group of the run. */
  view: GPUBindGroup
  lists: GPUBindGroup
}

/**
 * What one view holds of the cascade: the lists, the traced image and the uniforms its own depth and window size, the bind groups that name them, the run its opaque pass
 * prepared this image for the water's kernels and the water's sun mask (a layer a sun of the frame, like the projection's). Views of other sizes share only the device's stages (`kitOf`).
 */
export interface FieldView {
  readonly device: GPUDevice
  /** The lists of the meshes by tile across the suns. */
  readonly state: ReturnType<typeof createMeshShadowState>
  traced?: { texture: GPUTexture; view: GPUTextureView; width: number; height: number }
  /** The uniform of each run of an encode (the view's own) and the bind groups the runs of an image name, kept while the resources they name are those of the image before (a run each, the sun's of a frame being few). */
  readonly runs: ReturnType<typeof runsOf.of>
  /** The image the cascade last ran in: a view that stops running it lets it go after `IDLE_KEEP_IMAGES`. */
  lastRun: number
  prepared?: PreparedField
  waterMask?: { device: GPUDevice; texture: GPUTexture; view: GPUTextureView }
}

const fieldViews = new WeakMap<object, FieldView>()

/** The uniforms and the bind groups of the runs of the cascade, a pair a view and its device. */
const runsOf = perViewRunsOf(`${FIELD_SHADOW_LABEL} params`, PARAM_WORDS * 4, () => ({
  trace: createCachedGroup(DFSH_MAX_LIGHTS),
  upsample: createCachedGroup(DFSH_MAX_LIGHTS),
  traceWater: createCachedGroup(),
  upsampleWater: createCachedGroup(),
  lists: createCachedGroup(),
}))

/** What `gpu`'s view holds for the cascade, made at the first call and again where the device changed (what it held is retired on its device). */
export function fieldViewOf(gpu: { viewKey?: object }, device: GPUDevice) {
  let held = fieldViews.get(viewKey(gpu))
  if (held && held.device !== device) {
    releaseFieldShadow(gpu, true)
    held = undefined
  }
  if (!held)
    fieldViews.set(
      viewKey(gpu),
      (held = {
        device,
        state: createMeshShadowState(),
        runs: runsOf.of(viewKey(gpu), device),
        // The caller stamps it in the image it asks the cascade (`fieldShadow.ts`), before anything can refuse the lists.
        lastRun: -1,
      }),
    )
  return held
}

/** What `gpu`'s view holds for the cascade on `device`, none where it holds none or holds it on another device (the water reads the run the opaque pass prepared, never makes the view's). */
export function peekFieldView(gpu: { viewKey?: object }, device: GPUDevice) {
  const held = fieldViews.get(viewKey(gpu))
  return held?.device === device ? held : undefined
}

/** Lets go (retires: this image's commands may still name it, unless the device was replaced) of the water's sun mask of `gpu`'s view, where the water does not use the field shadow or the view goes. */
export function releaseFieldWaterMask(gpu: { viewKey?: object }, replaced = false) {
  const held = fieldViews.get(viewKey(gpu))
  if (!held?.waterMask) return
  retire(held.waterMask.device, held.waterMask.texture, replaced)
  held.waterMask = undefined
}

/** What the passes hold on a device: the layouts and the stages (asked once, off the frame) every view runs the cascade with. */
export const kitOf = oncePerDevice((device: GPUDevice) => {
  const params = computeUniformEntry(B.params)
  const factors = computeTextureEntry(B.factors, 'unfilterable-float')
  const traced = computeStorageTextureEntry(B.factors, FACTORS_FORMAT, 'write-only')
  const layout = (label: string, entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ label: `${FIELD_SHADOW_LABEL} ${label}`, entries })
  const words = new Uint32Array(PARAM_WORDS)
  return {
    traceGroup: layout('trace', [params, traced]),
    upsampleGroup: layout('upsample', [
      params,
      factors,
      computeStorageTextureEntry(B.mask, 'r32float', 'read-write', '2d-array'),
    ]),
    traceWaterGroup: layout('trace water', [
      params,
      traced,
      computeTextureEntry(B.depth, 'depth'),
      computeStorageEntry(B.tiles, false),
      computeBufferEntry(B.count, 'uniform'),
    ]),
    upsampleWaterGroup: layout('upsample water', [
      params,
      factors,
      computeStorageTextureEntry(B.mask, 'r32float', 'write-only', '2d-array'),
      computeTextureEntry(B.depth, 'depth'),
      computeStorageEntry(B.tiles, false),
      computeBufferEntry(B.count, 'uniform'),
    ]),
    lists: layout('lists', meshShadowLayoutEntries()),
    // Written and read at once by a run, never kept across two.
    words,
    floats: new Float32Array(words.buffer),
    trace: undefined as ReturnType<typeof askedComputeStage> | undefined,
    upsample: undefined as ReturnType<typeof askedComputeStage> | undefined,
    traceWater: undefined as ReturnType<typeof askedComputeStage> | undefined,
    upsampleWater: undefined as ReturnType<typeof askedComputeStage> | undefined,
  }
})
export type FieldKit = ReturnType<typeof kitOf>

/**
 * `gpu`'s view lets go of the cascade (it has none, it goes or it stopped running it): its water mask, the run it prepared, its lists, traced image and uniforms are retired
 * (this image's commands may still name them; `replaced`: the device was replaced, they go at once).
 */
export function releaseFieldShadow(gpu: { viewKey?: object }, replaced = false) {
  releaseFieldWaterMask(gpu, replaced)
  const held = fieldViews.get(viewKey(gpu))
  if (!held) return
  fieldViews.delete(viewKey(gpu))
  const { device, traced, state } = held
  retire(device, { destroy: () => releaseMeshShadow(state) }, replaced)
  if (traced) retire(device, traced.texture, replaced)
  runsOf.release(viewKey(gpu), replaced)
}

/** Lets go of the cascade of a view that has not run it for `IDLE_KEEP_IMAGES` images: every image of the view, whatever stopped the cascade. */
export function idleFieldShadow(gpu: { viewKey?: object }, image: number) {
  const held = fieldViews.get(viewKey(gpu))
  if (held && idleTooLong(image, held.lastRun)) releaseFieldShadow(gpu)
}

const sameNumbers = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.prototype.every.call(a, (v: number, i) => v === b[i])

/** Whether the lists `prepared` holds were made of this `stamp` and these suns: compared numerically, only where a held image asks. */
export function sameRun(
  prepared: PreparedField,
  stamp: readonly number[],
  suns: readonly CascadeSun[],
) {
  return (
    sameNumbers(prepared.stamp, stamp) &&
    prepared.suns.length === suns.length &&
    suns.every((sun, i) => {
      const held = prepared.suns[i]!
      return (
        held.layer === sun.layer &&
        held.tanLight === sun.tanLight &&
        held.traceDistance === sun.traceDistance &&
        held.startOffset === sun.startOffset &&
        sameNumbers(held.toLight, sun.toLight) &&
        sameNumbers(Object.values(held.cascade), Object.values(sun.cascade))
      )
    })
  )
}

/** A sun with the cascade: its rank among the frame's suns (its layer of the masks), its cascade and its direction toward it. */
export interface CascadeSun {
  layer: number
  cascade: FieldCascade
  /** The tangent that widens the sun's rays, from its full angle held to the bounds. */
  tanLight: number
  toLight: [number, number, number]
  /** The light's own reach of a ray (`distanceFieldShadowTraceDistance`, metres) and start offset (`distanceFieldShadowRayStartOffsetDepthScale`). */
  traceDistance: number
  startOffset: number
}

/** The frame's suns that have the cascade (the first `DFSH_MAX_LIGHTS`): each light of the classic shadows with a distance-field reach past its last cascade. */
export function cascadeSuns(
  frame: VsmFrame,
  shadows: ShadowValues,
  suns: number,
  tan: [number, number],
) {
  const { rt, plan, cam } = frame
  const view = viewCascadesOf(shadows, nearInCentimetres(cam.near))
  const found: CascadeSun[] = []
  for (let k = 0; k < suns && found.length < DFSH_MAX_LIGHTS; k++) {
    const projected = plan.projected[k]!
    const sun = projected.clipmap?.light
    const light = rt.lights.store.light(projected.id)
    if (!sun || !sun.shadow || !light || light.kind !== 'directional') continue
    const own = shadowOfLight(light)
    const cascade = fieldCascade({
      sun: sunCascadesOf(light),
      view,
      reach: own.distanceFieldShadows
        ? own.distanceFieldShadowDistance * VSM_CM_PER_UNIT * shadows.distanceFieldDistanceScale
        : 0,
      farTransitionScale: shadows.distanceFieldFarTransitionScale,
      tan,
    })
    const toLight: [number, number, number] = [0, 0, 0]
    normalizeVector3OrZero(toLight, sun.direction, 1e-12)
    if (!cascade || (toLight[0] === 0 && toLight[1] === 0 && toLight[2] === 0)) continue
    found.push({
      layer: k,
      cascade,
      // The sun's angle, a full angle, is held to the reference's bounds before the tangent.
      tanLight: Math.tan(
        clamp(2 * (light.angularRadius ?? 0), MIN_ANGLE * DEG2RAD, MAX_ANGLE * DEG2RAD),
      ),
      toLight: [-toLight[0], -toLight[1], -toLight[2]],
      traceDistance: own.distanceFieldShadowTraceDistance,
      startOffset: own.distanceFieldShadowRayStartOffsetDepthScale,
    })
  }
  return found
}

/** The view of the image of the traced factors of a view, `width` by `height` texels, the held one if it is that size. */
export function tracedImage(view: FieldView, size: [number, number]) {
  const { traced: held, device } = view
  if (held && held.width === size[0] && held.height === size[1]) return held.view
  if (held) retire(device, held.texture)
  const texture = device.createTexture({
    label: `${FIELD_SHADOW_LABEL} factors`,
    size,
    format: FACTORS_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  return (view.traced = { texture, view: texture.createView(), width: size[0], height: size[1] })
    .view
}

/** Writes sun `entry`'s uniform: the sizes, the window, the cascade's depths in metres, the ray, the view axis and the fades. */
export function writeParams(
  kit: FieldKit,
  entry: CascadeSun & { block: number },
  input: {
    factor: number
    low: [number, number]
    window: [number, number]
    forward: ArrayLike<number>
  },
) {
  const { cascade, toLight, tanLight, traceDistance, startOffset } = entry
  const { words, floats } = kit
  const minDepth = (cascade.near - cascade.nearFadeLength) / CM
  const nearFade = cascade.nearFadeLength > 0
  words.set([input.low[0], input.low[1], input.factor, entry.block], 0)
  words.set([0, 0, input.window[0], input.window[1]], 4)
  floats.set([minDepth, cascade.far / CM, tanLight, traceDistance * CM], 8)
  floats.set([...toLight, startOffset], 12)
  floats.set([input.forward[0]!, input.forward[1]!, input.forward[2]!, 0], 16)
  floats.set(
    [
      cascade.fadePlane / CM,
      cascade.fadeLength > 0 ? CM / Math.max(cascade.fadeLength, 0.00001) : 0,
      nearFade ? minDepth : -1,
      nearFade ? CM / Math.max(cascade.nearFadeLength, 0.00001) : 1,
    ],
    20,
  )
  words.set([entry.layer, 0, 0, 0], 24)
}
