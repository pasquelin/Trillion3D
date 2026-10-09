// The reflection's shipped WGSL over synthetic views, for its tests: the depth pyramid a march
// reads, built from any depth image (`depthField`) by the Hi-Z build's own first pass and the
// Hi-Z oracle's reductions; a camera and opaque boxes rasterized into a reversed depth, beside an
// exact ray cast of the same boxes; and the shipped `reflectionSeen` and march run in JavaScript
// over them (`reflectionRunner`).
import { Mat, shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { HIZ_SHADER, HIZ_NEAREST_BUILD } from '../gpu/hiz/shader.ts'
import { pyramidBytes } from '../gpu/hiz/oracle.ts'
import { HIZ_NEAREST, HIZ_ROW, hizLevelWords } from '../gpu/hiz/pyramidTexture.ts'
import { hizReduceCeil, hizReduceNearestCeil } from '../../../sdk-core/src/hiz/oracles.fixture.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'

export type V3 = [number, number, number]
export type Box = { low: V3; high: V3 }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a)
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** Where the ray `o + d·t`, t > `from`, enters `box`, `from` when it starts inside, or Infinity. */
export function rayBox(o: V3, d: V3, box: Box, from = 0) {
  let near = -Infinity,
    far = Infinity
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < box.low[k] || o[k] > box.high[k]) return Infinity
      continue
    }
    const a = (box.low[k] - o[k]) / d[k],
      b = (box.high[k] - o[k]) / d[k]
    near = Math.max(near, Math.min(a, b))
    far = Math.min(far, Math.max(a, b))
  }
  if (near > far || far <= from) return Infinity
  return Math.max(near, from)
}

/** The first of `boxes` the ray meets, and which. */
export function castBoxes(o: V3, d: V3, boxes: Box[], from = 0) {
  let t = Infinity,
    index = -1
  boxes.forEach((box, k) => {
    const at = rayBox(o, d, box, from)
    if (at < t) {
      t = at
      index = k
    }
  })
  return { t, index }
}

/**
 * A reversed infinite perspective of vertical field `fov` from `eye` toward `target`, `width ×
 * height` pixels, near plane `near`: its column-major view-projection and inverse, the world size
 * of a pixel at a unit clip `w`, a point's projection (pixel x, y, depth, clip w) and the eye's
 * ray through a pixel point.
 */
export function camera(
  eye: V3,
  target: V3,
  width: number,
  height: number,
  fov = Math.PI / 3,
  near = 0.1,
) {
  const f = norm(sub(target, eye)),
    r = norm(cross(f, [0, 1, 0])),
    u = cross(r, f)
  const F = 1 / Math.tan(fov / 2),
    a = width / height
  const rows = [
    [...r.map((x) => (F / a) * x), (-F / a) * dot(r, eye)],
    [...u.map((x) => F * x), -F * dot(u, eye)],
    [0, 0, 0, near],
    [...f, -dot(f, eye)],
  ]
  const m = new Float64Array(16)
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) m[col * 4 + row] = rows[row][col]
  const project = (p: V3) => {
    const c = [0, 1, 2, 3].map(
      (row) => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row],
    )
    return [
      ((c[0] / c[3]) * 0.5 + 0.5) * width,
      (-(c[1] / c[3]) * 0.5 + 0.5) * height,
      c[2] / c[3],
      c[3],
    ]
  }
  const ray = (x: number, y: number): V3 => {
    const nx = (x / width) * 2 - 1,
      ny = 1 - (y / height) * 2
    return norm([0, 1, 2].map((k) => f[k] + (nx * a * r[k] + ny * u[k]) / F) as V3)
  }
  return {
    eye,
    forward: f,
    m,
    inverse: invertMatrix4(new Float64Array(16), m),
    project,
    ray,
    width,
    height,
    near,
    scale: 2 / (height * F),
  }
}
export type Camera = ReturnType<typeof camera>

/** The face of `box` the point `p` on it lies on: 2 · axis, + 1 on its high side. */
function faceOf(box: Box, p: V3) {
  let face = 0,
    best = Infinity
  for (let k = 0; k < 3; k++)
    for (const [side, bound] of [box.low[k], box.high[k]].entries()) {
      const off = Math.abs(p[k] - bound)
      if (off < best) {
        best = off
        face = 2 * k + side
      }
    }
  return face
}

/** The reversed depth of `boxes` at each pixel centre, near / w, 0 on the background, and which
 *  plane each pixel shows: a box's face, 6 · box + face (-1 none). */
