// What the reflection proofs share when they audit a frame of boxes (`boxFrame.ts`) against the
// exact mirror rays of one mirror block: each mirror pixel's exact ray and first hit, which of
// them the screen can answer, which lie off every silhouette, and how much of a colour a pixel
// shows.
import type { Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'
import {
  castBoxes,
  type Box,
  type Camera,
} from '../../../packages/sdk-browser/src/lighting/reflections/boxes.fixture.ts'
import { boxFrame, type Block } from './boxFrame.ts'
import { settledImage } from './rigImage.ts'
import { pointOnScreen, rgbAt } from './rigFrame.ts'

/** The share of `color` a pixel's colour `v` holds: 1 for the same hue, 0 under a faint pixel. */
export function hueOf(v: number[], color: Vec3) {
  const length = length3(v[0], v[1], v[2]) * length3(...color)
  return length > 0.02 ? (v[0] * color[0] + v[1] * color[1] + v[2] * color[2]) / length : 0
}

/** The exact rays of the pixels `shown` as block `mirror` of `blocks`: the block of the first hit
 *  among the others (-1 for none, -2 on a pixel that is not the mirror's), the ray's origin, a
 *  `lift` off the surface, and its direction, the view ray `reflect`ed. */
export function exactRays(
  view: Camera,
  blocks: Block[],
  eye: Vec3,
  shown: ArrayLike<number>,
  mirror: number,
  lift: Vec3,
  reflect: (d: Vec3) => Vec3,
) {
  const [width, height] = [view.width, view.height]
  const others = blocks.filter((block) => !block.mirror)
  const exact = new Int32Array(width * height).fill(-2)
  const origins: Vec3[] = [],
    mirrors: Vec3[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (shown[p] < 0 || Math.floor(shown[p] / 6) !== mirror) continue
      const d = view.ray(x + 0.5, y + 0.5)
      const t = castBoxes(
        eye,
        d,
        blocks.map((block) => block.box),
      ).t
      const o = [0, 1, 2].map((k) => eye[k] + d[k] * t + lift[k]) as Vec3
      const R = reflect(d)
      const hit = castBoxes(
        o,
        R,
        others.map((block) => block.box),
      )
      exact[p] = hit.index < 0 ? -1 : blocks.indexOf(others[hit.index])
      origins[p] = o
      mirrors[p] = R
    }
  return { exact, origins, mirrors, boxes: others.map((block) => block.box) as Box[] }
}

/** `pointOnScreen` of the exact hit of a mirror ray among `boxes`. */
export function hitOnScreen(view: Camera, boxes: Box[], origin: Vec3, mirror: Vec3) {
  const hit = castBoxes(origin, mirror, boxes)
  return pointOnScreen(view, [0, 1, 2].map((c) => origin[c] + mirror[c] * hit.t) as Vec3)
}

/** Whether every pixel within two of `p` has the exact block of `p`: off every silhouette, which
 *  the pixel grid decides. */
export function interior(exact: Int32Array, width: number, height: number, p: number) {
  const x = p % width,
    y = Math.floor(p / width)
  for (let v = -2; v <= 2; v++)
    for (let u = -2; u <= 2; u++) {
      const q = (y + v) * width + x + u
      if (q < 0 || q >= width * height) return false
      if (exact[q] > -2 && exact[q] !== exact[p]) return false
    }
  return true
}

/** The blocks seen from `eye` toward `target` at `width × height`, two still images through the
 *  engine's kernels on `device`: the view, the pixels' blocks and a reader of a pixel's reflected
 *  colour. */
export async function renderBlocks(
  device: GPUDevice,
  blocks: Block[],
  eye: Vec3,
  target: Vec3,
  width: number,
  height: number,
) {
  const { frame, view, shown } = boxFrame(blocks, eye, target, width, height)
  const words = await settledImage(device, frame)
  const rgb = (p: number) => rgbAt(words, p)
  return { frame, view, shown, rgb }
}
