import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { DEG2RAD, RAD2DEG } from '../../../../../math/src/constants.ts'
import { writeSplitDouble } from '../../../../../math/src/float/splitDouble.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import type { DistanceFieldCascade } from '../../../../../sdk-core/src/contracts/sunCascades.ts'
import { CENTIMETRES_PER_METRE as CM } from '../../../../../sdk-core/src/page/format.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { cascadeBounds, type CascadeBounds, type CascadeCamera } from './bounds.ts'
import {
  DFSH_CUBE_VERTICES,
  DFSH_FINAL,
  DFSH_FLAG,
  DFSH_LIGHT,
  DFSH_MAX_CONE_RADIUS,
  DFSH_MAX_LIGHTS,
  DFSH_PARAMS,
  DFSH_PARAMS_STRIDE,
  DFSH_STEPS,
  DFSH_SUBSURFACE_DENSITY,
  shadowTileSide,
} from './layout.ts'

/** What an image tells the cascade of the camera: the view and the buffers' sizes in pixels, the
 *  camera's world matrix and projection (metres, column-major), the world-to-clip matrix, the eye,
 *  the depth range and whether the projection is a perspective. */
export interface DfshImage extends CascadeCamera {
  view: readonly [number, number]
  extent: readonly [number, number]
  viewProjection: ArrayLike<number>
  eye: ArrayLike<number>
  near: number
  far: number
}

/** A sun whose cascade is traced: its lane of the mask, the unit direction toward it, the angular
 *  radius of its disk (radians), its cascade (`sunCascades`, metres), the farthest a ray goes
 *  (metres) and the share of a pixel's depth its rays start off the surface by. */
export interface DfshLight {
  lane: number
  toLight: readonly [number, number, number]
  angularRadius: number
  cascade: DistanceFieldCascade
  traceDistance: number
  rayStartOffset: number
  /** How dark the cascade's shadow is, from 0 to 1 (`SceneLightShadow.shadowAmount`). */
  amount: number
}

/** The view's settings of the cascade (`SUN_SHADOW_RULES`): the steps of a ray (the quality, 1 to 3),
 *  whether it is traced at the display's resolution, the side of a tile (metres), the factor on a
 *  two-sided mesh's bias, the meshes a tile has room for, and whether the far-shadow test reaches
 *  every mesh (`farShadowCullsAllMeshes`). */
export interface DfshSettings {
  quality: number
  fullResolution: boolean
  tileSize: number
  twoSidedBias: number
  perTile: number
  farMeshes: boolean
}

/** What the scene gives a light's pass: the meshes in it. */
interface DfshScene {
  objects: number
}

/** The widest tangent of the apex angle of a sun's disk the cascade traces with, in degrees. */
const MIN_ANGLE = 0.001
const MAX_ANGLE = 5

/** The trace's downsample: 1 at the display's resolution, else 2. */
export const downsampleOf = (settings: Pick<DfshSettings, 'fullResolution'>) =>
  settings.fullResolution ? 1 : 2

/** The size of a layer of the trace, in texels. */
export const traceSize = (view: readonly [number, number], down: number) =>
  [ceilDiv(view[0], down), ceilDiv(view[1], down)] as const

/** The cascade of `light` seen by `image`: the bounds of its slice (centimetres, from the eye). */
export const boundsOf = (image: DfshImage, light: DfshLight): CascadeBounds =>
  cascadeBounds(image, light.cascade.near, light.cascade.far, light.toLight)

/** The tiles along a side of the grid the meshes of a cascade of bounds `bounds` are listed in. */
export const tilesOf = (bounds: CascadeBounds, settings: Pick<DfshSettings, 'tileSize'>) =>
  shadowTileSide(bounds.radius, settings.tileSize * CM)

const current = new Float64Array(16)
const translation = new Float64Array(16)
const product = new Float64Array(16)
const inverse = new Float64Array(16)

/** Writes the matrix that takes a device position and depth to the position from the eye, in
 *  centimetres: the inverse of the view-projection of positions from the eye. */
function putUnproject(out: Float32Array, at: number, image: DfshImage) {
  translation.fill(0)
  for (let k = 0; k < 4; k++) translation[5 * k] = 1
  for (let k = 0; k < 3; k++) translation[12 + k] = image.eye[k]
  current.set(image.viewProjection)
  multiplyMatrix4(product, current, translation)
  invertMatrix4(inverse, product)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) out[at + c * 4 + r] = inverse[c * 4 + r] * (r < 3 ? CM : 1)
}

/** Writes the matrix that takes a position from the eye to the cascade's shadow space: the light's
 *  right and up over the sphere's radius, then the distance toward the light from the sphere's far
 *  side over the same radius. */
