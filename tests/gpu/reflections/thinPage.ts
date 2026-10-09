// Thin surfaces before a lit wall, on a mirror floor (`boxFrame.ts`, `rig.ts`): a pole one pixel
// wide, a fence four, and a box deeper than the thickness the march assumes. A floor pixel whose
// exact mirror ray meets the wall, and whose path on the screen crosses the pole's or the fence's
// pixels from behind them, must show the wall: the ray passes behind a surface thinner than its
// slab. One whose exact ray meets the box must show the box: the box, deeper than the slab, stops it.
import { perspectiveSlope } from '../../../packages/math/src/projection/camera.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { castBoxes, type V3 } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import {
  REFLECTION_EDGE,
  REFLECTION_STEP_CAP,
  REFLECTION_THICKNESS,
} from '../../../packages/sdk-browser/src/reflections/constants.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { boxFrame, type Block } from './boxFrame.ts'
import { openRig } from './rig.ts'

const WIDTH = 320,
  HEIGHT = 180
const EYE: V3 = [0, 6, 4]
/** Where the eye looks: down onto the floor at 31°, so that the mirror rays drift across the screen. */
const TARGET: V3 = [0, 0, -6]
/** One pixel of the view, in metres, at the pole's distance (10.5 m): 2 · tan(25°) / 180 · 10.5. */
const PIXEL = ((2 * perspectiveSlope(50)) / HEIGHT) * 10.5

const FLOOR: Block = {
  box: { low: [-14, -0.3, -16], high: [14, 0, 4] },
  color: [0.02, 0.02, 0.02],
  mirror: true,
}
const WALL: Block = { box: { low: [-14, 0, -16], high: [14, 12, -15.8] }, color: [0.9, 0.35, 0.1] }
/** The poles, one pixel wide at 10.5 m, and the fences, four, in a row across the view. */
const THIN_COLOR: Record<string, V3> = { pole: [0.1, 0.9, 0.2], fence: [0.9, 0.9, 0.1] }
const POLES: Block[] = [2, 4, 6].map((x) => ({
  box: { low: [x - PIXEL / 2, 0, -6 - PIXEL / 2], high: [x + PIXEL / 2, 3, -6 + PIXEL / 2] },
  color: THIN_COLOR.pole,
}))
const FENCES: Block[] = [-3, -5, -7].map((x) => ({
  box: { low: [x - 2 * PIXEL, 0, -6 - 2 * PIXEL], high: [x + 2 * PIXEL, 3, -6 + 2 * PIXEL] },
  color: THIN_COLOR.fence,
}))
const CRATE: Block = {
  box: { low: [-1.5, 0, -10], high: [1.5, 1.4, -6] },
  color: [0.15, 0.2, 0.95],
}
const BLOCKS = [FLOOR, WALL, CRATE, ...POLES, ...FENCES]
const [FLOOR_AT, WALL_AT, CRATE_AT] = BLOCKS.keys()
/** The thin surfaces' blocks. */
const isThin = (block: number) => block >= CRATE_AT + 1

/** The share of the pixels a count holds. */
export type ThinReading = {
  /** Floor pixels whose mirror ray meets the wall in the open, and of them those showing it. */
  wallAll: number
  wallHue: number
  /** Floor pixels whose mirror ray meets the wall behind the pole or the fence, and of them those
   *  showing the wall's colour. */
  behind: number
  behindWall: number
  /** Floor pixels whose mirror ray meets the crate, and of them those showing its colour. */
  crate: number
  crateCrate: number
  /** The reflection of the pole's and the fence's pixels themselves: their colours, as seen. */
  samples: Record<string, number[]>
}