export function rasterize(view: Camera, boxes: Box[]) {
  const depth = new Float64Array(view.width * view.height)
  const shown = new Int32Array(view.width * view.height)
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      const d = view.ray(x + 0.5, y + 0.5),
        { t, index } = castBoxes(view.eye, d, boxes)
      depth[y * view.width + x] = Number.isFinite(t) ? view.near / (t * dot(d, view.forward)) : 0
      shown[y * view.width + x] =
        index < 0
          ? -1
          : 6 * index + faceOf(boxes[index], [0, 1, 2].map((k) => view.eye[k] + d[k] * t) as V3)
    }
  return { depth, shown }
}

const WORD = new Float32Array(1),
  BITS = new Uint32Array(WORD.buffer)
/** A depth as the pyramid holds it: its `f32` bits. */
const bitsOf = (value: number) => ((WORD[0] = value), BITS[0])

/**
 * The depth pyramid a march reads of the `width × height` depth image `depth`, at the packed
 * indices the Hi-Z lays (`pyramidBytes`), each texel made the first time a march reads it (and the
 * finer ones it covers before it): level 0 of the nearest layer by the shipped build's first pass
 * (`hizSource`, its plane's slopes and nearest corner), the coarser texels of both layers by the
 * oracle's reductions (`hizReduceCeil`, `hizReduceNearestCeil`). `word` is the texel the shipped
 * readers load (`hizTexel`'s place, a layer); `levels` the levels uniform.
 */
export function depthField(width: number, height: number, depth: ArrayLike<number>) {
  const { sizes, offsets, texels } = pyramidBytes(width, height)
  const made = [0, 1].map(() => new Float64Array(texels).fill(NaN))
  const slopes = new Uint32Array(width * height)
  const level0 = {}
  const build = shaderRun<{
    hizSource: (at: number, origin: number[], x: number, y: number) => number
  }>(
    HIZ_SHADER,
    [
      'hizSource',
      'hizPlaneNearest',
      'hizDepthAt',
      'surfaceSlopeOf',
      'hizLayer',
      'hizLoad',
      'hizTexel',
    ],
    {
      [HIZ_NEAREST_BUILD]: true,
      uni: { a: 0, b: width, c: height },
      level0,
      textureLoad: (_: object, p: number[]) => [Math.fround(depth[p[1] * width + p[0]])],
      hizPut: (i: number, _: number, word: number) => void (slopes[i] = word),
    },
  )
  /** The texel at `x, y` of `level` of `layer`, as a depth. */
  function cell(layer: number, level: number, x: number, y: number): number {
    const at = offsets[level] + y * sizes[level][0] + x
    if (Number.isNaN(made[layer][at])) {
      if (level === 0)
        made[layer][at] = layer
          ? Math.fround(build.hizSource(0, [0, 0], x, y))
          : Math.fround(depth[y * width + x])
      else {
        const [w, h] = sizes[level - 1],
          square: number[][] = []
        for (let v = 2 * y; v < Math.min(2 * y + 2, h); v++) {
          const row: number[] = []
          for (let u = 2 * x; u < Math.min(2 * x + 2, w); u++)
            row.push(cell(layer, level - 1, u, v))
          square.push(row)
        }
        made[layer][at] = Math.fround((layer ? hizReduceNearestCeil : hizReduceCeil)(square)[0][0])
      }
    }
    return made[layer][at]
  }
  const words = hizLevelWords(sizes, offsets)
  return {
    width,
    height,
    levels: {
      level: Array.from({ length: words.length / 4 }, (_, k) => [
        ...words.subarray(k * 4, k * 4 + 4),
      ]),
    },
    /** The word at texel `p` of `layer`: a depth's bits, or a pixel's slopes. */
    word(p: number[], layer: number) {
      const i = p[1] * HIZ_ROW + p[0]
      let level = 0
      while (level + 1 < sizes.length && offsets[level + 1] <= i) level++
      const [w] = sizes[level],
        x = (i - offsets[level]) % w,
        y = Math.floor((i - offsets[level]) / w)
      if (layer === HIZ_NEAREST && level === 0) return (cell(layer, 0, x, y), slopes[i])
      return bitsOf(cell(layer, level, x, y))
    },
    /** The depth level 0 holds at `p`. */
    depthAt: (p: number[]) => Math.fround(depth[p[1] * width + p[0]]),
  }
}
export type DepthField = ReturnType<typeof depthField>

