// A small synthetic view for the occlusion's tests: a floor and a wall met at a right angle (a concave corner),
// the depth the engine would draw (reversed, `near / distance`), its surfaces' normals and the farthest-depth
// pyramid's first level, with the uniform a pass reads and the functions the shader's bindings stand for (`sceneScope`).
// No GPU: `shaderRun` runs the shipped WGSL against them.
import { hizCellSpan } from '../../../../sdk-core/src/hiz/oracles.fixture.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { perspectiveProjection } from '../../../../math/src/projection/camera.ts'
import { AO_PARAMS } from './layout.ts'
import { aoPasses } from './plan.ts'
import { createDepthTerms, writeAoParams, type AoImage } from './params.ts'
import { resolveAmbientOcclusion } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import {
  AMBIENT_OCCLUSION_RULES,
  type AmbientOcclusionOptions,
} from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'

export const WIDTH = 64
export const HEIGHT = 36
const NEAR = 0.1
const FOV_DEGREES = 60
export const FOV_HALF_TAN = Math.tan((FOV_DEGREES / 2 / 180) * Math.PI)
export const ASPECT = WIDTH / HEIGHT

/** A device depth (near over distance) as centimetres ahead. */
export const cm = (z: number) => Math.min(NEAR / Math.max(z, 1e-30), 1e7) * 100

/** What the view holds: a floor at `floor` metres under the eye and a wall `wall` metres ahead, or an open sky. */
export interface Geometry {
  floor?: number
  wall?: number
  /** A box's front face `box` metres ahead over the middle third of the picture, in front of the wall. */
  box?: number
}

/** The ray of pixel `(x, y)`'s centre: its direction with a unit distance ahead (the camera looks down -z). */
const rayOf = (x: number, y: number) => [
  (((x + 0.5) / WIDTH) * 2 - 1) * FOV_HALF_TAN * ASPECT,
  (1 - ((y + 0.5) / HEIGHT) * 2) * FOV_HALF_TAN,
]

/** The view depth (metres ahead) of the nearest surface of pixel `(x, y)`, and its world normal. */
function surfaceAt(geometry: Geometry, x: number, y: number) {
  const [dx, dy] = rayOf(x, y)
  let depth = Infinity
  let normal = [0, 0, 0]
  const consider = (distance: number, n: number[]) => {
    if (distance > 0 && distance < depth) [depth, normal] = [distance, n]
  }
  if (geometry.floor !== undefined && dy < 0) consider(-geometry.floor / dy, [0, 1, 0])
  if (geometry.wall !== undefined) consider(geometry.wall, [0, 0, 1])
  const box = geometry.box
  if (box !== undefined && Math.abs(dx * box) < 1 && Math.abs(dy * box) < 0.8)
    consider(box, [0, 0, 1])
  return { depth, normal }
}

/** The surfaces of a view: their device depths, normals, and the pyramid's first level. */
export function createScene(geometry: Geometry) {
  const surfaces = Array.from({ length: WIDTH * HEIGHT }, (_, i) =>
    surfaceAt(geometry, i % WIDTH, Math.floor(i / WIDTH)),
  )
  const at = (x: number, y: number) =>
    surfaces[clamp(y, 0, HEIGHT - 1) * WIDTH + clamp(x, 0, WIDTH - 1)]
  const device = (x: number, y: number) => NEAR / at(x, y).depth
  return {
    surfaceAt: at,
    device,
    /** The farthest depth (the smallest device depth) of the cell `(x, y)` of the pyramid's level `level` from 1 up: a block of
     *  `2^level` pixels a side, the last cell of a level covering the image's edge and its last two pixels (`hizCellSpan`). */
    farthest: (x: number, y: number, level = 1) => {
      const block = 2 ** level
      const [cx, cy] = [
        clamp(x, 0, Math.ceil(WIDTH / block) - 1),
        clamp(y, 0, Math.ceil(HEIGHT / block) - 1),
      ]
      const [x0, x1] = hizCellSpan(cx, level, WIDTH)
      const [y0, y1] = hizCellSpan(cy, level, HEIGHT)
      let nearest = Infinity
      for (let py = y0; py < y1; py++)
        for (let px = x0; px < x1; px++) nearest = Math.min(nearest, device(px, py))
      return nearest
    },
    normal: (x: number, y: number) => [...at(x, y).normal, 0.5],
  }
}

