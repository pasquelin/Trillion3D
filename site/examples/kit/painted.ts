import type { Families, Vec3 } from './engineTypes.ts'
import { mix } from './opening.ts'
import { saturate } from '../../../packages/math/src/scalar/reals.ts'
import { unorm8 } from '../../../packages/math/src/color/color.ts'

/** The side of every painted picture, in pixels. */
const SIZE = 256

/** A square picture painted on a canvas, pixel by pixel: `pixel` writes the four bytes of each,
 *  red, green, blue and alpha, into `data` from `offset`. */
function painted(
  { texture }: Families<'texture'>,
  pixel: (px: number, py: number, data: Uint8ClampedArray, offset: number) => void,
) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const context = canvas.getContext('2d') as CanvasRenderingContext2D,
    image = context.createImageData(SIZE, SIZE)
  for (let py = 0; py < SIZE; py++)
    for (let px = 0; px < SIZE; px++) pixel(px, py, image.data, (py * SIZE + px) * 4)
  context.putImageData(image, 0, 0)
  return texture.canvas(canvas)
}

/** A leaf picture: green inside an almond outline with a darker midrib, see-through outside it. */
export function leafTexture(engine: Families<'texture'>) {
  return painted(engine, (px, py, data, offset) => {
    const along = py / SIZE,
      across = Math.abs(px / SIZE - 0.5)
    const width = 0.42 * Math.sin(Math.PI * along) ** 0.8,
      rib = across < 0.012 && along > 0.05 && along < 0.9
    const alpha = saturate((width - across) * 40 + 0.5)
    const rgba = [rib ? 0.3 : 0.36 - along * 0.1, rib ? 0.5 : 0.68, 0.16, alpha]
    rgba.forEach((value, channel) => (data[offset + channel] = unorm8(value)))
  })
}

/** How a matcap ball looks: its colour, the rim light at its edge, the strength and tightness of
 *  its highlight, how much of the room it reflects as a metal, and how far its light wraps round. */
interface MatcapLook {
  base: Vec3
  rim?: Vec3
  shine?: number
  gloss?: number
  metal?: number
  wrap?: number
}

/**
 * A matcap: the picture of a lit ball, painted from its normal at each pixel — a diffuse part, a
 * highlight, a rim, and for metals a reflected room (a warm window high on the left, a dark floor,
 * a bright horizon).
 */
export function matcapBall(
  engine: Families<'math' | 'texture'>,
  { base, rim = [0, 0, 0], shine = 0, gloss = 20, metal = 0, wrap = 0 }: MatcapLook,
) {
  const { clamp, vector3 } = engine.math
  // The key light every ball is lit by, high on the left, and the half-way vector of its highlight.
  const aimed = vector3(-0.5, 0.65, 0.58),
    aimedLength = aimed.length()
  const keyDir = vector3(aimed.x / aimedLength, aimed.y / aimedLength, aimed.z / aimedLength)
  const halfDir = vector3(keyDir.x, keyDir.y, keyDir.z + 1),
    HALF_LENGTH = halfDir.length()
  const edge = vector3(),
    probe = vector3()
  const room = (r: number[]) => {
    const up = r[1],
      window = clamp((probe.set(r[0], r[1], r[2]).dot(keyDir) - 0.8) * 6, 0, 1)
    const sky =
      up > 0
        ? mix(engine, [0.55, 0.52, 0.5], [0.2, 0.2, 0.24], clamp(up * 1.6, 0, 1))
        : mix(engine, [0.55, 0.5, 0.45], [0.05, 0.04, 0.04], clamp(-up * 3, 0, 1))
    return mix(engine, sky, [1.4, 1.25, 1.05], window)
  }
  return painted(engine, (px, py, data, offset) => {
    // The normal of the ball at this pixel; outside it, the edge's normal, so a sample at the
    // silhouette never reads the background.
    let x = ((px + 0.5) / SIZE) * 2 - 1,
      y = 1 - ((py + 0.5) / SIZE) * 2
    const reach = edge.set(x, y, 0).length()
    if (reach > 0.999) [x, y] = [(x / reach) * 0.999, (y / reach) * 0.999]
    const n = [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))]
    const normal = probe.set(n[0], n[1], n[2])
    const lit = clamp((normal.dot(keyDir) + wrap) / (1 + wrap), 0, 1)
    const toward = normal.dot(halfDir) / HALF_LENGTH
    const spot = clamp(toward, 0, 1) ** gloss
    const fresnel = (1 - n[2]) ** 3
    const reflected = [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1]
    const diffuse = base.map((value) => value * (0.18 + 0.9 * lit))
    const colour = mix(
      engine,
      diffuse,
      room(reflected).map((value, k) => value * base[k] * 1.6),
      metal,
    ).map((value, k) => value + spot * shine + fresnel * rim[k])
    colour.forEach((value, k) => (data[offset + k] = unorm8(saturate(value) ** (1 / 2.2))))
    data[offset + 3] = 255
  })
}
