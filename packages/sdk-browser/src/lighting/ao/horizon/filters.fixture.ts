// The horizon search's filters written a second time, apart from the shaders (`reference.fixture.ts`): the spatial filter, the
// temporal filter and the upsample, in plain scalars and arrays, from the steps themselves.
import { clamp, fract, lerp, saturate } from '../../../../../math/src/scalar/reals.ts'
import { HEIGHT, WIDTH } from '../scene.fixture.ts'
import { pixelOf, type Scene, type Settings } from './reference.fixture.ts'

export type Texels = number[][]

/** A texture read where it is drawn, zero outside. */
export const readOr0 = (texels: Texels, w: number, h: number) => (x: number, y: number) =>
  x < 0 || y < 0 || x >= w || y >= h ? 0 : texels[y][x]

/** The spatial filter of the pixel `(x, y)`: the plane the neighbours' depths make (`c + dx · i + dy · j` at the offset `(i, j)`),
 *  the mean of the square weighed by each texel's distance to it, raised to the power and weighed by the intensity. */
export function spatialOf(
  scene: Scene,
  s: Settings,
  scale: number,
  ao: (x: number, y: number) => number,
  [x, y]: number[],
) {
  const z = (px: number, py: number) =>
    px < 0 || py < 0 || px * scale >= WIDTH || py * scale >= HEIGHT
      ? 0
      : scene.device(px * scale, py * scale)
  const slope = (m2: number, m1: number, c: number, p1: number, p2: number) =>
    Math.abs(m1 + (m1 - m2) - c) < Math.abs(p1 + (p1 - p2) - c) ? m1 - m2 : p2 - p1
  const c = z(x, y)
  const dx = slope(z(x - 2, y), z(x - 1, y), c, z(x + 1, y), z(x + 2, y))
  const dy = slope(z(x, y - 2), z(x, y - 1), c, z(x, y + 1), z(x, y + 2))
  const { filterFirst: first, filterLast: last } = s.horizon
  let sum = 0
  let weights = 0
  for (let j = first; j <= last; j++)
    for (let i = first; i <= last; i++) {
      const weight = 1 - saturate(Math.abs(c + dx * i + dy * j - z(x + i, y + j)) * 20000)
      sum += ao(x + i, y + j) * weight
      weights += weight
    }
  // Held from 0 to 1 as the shipped filter's target holds it.
  return saturate(
    1 - (1 - Math.abs((sum / weights) * (Math.PI / 2)) ** (s.power * 0.5)) * s.intensity,
  )
}

/** A linear read of a texture of `size`, at a position of the picture, the position held within its edge texels. */
function linear(read: (x: number, y: number) => number, size: number[], uv: number[]) {
  const q = [uv[0] * size[0] - 0.5, uv[1] * size[1] - 0.5]
  const f = q.map(Math.floor)
  const w = [q[0] - f[0], q[1] - f[1]]
  const at = (dx: number, dy: number) =>
    read(clamp(f[0] + dx, 0, size[0] - 1), clamp(f[1] + dy, 0, size[1] - 1))
  return lerp(lerp(at(0, 0), at(1, 0), w[0]), lerp(at(0, 1), at(1, 1), w[0]), w[1])
}

/** A vector of motion as the velocity stage codes it: a word of two companded 16-bit halves, the low bit saying that the texel's
 *  surface moves by itself. */
export function encodeMotion([x, y]: number[], own: boolean) {
  const half = (v: number) => {
    const g = Math.sign(v) * Math.sqrt(Math.abs(v)) * (2 / Math.SQRT2)
    return clamp(Math.trunc((g * (0.499 * 0.5) + 32767 / 65535) * 65535 + 0.5), 0, 65535)
  }
  return (((half(x) | (half(y) << 16)) & ~1) | +own) >>> 0
}

/** The vector a word holds. */
function decodeMotion(word: number) {
  return [word & 0xffff, word >>> 16].map((u) => {
    const g = u / 65535 / (0.499 * 0.5) - 32767 / 65535 / (0.499 * 0.5)
    return g * Math.abs(g) * 0.5
  })
}

