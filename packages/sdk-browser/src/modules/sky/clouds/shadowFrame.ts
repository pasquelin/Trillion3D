import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { crossVector3, normalizeVector3 } from '../../../../../math/src/vector/vector.ts'
import type { CloudShadowLight } from '../../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import { cloudShadowBaseSamples } from '../../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'

/**
 * WHERE A LIGHT'S CLOUD SHADOW MAP LOOKS: the camera, the sphere of the map and the matrices that
 * take a point to the map's clip space and back. Nothing here touches the GPU.
 *
 * The map is an orthographic view along the light, with the depth reversed (the near plane is 1, the
 * far plane 0), of a square round the point of the planet's surface under the camera. Its steps, in
 * centimetres, on the material's axes (the scene's `x`, `z` and `y` up: `sceneToMaterial`):
 * 1. the point looked at is the planet's centre plus the unit vector from the centre to the camera
 *    times the planet's radius, then each coordinate is rounded to the grid of `cloudShadowMapSnapKm`;
 * 2. the map's eye lies behind it along the light by the light distance, twice the sphere's radius
 *    unless `cloudShadowMapLightDistanceOverrideKm` says;
 * 3. its view looks from the eye at that point, its up the vertical, or the forward axis where the
 *    light is nearly vertical (a dot above 0.99); its projection keeps `1 / diameter` of each side
 *    in clip space, and its depth range is the near plane 0 to the far plane of twice the light
 *    distance;
 * 4. with the snap to the pixel grid on, the clip position of the world's origin is rounded to a
 *    grid of a quarter of the map's side to the unit along x and y, and the projection is shifted by what that
 *    moved it, so that a point of the world keeps its place in the texels while the camera moves.
 * The matrices are given from the position in centimetres from the camera, on the scene's axes.
 */

export const CM_PER_KM = 100000
export const CM_PER_M = 100
export const KM_PER_CM = 0.00001

/** A scene point's axes on the material's: the scene's `y` is up, the material's `z`. */
export const sceneToMaterial = (v: ArrayLike<number>) => [v[0], v[2], v[1]]

/** The shortest snap length, in kilometres, a map's position is rounded to. The quality setting lets
 *  a length of 0 or less through; the rounding divides by it, so such a length would give a matrix of
 *  not-a-number values and a blank map. */
export const LEAST_SNAP_KM = 1e-4

/** The cosine above which a light is taken as vertical. */
export const VERTICAL = 0.99

/** The rows of a matrix in the order a row-vector product uses them: the same numbers, read as a
 *  column-major matrix, are the column-vector matrix of the same map. */
export const rowsAsMap = (rows: readonly number[]) => Float64Array.from(rows)

/** The map of the look from `eye` to `at`, `up` the vertical: the camera's axes as columns, then
 *  the eye taken off. */
export function lookAtMap(eye: number[], at: number[], up: number[]) {
  const z = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]
  normalizeVector3(z)
  const x = [0, 0, 0]
  crossVector3(x, up, z)
  normalizeVector3(x)
  const y = [0, 0, 0]
  crossVector3(y, z, x)
  const d = (a: number[]) => -(eye[0] * a[0] + eye[1] * a[1] + eye[2] * a[2])
  return rowsAsMap([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    d(x),
    d(y),
    d(z),
    1,
  ])
}

/** The reversed orthographic map: `1 / width` and `1 / height` on x and y, the depth scaled by
 *  `-zScale` and lifted to 1 at the offset. */
export const reversedOrthoMap = (width: number, height: number, zScale: number, zOffset: number) =>
  rowsAsMap([
    1 / width,
    0,
    0,
    0,
    0,
    1 / height,
    0,
    0,
    0,
    0,
    -zScale,
    0,
    0,
    0,
    1 - zOffset * zScale,
    1,
  ])

/** The shift by `d` after the map. */
export const shiftMap = (d: ArrayLike<number>) =>
  rowsAsMap([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d[0], d[1], d[2], 1])

/** What the frame of a light's map is made from. */
export interface CloudShadowFrameInput {
  /** The camera in the scene, metres, and from the planet's centre, kilometres (the air's frame). */
  readonly eye: ArrayLike<number>
  readonly eyeFromPlanetKm: ArrayLike<number>
  /** The planet's radius, kilometres. */
  readonly planetRadiusKm: number
  /** The unit direction toward the light, on the scene's axes. */
  readonly toward: ArrayLike<number>
  /** The map's side, in texels (`cloudShadowSide`). */
  readonly side: number
  readonly light: CloudShadowLight
  /** The sky's quality settings of the map: `cloudShadowMapSamplesMax`,
   *  `cloudShadowMapHorizonMultiplier`, `cloudShadowMapSnapKm`, `cloudShadowMapSnapToPixelGrid` and
   *  `cloudShadowMapLightDistanceOverrideKm`. */
  readonly quality: Pick<
    SkyQualityValues,
    | 'cloudShadowMapSamplesMax'
    | 'cloudShadowMapHorizonMultiplier'
    | 'cloudShadowMapSnapKm'
    | 'cloudShadowMapSnapToPixelGrid'
    | 'cloudShadowMapLightDistanceOverrideKm'
  >
}

