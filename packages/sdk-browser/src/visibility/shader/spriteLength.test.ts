// The sprite corner's axis lengths (`spriteAt`, `spriteWgsl.ts`) moved from `hypot3` to the engine's
// one length rule, `length3` (docs/MATHS.md "Lengths"), the order of the WGSL `length()` it twins.
// The card corner reaches the GPU as float32: the sweep holds the old expression as its oracle and
// proves every written coordinate keeps its float32 bits.
import test from 'node:test'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import {
  assertSameFloat32,
  edgeValues,
  HALTON_SWEEP,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'
import type { VisMaterial } from '../types.ts'
import { spriteAt } from './spriteWgsl.ts'

type Sprite = NonNullable<VisMaterial['sprite']>

/** `spriteAt` as it was, with `hypot3` for the four axis lengths: the same terms in the same
 *  order (a size-attenuated sprite's factor 1 leaves a product as it is). */
function oldSpriteAt(
  out: Float64Array,
  toClip: ArrayLike<number>,
  place: ArrayLike<number>,
  cornerX: number,
  cornerY: number,
  sprite: Sprite,
) {
  const column = (k: number) => hypot3(place[k], place[k + 1], place[k + 2]),
    row = (k: number) => hypot3(toClip[k], toClip[k + 4], toClip[k + 8])
  const w = sprite.sizeAttenuation
    ? 1
    : toClip[3] * place[12] + toClip[7] * place[13] + toClip[11] * place[14] + toClip[15]
  const [ax, ay] = [cornerX * column(0) * w, cornerY * column(4) * w],
    [c, s] = [Math.cos(sprite.rotation), Math.sin(sprite.rotation)]
  const [x, y] = [c * ax - s * ay, s * ax + c * ay],
    [r, u] = [row(0), row(1)]
  out.set(
    [0, 1, 2].map((i) => place[12 + i] + (x * toClip[4 * i]) / r + (y * toClip[4 * i + 1]) / u),
  )
  out[3] = 1
  return out
}

const BASES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71]

test('the sprite corner reads the same float32 from length3 as from hypot3', () => {
  const was = new Float64Array(4),
    now = new Float64Array(4)
  const check = (toClip: number[], place: number[], cx: number, cy: number, label: string) => {
    for (const sizeAttenuation of [true, false]) {
      const sprite: Sprite = { rotation: cx * 0.37 - cy * 0.21, sizeAttenuation } as Sprite
      oldSpriteAt(was, toClip, place, cx, cy, sprite)
      spriteAt(now, toClip, place, cx, cy, sprite)
      for (let i = 0; i < 4; i++) assertSameFloat32(was[i], now[i], `${label} out[${i}]`)
    }
  }
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const m = (offset: number, lo: number, hi: number) =>
      Array.from({ length: 16 }, (_, k) =>
        haltonSpan(i, BASES[(offset + k) % BASES.length], lo, hi),
      )
    const scale = i % 3 === 0 ? 1000 : i % 3 === 1 ? 1 : 0.001
    check(
      m(0, -4, 4),
      m(4, -8 * scale, 8 * scale),
      haltonSpan(i, 71, -2, 2),
      haltonSpan(i, 73, -2, 2),
      `halton ${i}`,
    )
  }
  const edges = edgeValues(-1e30, 1e30)
  const base = (v: number) => Array.from({ length: 16 }, (_, k) => (k % 5 === 0 ? v : 0.5))
  for (const e of edges)
    for (let k = 0; k < 16; k++) {
      const place = base(1).map((v, j) => (j === k ? e : v))
      const toClip = base(1).map((v, j) => (j === k ? e : v))
      check(toClip, place, 1, -1, `edge ${e} slot ${k}`)
      check(base(1), place, 0.5, 2, `edge ${e} place slot ${k}`)
    }
})