/** What the temporal filter reads beside the last pass: the history, its rectangle, where this image's clip positions fell in the
 *  last, and, where the velocity stage measured the image, the word of motion at a pixel. */
interface TemporalInputs {
  history: (x: number, y: number) => number
  historyRect: number[]
  clip: number[]
  vectors?: (x: number, y: number) => number
}

/** The temporal filter of the pixel `(x, y)`: this image's value, and the history where the point was, each texel held about it. */
export function temporalOf(
  scene: Scene,
  s: Settings,
  scale: number,
  input: (x: number, y: number) => number,
  t: TemporalInputs,
  [x, y]: number[],
) {
  const rect = [WIDTH / scale, HEIGHT / scale]
  const uv = [(x + 0.5) / rect[0] + 0.125 / WIDTH, (y + 0.5) / rect[1] + 0.125 / HEIGHT]
  // The point in the last image: the camera's own motion with the point's depth, or, where the pixel moves by itself, its vector.
  const reproject = (at: number[], z: number) => {
    const ndc = [at[0] * 2 - 1, 1 - at[1] * 2]
    const v = [ndc[0], ndc[1], z, 1]
    const prev = [0, 1, 2, 3].map((r) => v.reduce((sum, c, k) => sum + t.clip[k * 4 + r] * c, 0))
    let screen = [prev[0] / prev[3], prev[1] / prev[3]]
    if (t.vectors) {
      const [px, py] = pixelOf(at)
      const word = t.vectors(px, py)
      if (word & 1) screen = ndc.map((c, i) => c - decodeMotion(word)[i])
    }
    return [screen[0] * 0.5 + 0.5, 0.5 - screen[1] * 0.5]
  }
  const depthAt = (at: number[]) => scene.device(...(pixelOf(at) as [number, number]))
  const current = linear(input, rect, uv)
  const before = reproject(uv, depthAt(uv))
  const moved = [uv[0] - before[0], uv[1] - before[1]]
  const again = reproject(before, depthAt(before.map(fract)))
  const behind = [before[0] - again[0], before[1] - again[1]]
  const alike = 1 - saturate(Math.abs(moved[0] - behind[0] + (moved[1] - behind[1])) * 100)
  const range = lerp(0.1, 0, saturate(Math.hypot(...moved) * 100))
  const low = saturate(current - range)
  const high = saturate(current + range)
  const [hw, hh] = t.historyRect
  // A texel outside the history's rectangle reads white (the border of the sampler it is read through), held to the range like the rest.
  const held = (tx: number, ty: number) =>
    clamp(tx < 0 || ty < 0 || tx >= hw || ty >= hh ? 1 : t.history(tx, ty), low, high)
  const q = [before[0] * hw - 0.5, before[1] * hh - 0.5]
  const [fx, fy] = q.map(Math.floor)
  const w = [q[0] - fx, q[1] - fy]
  const there =
    held(fx, fy) * (1 - w[0]) * (1 - w[1]) +
    held(fx + 1, fy) * w[0] * (1 - w[1]) +
    held(fx, fy + 1) * (1 - w[0]) * w[1] +
    held(fx + 1, fy + 1) * w[0] * w[1]
  return lerp(lerp(held(x, y), there, alike), current, s.horizon.blend)
}

/** The upsample of the pixel `(x, y)`: the least of four linear reads a quarter of a texel off, finished — where the spatial filter
 *  is off — as the spatial filter would: taken back to one, raised to the power and weighed by the intensity. */
export function upsampleOf(
  s: Settings,
  scale: number,
  input: (x: number, y: number) => number,
  [x, y]: number[],
) {
  const uv = [(x + 0.5) / WIDTH, (y + 0.5) / HEIGHT]
  const size = [WIDTH / scale, HEIGHT / scale]
  const reads = [-1, 1].flatMap((sy) =>
    [-1, 1].map((sx) =>
      saturate(linear(input, size, [uv[0] + (sx * 0.25) / size[0], uv[1] + (sy * 0.25) / size[1]])),
    ),
  )
  const least = Math.min(...reads)
  if (s.horizon.spatial) return least
  return 1 - (1 - Math.abs(least * (Math.PI / 2)) ** (s.power * 0.5)) * s.intensity
}
