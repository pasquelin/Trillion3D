// What the motion proof (`motion.gpu.ts`) reads of an image, on a grid of its pixels `STEP` apart: the
// reflection target's RGB, and the stamps the run-time proxy's store holds in each set; and how it judges a
// moving image against the settled image of the same pose.
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { readTexture } from '../kit/computeReadback.ts'
import {
  STORE_BITS,
  STORE_CELL,
  STORE_SET_LAYERS,
} from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'

/** Pixels between two read ones, along each axis. */
const STEP = 4
/** The share of the settled radiance under which a moving pixel is dark. */
const DARK = 0.5
/** A pixel judged shows at least this in the settled image, and its four grid neighbours within a
 *  quarter of it: no edge of a reflected body, which a pixel's move crosses. */
const BRIGHT = 0.08
const EVEN = 0.25

export type Grid = { columns: number; rows: number; rgb: Float32Array }

/** The reflection target's RGB at the grid. */
export async function targetGrid(device: GPUDevice, target: GPUTexture): Promise<Grid> {
  const raw = await readTexture(device, target, 8)
  const half = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
  const columns = Math.floor(target.width / STEP),
    rows = Math.floor(target.height / STEP),
    rgb = new Float32Array(columns * rows * 3)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const at = ((j * STEP + (STEP >> 1)) * target.width + i * STEP + (STEP >> 1)) * 4
      for (let c = 0; c < 3; c++) rgb[(j * columns + i) * 3 + c] = fromHalf(half[at + c])
    }
  return { columns, rows, rgb }
}

/** The stamps of each set's cells at the grid (`STORE_BITS.stamp`): zero, a hole. */
export async function storeStamps(device: GPUDevice, store: GPUTexture) {
  const sets: Uint8Array[] = []
  for (let set = 0; set < 2; set++) {
    const raw = await readTexture(device, store, 4, {
      layer: set * STORE_SET_LAYERS + STORE_CELL.word,
    })
    const words = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    const columns = Math.floor(store.width / STEP),
      rows = Math.floor(store.height / STEP),
      stamps = new Uint8Array(columns * rows)
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < columns; i++)
        stamps[j * columns + i] =
          words[(j * STEP + (STEP >> 1)) * store.width + i * STEP + (STEP >> 1)] >>>
          STORE_BITS.stamp
    sets.push(stamps)
  }
  return sets
}

/** The image's epoch's stamp and the set it wrote: the newest stamp the store holds, in the set that holds
 *  it most — every image of the move moves the epoch by one and writes the other set. */
export function newest(sets: Uint8Array[]) {
  let stamp = 0
  for (const set of sets) for (const s of set) stamp = Math.max(stamp, s)
  const count = (set: Uint8Array) => set.reduce((n, s) => n + (s === stamp ? 1 : 0), 0)
  return { stamp, set: count(sets[1]) > count(sets[0]) ? 1 : 0 }
}

const peak = (g: Grid, k: number) => Math.max(g.rgb[k * 3], g.rgb[k * 3 + 1], g.rgb[k * 3 + 2])

/** A moving image `moving` judged against the settled one of its pose, `settled`, its cells' stamps
 *  `stamps` in the set it wrote under epoch stamp `stamp`: the pixels judged, those dark, and both by what
 *  answered them — a hole, a history carried, a ray cast this image. */
export function judgeImage(moving: Grid, settled: Grid, stamps: Uint8Array, stamp: number) {
  const zero = () => ({ hole: 0, carried: 0, fresh: 0 })
  const all = zero(),
    dark = zero()
  let judged = 0,
    darkCount = 0
  const { columns, rows } = settled
  for (let j = 1; j < rows - 1; j++)
    for (let i = 1; i < columns - 1; i++) {
      const k = j * columns + i,
        must = peak(settled, k)
      if (must < BRIGHT) continue
      const even = [k - 1, k + 1, k - columns, k + columns].every(
        (n) => Math.abs(peak(settled, n) - must) <= EVEN * must,
      )
      if (!even) continue
      judged++
      const kind = stamps[k] === 0 ? 'hole' : stamps[k] === stamp ? 'fresh' : 'carried'
      all[kind]++
      if (peak(moving, k) < DARK * must) {
        darkCount++
        dark[kind]++
      }
    }
  return { judged, dark: judged ? darkCount / judged : 0, all, darkBy: dark }
}