/** The settings of a view, resolved from options over the defaults. */
export const settingsOf = (options: AmbientOcclusionOptions = {}) =>
  resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, options))

/** The image the passes are told of: this view, a camera at the origin looking down -z, the engine's perspective projection. */
export function imageOf(noiseIndex = 0): AoImage {
  const projection = perspectiveProjection(new Float64Array(16), FOV_DEGREES, ASPECT, NEAR, 1)
  const world = new Float64Array(16)
  world[0] = world[5] = world[10] = world[15] = 1
  return {
    view: [WIDTH, HEIGHT],
    extent: [WIDTH, HEIGHT],
    projection,
    world,
    perspective: true,
    noiseIndex,
    frame: noiseIndex,
    viewProjection: new Float64Array(16),
    historyCut: false,
    before: undefined,
    accumulates: false,
  }
}

/** The uniform of pass `at` of a plan of `levels` as the shader reads it: each `vec4f` an array, by name. */
export function uniformOf(
  levels: number,
  at: number,
  settings = settingsOf(),
  image = imageOf(),
  smooth = false,
) {
  const words = new Float32Array(AO_PARAMS.words)
  writeAoParams(words, aoPasses(levels, smooth)[at], settings, image, createDepthTerms())
  return Object.fromEntries(
    Object.entries(AO_PARAMS.at).map(([name, word]) => [
      name,
      Array.from(words.slice(word, word + 4)),
    ]),
  )
}

/** What the textures a pass reads hold, besides the surfaces and the pyramid: the setup texture's texels (rgba,
 *  rows of `width`) and the coarser occlusion's value at a texel — the horizon search's: the last pass's result, the
 *  history, and the vectors of motion, each as a word at a texel. */
export interface Textures {
  setup?: { texels: Float32Array; width: number }
  lower?: (x: number, y: number) => number
  input?: (x: number, y: number) => number
  history?: (x: number, y: number) => number
  vectors?: (x: number, y: number) => number
}

/** The pyramid's and the textures' reads, the names the shader's bindings carry, over `scene`, with `view` the pass's uniform. */
export function sceneScope(
  scene: ReturnType<typeof createScene>,
  view: object,
  textures: Textures = {},
) {
  const { setup, lower, input, history, vectors } = textures
  return {
    view,
    hizOpaqueDepth: ([x, y]: number[]) => scene.device(x, y),
    hizCellCullFarthest: ([x, y]: number[], level: number) => scene.farthest(x, y, level),
    hizLevelCount: () => 5,
    // The pyramid's levels: the first holds the drawn size (the width and height in its second and third words).
    hizLevels: { level: [[0, WIDTH, HEIGHT, 0]], count: [5, 0, 0, 0] },
    textureLoad: (texture: string, [x, y]: number[]) => {
      if (texture === 'normals') return scene.normal(x, y)
      if (texture === 'lower') return [lower ? lower(x, y) : 0, 0, 0, 1]
      if (texture === 'aoIn') return [input ? input(x, y) : 0, 0, 0, 1]
      if (texture === 'historyTex') return [history ? history(x, y) : 0, 0, 0, 1]
      if (texture === 'vectors') return [vectors ? vectors(x, y) : 0, 0, 0, 0]
      const at = setup ? 4 * (y * setup.width + x) : 0
      return setup ? Array.from(setup.texels.slice(at, at + 4)) : [0, 0, 0, 0]
    },
    normals: 'normals',
    setupTex: 'setup',
    lowerAo: 'lower',
    aoIn: 'aoIn',
    historyTex: 'historyTex',
    vectors: 'vectors',
  }
}