/** The frame of a light's map. */
export interface CloudShadowFrame {
  /** The matrix from a position in centimetres from the camera to clip space, and back,
   *  column-major, as a column vector multiplies it. */
  readonly clipFromCamera: Float64Array
  readonly cameraFromClip: Float64Array
  /** The direction of the light's rays, from the light, on the scene's axes. */
  readonly rayDirection: readonly [number, number, number]
  /** The depth of the far plane, kilometres. */
  readonly farDepthKm: number
  /** The samples of a ray of the map, with the sun's low height added. */
  readonly samples: number
}

/** The frame of a light's map, with the places the temporal filter keeps (`shadowHistory.ts`). */
export interface CloudShadowLightFrame extends CloudShadowFrame {
  /** The map's eye and the point it looks at, centimetres on the scene's axes, the second snapped. */
  readonly lightPosition: readonly [number, number, number]
  readonly anchor: readonly [number, number, number]
}

export const product = (a: Float64Array, b: Float64Array) =>
  multiplyMatrix4(new Float64Array(16), a, b)

/** The frame of the map of the light that shines along `toward` (negated), for a camera at `eye`.
 *  The snap length is held at `LEAST_SNAP_KM` or more before it becomes centimetres: the rounding
 *  divides by it, and a length of 0 or less (the quality setting accepts any number) would turn
 *  every matrix into not-a-number values. */
export function cloudShadowFrame(input: CloudShadowFrameInput): CloudShadowLightFrame {
  const { light, quality } = input
  const camera = sceneToMaterial(input.eye).map((v) => v * CM_PER_M)
  const toward = sceneToMaterial(input.toward)
  const ray = toward.map((v) => -v)
  const centre = sceneToMaterial(input.eyeFromPlanetKm).map((v, k) => camera[k] - v * CM_PER_KM)

  // The planet's vertical under the camera, and the point of the surface below it, snapped.
  const up = sceneToMaterial(input.eyeFromPlanetKm)
  normalizeVector3(up)
  const snap = Math.max(LEAST_SNAP_KM, quality.cloudShadowMapSnapKm) * CM_PER_KM
  const lookAt = up.map((v, k) => centre[k] + v * input.planetRadiusKm * CM_PER_KM)
  const snapped = lookAt.map((v) => Math.floor((v + 0.5 * snap) / snap) * snap)

  const radius = light.cloudShadowExtentKm * CM_PER_KM
  const distance =
    quality.cloudShadowMapLightDistanceOverrideKm > 0
      ? quality.cloudShadowMapLightDistanceOverrideKm * CM_PER_KM
      : radius * 2
  const far = distance * 2
  const vertical = Math.abs(ray[2]) > VERTICAL ? [1, 0, 0] : [0, 0, 1]
  const eyeOfMap = snapped.map((v, k) => v - ray[k] * distance)
  const view = lookAtMap(eyeOfMap, snapped, vertical)
  const projection = reversedOrthoMap(radius * 2, radius * 2, 1 / far, 0)
  let worldToClip = product(projection, view)

  if (quality.cloudShadowMapSnapToPixelGrid) {
    // The clip position of the world's origin is the translation column of the map.
    const origin = [worldToClip[12], worldToClip[13], worldToClip[14]]
    const grid = input.side * 0.5 * 0.5
    const shift = [
      Math.floor(origin[0] * grid + 0.5) / grid - origin[0],
      Math.floor(origin[1] * grid + 0.5) / grid - origin[1],
      0,
    ]
    worldToClip = product(shiftMap(shift), worldToClip)
  }

  // From a position in centimetres from the camera, on the scene's axes: to the material's axes,
  // then the camera's position added, then the map.
  const toMaterial = rowsAsMap([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1])
  const clipFromCamera = product(worldToClip, product(shiftMap(camera), toMaterial))

  // The sun's low height adds samples: more where the light grazes the ground.
  const base = cloudShadowBaseSamples(light, quality.cloudShadowMapSamplesMax)
  const horizon = clamp(
    0.2 / Math.abs(up[0] * toward[0] + up[1] * toward[1] + up[2] * toward[2]),
    0,
    1,
  )
  return {
    clipFromCamera,
    cameraFromClip: invertMatrix4(new Float64Array(16), clipFromCamera),
    rayDirection: [-input.toward[0], -input.toward[1], -input.toward[2]],
    lightPosition: [eyeOfMap[0], eyeOfMap[2], eyeOfMap[1]],
    anchor: [snapped[0], snapped[2], snapped[1]],
    farDepthKm: far * KM_PER_CM,
    samples: base + Math.max(0, quality.cloudShadowMapHorizonMultiplier - 1) * base * horizon,
  }
}
