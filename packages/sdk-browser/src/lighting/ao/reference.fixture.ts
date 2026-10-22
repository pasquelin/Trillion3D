// The occlusion's search written a second time, apart from the shader, in plain scalars and arrays, step by step:
// the tests set it against the shipped WGSL run by `shaderRun`, pixel by pixel. Distances are centimetres, as the shader's.
import type { AmbientOcclusionSettings } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { AO_QUALITY_SHAPES, AO_RANDOM_BASIS, AO_SAMPLE_SETS } from './tables.ts'
import { HEIGHT, WIDTH, type createScene } from './scene.fixture.ts'

type Scene = ReturnType<typeof createScene>
type V3 = [number, number, number]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const saturate = (x: number) => Math.min(Math.max(x, 0), 1)
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0)
const unit = (v: V3): V3 => {
  const n = Math.hypot(...v)
  return n > 1e-6 ? (v.map((x) => x / n) as V3) : [0, 0, 1]
}
const NEAR = 0.1
const STORED = 131072
const TAN_HALF = Math.tan((30 * Math.PI) / 180)

/** A device depth as centimetres ahead. */
const cm = (z: number) => Math.min(NEAR / Math.max(z, 1e-30), 1e7) * 100
/** The scene's own depth of a pixel, in centimetres. */
const depthOf = (scene: Scene, x: number, y: number) => cm(scene.device(x, y))
/** The camera's view of a world vector: right, up, and ahead (the camera looks down -z). */
const toView = (n: number[]): V3 => [n[0], n[1], -n[2]]

/** What a pass of the search is run with: its scale, its drawn rectangle and texture, and what it reads. */
export interface RunSpec {
  scale: number
  rect: [number, number]
  extent: [number, number]
  fromSetup: boolean
  last: boolean
  quality: number
  noiseStep: number
  /** The setup texture it reads, and the coarser occlusion to blend in with its texture's and rectangle's size. */
  setup?: (x: number, y: number) => number[]
  setupExtent?: [number, number]
  lower?: {
    value: (x: number, y: number) => number
    extent: [number, number]
    rect: [number, number]
  }
}

/** The setup of a coarser resolution's pixel `(x, y)`: the four surfaces round it, their normals averaged by how near each depth is
 *  to the farthest. */
export function setupTexel(
  scene: Scene,
  scale: number,
  threshold: number,
  [x, y]: [number, number],
) {
  const taps = [-1, 1].flatMap((dy) => [-1, 1].map((dx) => [dx, dy]))
  const reads = taps.map(([dx, dy]) => {
    const px = Math.min(Math.max(Math.floor((x + 0.5) * scale + (dx * scale) / 4), 0), WIDTH - 1)
    const py = Math.min(Math.max(Math.floor((y + 0.5) * scale + (dy * scale) / 4), 0), HEIGHT - 1)
    return { n: unit(scene.normal(px, py).slice(0, 3) as V3), depth: depthOf(scene, px, py) }
  })
  const farthest = Math.max(...reads.map((r) => r.depth))
  let total = [0.0001, 0.0001, 0.0001, 0.0001]
  for (const { n, depth } of reads) {
    const weight = saturate(1 - Math.abs(depth - farthest) * threshold)
    total = total.map((t, i) => t + (i < 3 ? n[i] * 0.5 + 0.5 : 1) * weight)
  }
  return [total[0] / total[3], total[1] / total[3], total[2] / total[3], farthest / STORED]
}

/** What the samples of a pixel read: the lifted point and the screen's frame round it, the noise-turned directions and the normal's scaled form. */
interface Frame {
  lens: number[]
  lifted: number[]
  centre: number[]
  turn: number[]
  scaled: number[]
}