export function run() {
  return runOnDevice<ThinReading>(async (device, _events, result) => {
    const { frame, view, shown } = boxFrame(BLOCKS, EYE, TARGET, WIDTH, HEIGHT)
    const rig = await openRig(device, frame)
    rig.image()
    rig.image()
    const words = await rig.read()
    rig.dispose()
    const rgb = (p: number) => [0, 1, 2].map((c) => fromHalf(words[p * 4 + c]))
    const hue = (v: number[], color: V3) => {
      const length = length3(v[0], v[1], v[2]) * length3(...color)
      return length > 0.02 ? (v[0] * color[0] + v[1] * color[1] + v[2] * color[2]) / length : 0
    }
    const others = BLOCKS.filter((block) => !block.mirror)
    const boxes = others.map((block) => block.box)
    // The exact first block of a floor pixel's mirror ray, -1 for none.
    const exact = new Int32Array(WIDTH * HEIGHT).fill(-2)
    const origins: V3[] = [],
      mirrors: V3[] = []
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) {
        const p = y * WIDTH + x
        if (shown[p] < 0 || Math.floor(shown[p] / 6) !== FLOOR_AT) continue
        const d = view.ray(x + 0.5, y + 0.5)
        const t = castBoxes(
          EYE,
          d,
          BLOCKS.map((block) => block.box),
        ).t
        const P: V3 = [EYE[0] + d[0] * t, EYE[1] + d[1] * t, EYE[2] + d[2] * t]
        const R: V3 = [d[0], -d[1], d[2]]
        const o: V3 = [P[0], P[1] + 1e-4, P[2]]
        const hit = castBoxes(o, R, boxes)
        exact[p] = hit.index < 0 ? -1 : BLOCKS.indexOf(others[hit.index])
        origins[p] = o
        mirrors[p] = R
      }
    // Whether the screen answers: the exact hit lies on the image, off its border (`REFLECTION_EDGE`
    // of its height), within half of the distance the march covers (`REFLECTION_STEP_CAP`), and in
    // the open — the pole or the fence does not stand over it in the image, which would show them
    // there, not the wall.
    const answered = (p: number) => {
      const hit = castBoxes(origins[p], mirrors[p], boxes)
      const point: V3 = [0, 1, 2].map((c) => origins[p][c] + mirrors[p][c] * hit.t) as V3
      const [hx, hy] = view.project(point)
      const border = REFLECTION_EDGE * HEIGHT
      if (hx <= border || hy <= border || hx >= WIDTH - border || hy >= HEIGHT - border)
        return false
      if (
        Math.abs(hx - (p % WIDTH) - 0.5) + Math.abs(hy - Math.floor(p / WIDTH) - 0.5) >=
        REFLECTION_STEP_CAP / 2
      )
        return false
      for (let v = -3; v <= 3; v++)
        for (let u = -3; u <= 3; u++) {
          const block = Math.floor(shown[(Math.floor(hy) + v) * WIDTH + Math.floor(hx) + u] / 6)
          if (isThin(block)) return false
        }
      return true
    }
    // Whether the exact ray crosses the pole's or the fence's pixels, and passes behind every one of
    // them by more than the slab of the march: a thickness of `REFLECTION_THICKNESS` pixels of the
    // footprint, `view.scale · w` metres each, in depth `w`.
    const behindThin = (p: number) => {
      const o = origins[p],
        R = mirrors[p]
      const hit = castBoxes(o, R, boxes)
      let behind = false
      for (let s = 1; s <= 400; s++) {
        const t = (hit.t * s) / 400
        const point: V3 = [o[0] + R[0] * t, o[1] + R[1] * t, o[2] + R[2] * t]
        const [px, py, , w] = view.project(point)
        const at = Math.floor(py) * WIDTH + Math.floor(px)
        if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) continue
        const block = Math.floor(shown[at] / 6)
        if (shown[at] < 0 || !isThin(block)) continue
        const surface = view.near / frame.depth[at]
        if (w <= surface * (1 + 1.5 * REFLECTION_THICKNESS * view.scale)) return false
        behind = true
      }
      return behind
    }
    // A pixel whose neighbours' exact blocks differ lies on a silhouette: the pixel grid decides it.
    const interior = (p: number) => {
      const x = p % WIDTH,
        y = Math.floor(p / WIDTH)
      for (let v = -2; v <= 2; v++)
        for (let u = -2; u <= 2; u++) {
          const q = (y + v) * WIDTH + x + u
          if (q < 0 || q >= WIDTH * HEIGHT) return false
          if (exact[q] > -2 && exact[q] !== exact[p]) return false
        }
      return true
    }
    result.behind = result.behindWall = result.crate = result.crateCrate = 0
    result.wallAll = result.wallHue = 0
    for (let p = 0; p < WIDTH * HEIGHT; p++) {
      if (exact[p] < -1 || !interior(p) || !answered(p)) continue
      if (exact[p] === WALL_AT && behindThin(p)) {
        result.behind++
        if (hue(rgb(p), WALL.color) > 0.98) result.behindWall++
      }
      if (exact[p] === WALL_AT) {
        result.wallAll++
        if (hue(rgb(p), WALL.color) > 0.98) result.wallHue++
      }
      if (exact[p] === CRATE_AT) {
        result.crate++
        if (hue(rgb(p), CRATE.color) > 0.98) result.crateCrate++
      }
    }
  })
}