type Seen = { color: number[]; fade: number }
type ReflectionView = {
  viewProj: Mat
  inverseViewProj: Mat
  radianceViewProj: Mat
  camera: number[]
  screen: number[]
  radiance: number[]
  counts: number[]
  display: number[]
  surroundings: number[]
}
/** The view uniform of a still view `view`: the radiance image is the depth's own. */
export function viewOf(
  m: Iterable<number>,
  inverse: Iterable<number>,
  eye: number[],
  size: number[],
  scale: number,
): ReflectionView {
  return {
    viewProj: new Mat([...m]),
    inverseViewProj: new Mat([...inverse]),
    radianceViewProj: new Mat([...m]),
    camera: eye,
    screen: [size[0], size[1], scale, 0],
    radiance: [size[0], size[1], Math.ceil(Math.log2(Math.max(size[0], size[1]))), 0],
    counts: [1, 0, 0, 0],
    display: [0, 0, 0, 1],
    surroundings: [0, 0, 0, 0],
  }
}

/**
 * The shipped reflection functions over the depth `depth` and the view uniform `reflectionView`:
 * a read of the radiance image gives, as its colour, the point it reads and the level,
 * `[x, y, level, 1]` — the footprint's reads average them, their weights' sum one —; `counter`
 * counts the cells the march reads (one load of the nearest layer each: a cell's nearest, or a
 * pixel's slopes) and lists the reads; `overrides` stand in for shipped functions.
 */
export function reflectionRunner(
  depth: DepthField,
  reflectionView: ReflectionView,
  overrides: object = {},
) {
  const counter = { loads: 0, taps: [] as number[][] }
  const token = { depth: {}, pyramid: {}, radiance: {} }
  const run = shaderRun<{
    reflectionSeen: (P: V3, N: V3, R: V3, alpha: number, lobe: number[]) => Seen
    reflectionMarch: (o: number[], d: number[], end: number) => { t: number; depth: number }
    reflectionScreenEnd: (o: number[], d: number[], size: number[]) => number
    reflectionFootprint: (
      Q: number[],
      hit: V3,
      P: V3,
      R: V3,
      pixel: number,
      alpha: number,
      lobe: number[],
    ) => number[]
  }>(
    wgslModule(reflectedRadianceWgsl(1)),
    [
      'reflectionSeen',
      'reflectionFootprint',
      'reflectionRadianceAt',
      'reflectionLevelRead',
      'reflectionMarch',
      'hizPlane',
      'hizCell',
      'hizLevelCount',
      'hizFarthest',
      'hizNearest',
      'hizTexel',
      'reflectionScreenEnd',
      'reflectionSlabBack',
      'reflectionToEye',
      'reflectionThickness',
      'reflectionWorldAt',
      'reflectionThicknessFade',
      'reflectionEdgeFade',
      'reflectionConeTangent',
    ].filter((name) => !(name in overrides)),
    {
      reflectionView,
      hizDepth: token.depth,
      hizPyramid: token.pyramid,
      hizLevels: depth.levels,
      reflectionRadiance: token.radiance,
      reflectionSampler: {},
      ReflectionSeen: (color: number[], fade: number) => ({ color, fade }),
      ReflectionHit: (t: number, at: number) => ({ t, depth: at }),
      textureDimensions: () => [reflectionView.radiance[0], reflectionView.radiance[1]],
      textureLoad: (t: object, cell: number[], layer: number) => {
        if (t === token.depth) return [depth.depthAt(cell)]
        if (layer === HIZ_NEAREST) counter.loads++
        return [depth.word(cell, layer)]
      },
      textureSampleLevel: (_: unknown, __: unknown, uv: number[], level: number) => {
        const tap = [
          uv[0] * reflectionView.radiance[0],
          uv[1] * reflectionView.radiance[1],
          level,
          1,
        ]
        counter.taps.push(tap)
        return tap
      },
      ...overrides,
    },
  )
  return { ...run, counter }
}

/** A still view of `boxes` from `view`: its depth, which box each pixel shows, and the shipped
 *  reflection over it. */
export function sceneOver(view: Camera, boxes: Box[]) {
  const { depth, shown } = rasterize(view, boxes)
  const runner = reflectionRunner(
    depthField(view.width, view.height, depth),
    viewOf(view.m, view.inverse, [...view.eye, 1], [view.width, view.height], view.scale),
  )
  return { depth, shown, ...runner }
}