/** The share of the sky the samples of the pixel leave, from the horizon each finds either side of it. */
function samplesOf(scene: Scene, shape: (typeof AO_QUALITY_SHAPES)[number], set: 1 | 3, f: Frame) {
  let [num, den] = [0.0001, 0.0001]
  for (const [ox, oy] of AO_SAMPLE_SETS[set]) {
    // The sample's direction on the screen: its offset turned by the noise.
    const direction = [ox * f.turn[0] + oy * f.turn[2], ox * f.turn[1] + oy * f.turn[3]]
    let horizon = [0, 0]
    for (let k = 1; k <= shape.steps; k++) {
      const fraction = k / shape.steps
      const sides = [1, -1].map((sign) => {
        const at = f.centre.map((c, i) => c + sign * fraction * direction[i])
        const z = farthestDepth(scene, at)
        const delta = [
          (at[0] * z - f.lifted[0]) / f.lens[0],
          (at[1] * z - f.lifted[1]) / f.lens[1],
          z - f.lifted[2],
        ]
        return saturate(dot(delta, f.scaled) / dot(delta, delta))
      })
      horizon = [Math.max(horizon[0], sides[0]), Math.max(horizon[1], sides[1])]
    }
    num += (1 - horizon[0]) ** 2 + (1 - horizon[1]) ** 2
    den += 2
  }
  return num / den
}

/** The occlusion of pixel `(x, y)` of a pass: the search, its blend with the coarser result, and, in the last pass, the
 *  fade, the power and the intensity — before any blur among the quad. */
export function searchOf(
  scene: Scene,
  s: AmbientOcclusionSettings,
  run: RunSpec,
  [x, y]: [number, number],
) {
  const shape = AO_QUALITY_SHAPES[run.quality]
  const own = run.fromSetup ? run.setup!(x, y) : undefined
  const depth = own ? own[3] * STORED : depthOf(scene, x, y)
  const world = own
    ? [own[0] * 2 - 1, own[1] * 2 - 1, own[2] * 2 - 1]
    : scene.normal(x, y).slice(0, 3)
  const view = unit(toView(world))
  const ndc = [((x + 0.5) / run.rect[0]) * 2 - 1, 1 - ((y + 0.5) / run.rect[1]) * 2]
  const fadeRadius = Math.max(1, s.fadeRadiusCm)
  const fade = saturate(depth / fadeRadius - (s.fadeDistanceCm - fadeRadius) / fadeRadius)
  let value = 1
  if (run.last ? fade < 1 : true) {
    const lens = [1 / ((WIDTH / HEIGHT) * TAN_HALF), 1 / TAN_HALF, 1]
    const base = s.radiusInWorldSpace ? s.radiusCm : s.radiusCm / 400
    const radius = (base * s.mipScale ** Math.log2(run.scale)) / 4
    const ws = +s.radiusInWorldSpace
    // The point lifted off its surface along the normal, in the space of a screen position times the depth.
    const lifted = [ndc[0] * depth, ndc[1] * depth, depth].map(
      (v, i) => v + (s.bias / 1000) * depth * run.scale * view[i] * lens[i],
    )
    const [tx, ty] = noiseOf(x, y, run.noiseStep)
    const reach = lerp(depth, 1, ws) * radius
    // The noise's direction and its quarter turn, each scaled by the lens over the lifted depth.
    const fx = lens[0] / lifted[2]
    const fy = lens[1] / lifted[2]
    const frame: Frame = {
      lens,
      lifted,
      centre: [lifted[0] / lifted[2], lifted[1] / lifted[2]],
      turn: [tx * reach * fx, ty * reach * fy, -ty * reach * fx, tx * reach * fy],
      scaled: view.map((v) => v * 0.08 * lerp(depth, 1000, ws)),
    }
    value = samplesOf(scene, shape, run.fromSetup ? 3 : shape.sampleSet, frame)
    if (run.lower) value = lerp(value, blendCoarse(run, [x, y], depth, world), s.mipBlend)
    if (run.last) {
      value = lerp(value, 1, fade)
      value = 1 - (1 - Math.abs(value) ** s.power) * s.intensity
    }
  }
  return { value, depth, normal: [view[0], view[1]] }
}

/** The noise's direction for pixel `(x, y)`, as the sixteen of a 4 × 4 block hold it. */
function noiseOf(x: number, y: number, step: number) {
  const tx = Math.floor(x + 0.5 + step * 2.48)
  const ty = Math.floor(y + 0.5 + step * 7.52)
  return AO_RANDOM_BASIS[(tx & 3) + 4 * (ty & 3)]
}