function putToShadow(out: Float32Array, at: number, b: CascadeBounds, toLight: readonly number[]) {
  const axes = [b.right, b.up, toLight]
  for (let r = 0; r < 3; r++) {
    const axis = axes[r]
    for (let c = 0; c < 3; c++) out[at + c * 4 + r] = axis[c] / b.radius
    const shift = axis[0] * b.centre[0] + axis[1] * b.centre[1] + axis[2] * b.centre[2]
    out[at + 12 + r] = (r === 2 ? b.radius : 0) / b.radius - shift / b.radius
  }
  out[at + 15] = 1
}

/** How a device depth turns into a distance (the occlusion's own, `ao/params.ts`). */
function putDepth(out: Float32Array, at: number, image: DfshImage) {
  if (image.perspective) putVec4(out, at, image.near, 0, 1)
  else putVec4(out, at, image.far - image.near, image.near, 0)
}

/** The tangent of the apex angle of a sun's disk, held between 0.001 and 5 degrees. */
const lightTangent = (angularRadius: number) =>
  Math.tan(clamp(2 * angularRadius * RAD2DEG, MIN_ANGLE, MAX_ANGLE) * DEG2RAD)

/**
 * Writes the uniform of light number `index` of the frame (`DFSH_PARAMS`) into `floats` and `words`,
 * two views of the same buffer, at its stride: everything the passes of its cascade read of the
 * settings, the image, the scene and the light. `bounds` are the cascade's (`boundsOf`).
 */
export function writeDfshParams(
  floats: Float32Array,
  words: Uint32Array,
  index: number,
  input: { image: DfshImage; light: DfshLight; bounds: CascadeBounds; layer: number },
  settings: DfshSettings,
  scene: DfshScene,
) {
  const { image, light, bounds, layer } = input
  const base = (index * DFSH_PARAMS_STRIDE) / 4
  const at = DFSH_PARAMS.at
  putUnproject(floats, base + at.unproject, image)
  putToShadow(floats, base + at.toShadow, bounds, light.toLight)
  floats.set(bounds.planes, base + at.planes)
  for (let k = 0; k < 3; k++) {
    writeSplitDouble(floats, base + at.eyeHigh + k, base + at.eyeLow + k, image.eye[k] * CM)
  }
  putVec4(floats, base + at.light, ...light.toLight, lightTangent(light.angularRadius))
  const quality = clamp(Math.trunc(settings.quality), 1, 3)
  putVec4(
    floats,
    base + at.trace,
    light.traceDistance * CM,
    light.rayStartOffset,
    DFSH_STEPS[quality],
    quality >= 2 ? DFSH_SUBSURFACE_DENSITY : 0,
  )
  const { cascade } = light
  putVec4(
    floats,
    base + at.range,
    cascade.minDepth * CM,
    cascade.maxDepth * CM,
    settings.twoSidedBias,
  )
  const side = tilesOf(bounds, settings)
  putVec4(
    floats,
    base + at.expand,
    (1.414 * bounds.radius) / side,
    DFSH_MAX_CONE_RADIUS / bounds.radius,
  )
  const down = downsampleOf(settings)
  words.set([image.view[0], image.view[1], down, layer], base + at.view)
  words.set([side, settings.perTile * side * side, scene.objects, 0], base + at.tiles)
  const flags = settings.farMeshes ? DFSH_FLAG.farMeshes : 0
  words.set([bounds.planeCount, DFSH_CUBE_VERTICES, 0, flags], base + at.counts)
  putDepth(floats, base + at.depth, image)
}

/**
 * Writes the uniform of the final pass (`DFSH_FINAL`) into `floats` and `words`: for each light its
 * lane, the depths it is traced between and where it fades in and out, in centimetres.
 */
export function writeDfshFinal(
  floats: Float32Array,
  words: Uint32Array,
  image: DfshImage,
  lights: readonly DfshLight[],
  settings: Pick<DfshSettings, 'fullResolution'>,
) {
  const at = DFSH_FINAL.at
  floats.fill(0)
  words.set([image.view[0], image.view[1], downsampleOf(settings), lights.length], at.view)
  words.set([image.extent[0], image.extent[1], 0, 0], at.extent)
  putDepth(floats, at.depth, image)
  lights.forEach((light, layer) => {
    if (light.lane < 0 || light.lane >= DFSH_MAX_LIGHTS) return
    const base = at.lights + light.lane * DFSH_LIGHT.words
    const { cascade } = light
    putVec4(
      floats,
      base + DFSH_LIGHT.at.range,
      cascade.minDepth * CM,
      cascade.maxDepth * CM,
      cascade.fadeOffset * CM,
      cascade.invFadeLength / CM,
    )
    putVec4(
      floats,
      base + DFSH_LIGHT.at.fade,
      cascade.nearFadeOffset * CM,
      cascade.invNearFadeLength / CM,
      light.amount,
    )
    words.set([1, layer, 0, 0], base + DFSH_LIGHT.at.lane)
  })
}
