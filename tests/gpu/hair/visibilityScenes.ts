// The scenes the strands' visibility is proved on, and the closed form of what they cover: a camera at
// (0, 0, 3) facing −z, ribbons standing upright in the plane z = 0 — so that a sample of the screen maps
// to the plane by a product, and a ribbon covers it when the sample lies within its half width of its axis
// and between its ends —, and a strand that crosses the near plane.
import { parseHairStrands } from '../../../packages/sdk-core/src/hair/hairStrandsFile.ts'
import { hairStrandsFixture } from '../../../packages/sdk-core/src/hair/hairStrandsFile.fixture.ts'
import {
  createEngineCamera,
  writeEngineCamera,
} from '../../../packages/sdk-browser/src/camera/engineCamera.ts'
import { IDENTITY_MATRIX4 } from '../../../packages/math/src/matrix/matrix4.ts'
import { pixelSizeAtDepth1 } from '../../../packages/sdk-browser/src/hair/scene.ts'
import { hairMinRadiusAtDepth1 } from '../../../packages/sdk-browser/src/hair/visibilityMath.ts'

export const WIDTH = 640
export const HEIGHT = 360
export const DISTANCE = 3
export const SAMPLES = 8
/** The coverage a pixel counts as full at: the option's default. */
export const FULL_COVERAGE = 0.98
/** The scale of the least width of a strand: `hairRasterizationScale`'s default. */
export const RASTERIZATION_SCALE = 0.5

/** A ribbon standing upright in the plane z = 0: its axis at x = `x`, from `y0` to `y1`, `radius` the
 *  strand's own, `id` the rank of its first control point. */
export interface Ribbon {
  readonly x: number
  readonly y0: number
  readonly y1: number
  readonly radius: number
  readonly id: number
}

/** The scenes: two wide ribbons a gap apart (the segment joining their strands is not drawn), and a
 *  ribbon thinner than the samples of a pixel can find (the least radius widens it). */
export const SCENES = {
  wide: {
    radius: 0.05,
    ribbons: [
      { x: 0, y0: -0.5, y1: 0.5, radius: 0.05, id: 0 },
      { x: 0.5, y0: -0.5, y1: 0.5, radius: 0.05, id: 2 },
    ],
  },
  thin: {
    radius: 0.0005,
    ribbons: [{ x: 0.00390625, y0: -0.5, y1: 0.5, radius: 0.0005, id: 0 }],
  },
} as const satisfies Record<string, { radius: number; ribbons: readonly Ribbon[] }>
export type SceneName = keyof typeof SCENES

/** A strand from a point a metre in front of the camera to one behind it (the camera at z = 3): the
 *  segment crosses the near plane (0.1) on the screen, three quarters of the half height under its
 *  centre, where its ribbon is a few pixels wide. */
export const NEAR_STRAND = {
  radius: 0.002,
  points: [0.02, -0.2, 2, 0, 0.01, 3.2],
} as const

/** The strands of a scene: each ribbon one curve of two points. */
export const strandsOf = (ribbons: readonly Ribbon[], radius: number) =>
  parseHairStrands(
    hairStrandsFixture([
      { id: 0, radius, curves: ribbons.map(({ x, y0, y1 }) => [x, y0, 0, x, y1, 0]) },
    ]),
  )

/** The strand of the near-plane scene, one curve of two points. */
export const nearStrands = () =>
  parseHairStrands(
    hairStrandsFixture([{ id: 0, radius: NEAR_STRAND.radius, curves: [[...NEAR_STRAND.points]] }]),
  )

/** The camera of the proof. */
export function proofCamera() {
  const cam = createEngineCamera()
  cam.world.set(IDENTITY_MATRIX4)
  cam.world[14] = DISTANCE
  return writeEngineCamera(cam, { fov: 60, aspect: WIDTH / HEIGHT, near: 0.1, far: 100, zoom: 1 })
}

/** What `camera` shows of the scenes in closed form. */
export function closedForm(camera: ReturnType<typeof proofCamera>) {
  const focalX = camera.projection[0]!
  const focalY = camera.projection[5]!
  const pixelSize = pixelSizeAtDepth1(camera.projection, camera.perspective, WIDTH, HEIGHT)
  const perMetre = { x: ((focalX / DISTANCE) * WIDTH) / 2, y: ((focalY / DISTANCE) * HEIGHT) / 2 }
  /** The point of the plane z = 0 a screen point sees. */
  const toPlane = (sx: number, sy: number) => ({
    x: ((sx / (WIDTH / 2) - 1) * DISTANCE) / focalX,
    y: ((1 - sy / (HEIGHT / 2)) * DISTANCE) / focalY,
  })
  return {
    /** The depth of anything in the plane z = 0. */
    depth: camera.projection[14]! / DISTANCE,
    /** The half width of a ribbon drawn for `samples` samples a pixel: its strand's radius, or the
     *  least radius at the distance of its ends from the camera. */
    halfWidth: (ribbon: Ribbon, samples: 1 | 2 | 4 | 8) =>
      Math.max(
        ribbon.radius,
        hairMinRadiusAtDepth1(pixelSize, samples, RASTERIZATION_SCALE) *
          Math.hypot(DISTANCE, ribbon.y1),
      ),
    /** The coverage of a ribbon by the screen point (`sx`, `sy`) when its half width is `half`, and
     *  whether the point is far enough from its edges (in pixels) for the answer to be no float's
     *  rounding. */
    coverage(sx: number, sy: number, ribbon: Ribbon, half: number) {
      const at = toPlane(sx, sy)
      const across = Math.abs(at.x - ribbon.x)
      return {
        covered: across < half && at.y > ribbon.y0 && at.y < ribbon.y1,
        clear:
          Math.abs(across - half) * perMetre.x > 0.02 &&
          Math.min(Math.abs(at.y - ribbon.y0), Math.abs(at.y - ribbon.y1)) * perMetre.y > 0.02,
      }
    },
    /** The share of light a ribbon of one sample a pixel lets through where it covers the pixel
     *  centre: one minus its radius over the radius of a pixel at its distance, at most 1. */
    transmittance: (ribbon: Ribbon) =>
      1 -
      Math.min(
        1,
        ribbon.radius /
          Math.max(
            ribbon.radius,
            hairMinRadiusAtDepth1(pixelSize, 1, RASTERIZATION_SCALE) * DISTANCE,
          ),
      ),
  }
}
export type ClosedForm = ReturnType<typeof closedForm>
