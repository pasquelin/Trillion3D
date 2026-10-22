import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { crossVector3, normalizeVector3 } from '../../../../../math/src/vector/vector.ts'
import type { CloudShadowLight } from '../../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import { cloudShadowBaseSamples } from '../../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import {
  CM_PER_KM,
  type SkyQualityValues,
} from '../../../../../sdk-core/src/modules/sky/quality.ts'

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

const CM_PER_M = 100
/** Kilometres in a centimetre: the product, not the quotient by `CM_PER_KM`, which differs in the last bit. */
export const KM_PER_CM = 0.00001

/** A scene point's axes on the material's: the scene's `y` is up, the material's `z`. */
export const sceneToMaterial = (v: ArrayLike<number>) => [v[0], v[2], v[1]]

/** The snap length, in kilometres, that stands for a length of 0 or less, which the quality setting
 *  lets through; the rounding divides by it, so such a length would give a matrix of
 *  not-a-number values and a blank map. */
const LEAST_SNAP_KM = 1e-4

/** The cosine above which a light is taken as vertical. */
const VERTICAL = 0.99

/** The rows of a matrix in the order a row-vector product uses them: the same numbers, read as a
 *  column-major matrix, are the column-vector matrix of the same map. */
const rowsAsMap = (rows: readonly number[]) => Float64Array.from(rows)

/** The map of the look from `eye` to `at`, `up` the vertical: the camera's axes as columns, then
 *  the eye taken off. */
function lookAtMap(eye: number[], at: number[], up: number[]) {
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
const reversedOrthoMap = (width: number, height: number, zScale: number, zOffset: number) =>
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
const shiftMap = (d: ArrayLike<number>) =>
  rowsAsMap([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d[0], d[1], d[2], 1])

/** The map from the scene's axes to the material's: `y` and `z` swapped. */
const SCENE_TO_MATERIAL = rowsAsMap([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1])

/** A value rounded to the grid of `step`, a tie upward. */
const snapped = (v: number, step: number) => Math.floor((v + 0.5 * step) / step) * step

/** Where a map looks: the camera and the planet's centre in centimetres on the material's axes, the
 *  planet's vertical under the camera, the snap length in centimetres and the point of the
 *  surface below the camera on that grid. A snap length of 0 or less (the quality
 *  setting accepts any number) is read as `LEAST_SNAP_KM`: the rounding divides by it, and it would
 *  turn every matrix into not-a-number values. */
export function mapAim(
  eye: ArrayLike<number>,
  eyeFromPlanetKm: ArrayLike<number>,
  planetRadiusKm: number,
  snapKm: number,
) {
  const camera = sceneToMaterial(eye).map((v) => v * CM_PER_M)
  const centre = sceneToMaterial(eyeFromPlanetKm).map((v, k) => camera[k] - v * CM_PER_KM)
  const up = sceneToMaterial(eyeFromPlanetKm)
  normalizeVector3(up)
  const snap = (snapKm > 0 ? snapKm : LEAST_SNAP_KM) * CM_PER_KM
  const lookAt = up.map((v, k) => centre[k] + v * planetRadiusKm * CM_PER_KM)
  return { camera, centre, up, snap, at: lookAt.map((v) => snapped(v, snap)) }
}

/** The map of the orthographic view along `direction` of a square of side `diameter` round `at`:
 *  the eye lies behind `at` by `distance`, the up is the vertical (the forward axis where
 *  `direction` is nearly vertical), the far plane is `far`. Returns the eye and the map from the
 *  material's axes to clip space. */
export function orthoMapAlong(
  at: number[],
  direction: number[],
  distance: number,
  diameter: number,
  far: number,
) {
  const vertical = Math.abs(direction[2]) > VERTICAL ? [1, 0, 0] : [0, 0, 1]
  const eye = at.map((v, k) => v - direction[k] * distance)
  const worldToClip = product(
    reversedOrthoMap(diameter, diameter, 1 / far, 0),
    lookAtMap(eye, at, vertical),
  )
  return { eye, worldToClip }
}

/** The map from a position in centimetres from the camera, on the scene's axes, to clip space: to
 *  the material's axes, then the camera's position added, then `worldToClip`. */
export const mapFromCamera = (worldToClip: Float64Array, camera: number[]) =>
  product(worldToClip, product(shiftMap(camera), SCENE_TO_MATERIAL))

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

const product = (a: Float64Array, b: Float64Array) => multiplyMatrix4(new Float64Array(16), a, b)

/** The frame of the map of the light that shines along `toward` (negated), for a camera at `eye`. */
export function cloudShadowFrame(input: CloudShadowFrameInput): CloudShadowLightFrame {
  const { light, quality } = input
  const aim = mapAim(
    input.eye,
    input.eyeFromPlanetKm,
    input.planetRadiusKm,
    quality.cloudShadowMapSnapKm,
  )
  const { camera, up } = aim
  const toward = sceneToMaterial(input.toward)
  const ray = toward.map((v) => -v)

  const radius = light.cloudShadowExtentKm * CM_PER_KM
  const distance =
    quality.cloudShadowMapLightDistanceOverrideKm > 0
      ? quality.cloudShadowMapLightDistanceOverrideKm * CM_PER_KM
      : radius * 2
  const far = distance * 2
  const { eye: eyeOfMap, worldToClip: mapped } = orthoMapAlong(
    aim.at,
    ray,
    distance,
    radius * 2,
    far,
  )
  let worldToClip = mapped

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

  const clipFromCamera = mapFromCamera(worldToClip, camera)

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
    anchor: [aim.at[0], aim.at[2], aim.at[1]],
    farDepthKm: far * KM_PER_CM,
    samples: base + Math.max(0, quality.cloudShadowMapHorizonMultiplier - 1) * base * horizon,
  }
}