/** The depth, in centimetres, of the pyramid's first level under a screen position (-1 to 1, y up). */
function farthestDepth(scene: Scene, ndc: number[]) {
  const px = (ndc[0] * 0.5 + 0.5) * WIDTH
  const py = (0.5 - ndc[1] * 0.5) * HEIGHT
  return cm(scene.farthest(Math.floor(px / 2), Math.floor(py / 2)))
}

/** The coarser result at a pixel: the mean of the taps of the coarser texture, each weighed by its depth's nearness and its
 *  normal's likeness (nine taps for a pass that reads the setup, four for the last). */
function blendCoarse(run: RunSpec, [x, y]: [number, number], depth: number, normal: number[]) {
  const lower = run.lower!
  const taps = run.fromSetup
    ? [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy]))
    : [
        [-0.5, 0.5],
        [0.5, 0.5],
        [-0.5, -0.5],
        [0.5, -0.5],
      ]
  let [num, den] = [0.0001, 0.0001]
  for (const [dx, dy] of taps) {
    const u = ((x + 0.5) / run.extent[0] + dx / lower.extent[0]) * lower.extent[0]
    const v = ((y + 0.5) / run.extent[1] + dy / lower.extent[1]) * lower.extent[1]
    const tx = Math.min(Math.max(u, 0.5), lower.rect[0] - 0.5)
    const ty = Math.min(Math.max(v, 0.5), lower.rect[1] - 0.5)
    const near = run.setup!(
      Math.floor((tx / lower.extent[0]) * run.setupExtent![0]),
      Math.floor((ty / lower.extent[1]) * run.setupExtent![1]),
    )
    const similar = saturate(1 - Math.abs(near[3] * STORED - depth) * 0.003)
    const weight =
      similar * saturate(dot([near[0] * 2 - 1, near[1] * 2 - 1, near[2] * 2 - 1], normal))
    num += lower.value(Math.floor(tx), Math.floor(ty)) * weight
    den += weight
  }
  return num / den
}

/** The blur among a quad: a pixel keeps itself and takes its two neighbours of the quad, by the likeness of their normals. */
export function quadBlur(
  own: { value: number; normal: number[] },
  x: number,
  y: number,
  at: (x: number, y: number) => { value: number; normal: number[] },
) {
  const face = (n: number[]) => [n[0], n[1], Math.sqrt(Math.max(1 - n[0] * n[0] - n[1] * n[1], 0))]
  const sides = [at(x ^ 1, y), at(x, y ^ 1)]
  const weights = sides.map((side) =>
    saturate(saturate(dot(face(own.normal), face(side.normal))) ** 4),
  )
  return (
    (own.value + weights[0] * sides[0].value + weights[1] * sides[1].value) /
    (1 + weights[0] + weights[1])
  )
}

/** A float32, as a GPU holds one; the sum and the product of two, rounded once each. */
const f32 = Math.fround
/** The byte a value of `[-1, 1]` is stored as: halved, shifted and rounded to nearest, in single precision. */
const byteOf = (x: number) => Math.trunc(f32(f32(f32(f32(x * 0.5) + 0.5) * 255) + 0.5))

/**
 * The sixteen byte pairs of the noise block derived, in single precision, as the notes lay it out: the block's
 * rotation basis in a fixed order over half a turn, each scaled down by a share that varies with its rank, stored one
 * byte a channel. The tables hold them written out (`AO_NOISE_BYTES`); the test sets the two together.
 */
export const referenceNoiseBytes = () =>
  [0, 11, 7, 3, 10, 4, 15, 12, 6, 8, 1, 14, 13, 2, 9, 5].map((rank) => {
    const angle = f32(f32(rank * (1 / 16)) * Math.PI)
    const wobble = f32(Math.sin(f32(f32(198 * rank) * 0.01)))
    const length = f32(1 - f32(f32(f32(f32(wobble * 0.5) + 0.5) * 23) * 0.01))
    return [byteOf(f32(f32(Math.cos(angle)) * length)), byteOf(f32(f32(Math.sin(angle)) * length))]
  })
