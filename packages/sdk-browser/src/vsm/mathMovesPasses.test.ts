// The VSM passes' formulas moved to packages/math, each against the old expression as its oracle.
//
// The projection view (`projectionPass.ts` viewMatrices): shiftedToView was `view` with its
// translation `t − (V·shift)` written row by row; it is now `matrixAtRenderOrigin(view, −shift)`,
// `V·(−shift) + t`. Negation is exact and `a − b` is `a + (−b)`, so every non-zero number keeps its
// bits; only a sum of zeros of both signs may turn its zero over (−(+0 + −0) is −0, −0 + +0 is
// +0), and the w word `0·o + 0·o + 0·o + 1` is 1 for a finite shift. A zero of either sign times
// a finite number is a zero and added to a non-zero term is that term: no clip coordinate, depth
// or inverse entry the shader reads moves, and the sweep holds every uploaded word to it.
//
// The invalidation's box radius (`invalidationPass.ts`) and a sun level's f32 room
// (`rowPageBound.ts` measureKey) take `length3` for `Math.hypot`: one last bit of a double apart.
// The radius only decides whether a light's range meets a box's bounding sphere, where the light
// is zero; the room widens a bound 2⁸ times past the f32 roundings it covers. The sweep holds the
// decisions and the room's float32 equal.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeVirtualShadowProjection } from './projectionPass.ts'
import { createVsmResources } from './resources.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import {
  orthographicProjection,
  perspectiveProjection,
} from '../../../math/src/projection/camera.ts'
import { spheresOverlap } from '../../../math/src/geometry/sphere.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  edgeValues,
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'

/** The old viewMatrices: the four matrices of the view header, words 0-63. */
function oldHeader(view: ArrayLike<number>, projection: ArrayLike<number>, shift: number[]) {
  const shiftedToView = Float64Array.from(view)
  for (let r = 0; r < 3; r++)
    shiftedToView[12 + r] =
      view[12 + r] - (view[r] * shift[0] + view[4 + r] * shift[1] + view[8 + r] * shift[2])
  for (let k = 2; k < 16; k += 4) shiftedToView[k] = -shiftedToView[k]
  const viewToClip = Float64Array.from(projection)
  for (let k = 8; k < 12; k++) viewToClip[k] = -viewToClip[k]
  const shiftedToClip = multiplyMatrix4(new Float64Array(16), viewToClip, shiftedToView)
  const clipToShifted = invertMatrix4(new Float64Array(16), shiftedToClip)
  return [...shiftedToClip, ...shiftedToView, ...viewToClip, ...clipToShifted]
}

/** A rigid view turned by `yaw`, `pitch` and posed at `eye`: the camera's axes as its rows. */
function rigidView(yaw: number, pitch: number, eye: number[]) {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch)
  const rows = [
    [cy, 0, -sy],
    [sy * sp, cp, cy * sp],
    [sy * cp, -sp, cy * cp],
  ]
  const m = new Float64Array(16)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m[c * 4 + r] = rows[r][c]
    m[12 + r] = -(rows[r][0] * eye[0] + rows[r][1] * eye[1] + rows[r][2] * eye[2])
  }
  m[15] = 1
  return m
}

test('the projection view header: every word as the old composition wrote it', () => {
  const { device, writes } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const texture = {} as GPUTextureView
  const pass = new Proxy({}, { get: () => () => {} })
  const encoder = { beginComputePass: () => pass } as unknown as GPUCommandEncoder
  const perspective = perspectiveProjection(new Float64Array(16), 60, 16 / 9, 0.1, 1)
  const ortho = orthographicProjection(new Float64Array(16), -40, 40, -30, 30, 0.5, 900)
  const check = (view: Float64Array, shift: number[] | undefined, isPerspective: boolean) => {
    const projection = isPerspective ? perspective : ortho
    writes.length = 0
    encodeVirtualShadowProjection(
      encoder,
      res,
      {
        device,
        depth: texture,
        normalRough: texture,
        flags: texture,
        mask: texture,
        maskTiles: texture,
        width: 64,
        height: 64,
        frameIndex: 0,
        camera: { view, projection, perspective: isPerspective, originShift: shift },
      },
      [],
    )
    const bytes = writes.find(
      (w) => (w.buffer as { label?: string }).label === 'vsm.projection.view',
    )!.data as Uint8Array
    const words = new Float32Array(bytes.buffer, bytes.byteOffset, 64)
    const eye = invertMatrix4(new Float64Array(16), view)
    const old = oldHeader(view, projection, shift ?? [-eye[12], -eye[13], -eye[14]])
    for (let k = 0; k < 64; k++)
      if (words[k] === 0) assert.ok(Math.fround(old[k]) === 0, `word ${k}`)
      else assertSameFloat32(old[k], words[k], `word ${k}`)
  }
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const eye = [2, 3, 5].map((b) => haltonSpan(i, b, -1e5, 1e5))
    const view = rigidView(haltonSpan(i, 7, -Math.PI, Math.PI), haltonSpan(i, 11, -1.5, 1.5), eye)
    check(
      view,
      i % 3 === 0 ? [7, 13, 17].map((b) => haltonSpan(i, b, -1e5, 1e5)) : undefined,
      i % 2 === 0,
    )
  }
  // Axis-aligned views (exact zeros in the rotation) at every edge eye and shift.
  for (const e of edgeValues(-1e5, 1e5))
    for (const turn of [0, Math.PI / 2, Math.PI]) {
      const view = rigidView(turn, 0, [e, -e, 0])
      check(view, undefined, true)
      check(view, [e, 0, -e], false)
    }
})

test("the invalidation's box radius: the same light-range decisions", () => {
  const centre = new Float64Array(3),
    origin = new Float64Array(3)
  const decide = (h: number[], range: number, radius: (h: number[]) => number) =>
    spheresOverlap(centre, radius(h), origin, range)
  const hypot = (h: number[]) => Math.hypot(h[0], h[1], h[2])
  const rule = (h: number[]) => length3(h[0], h[1], h[2])
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    for (let k = 0; k < 3; k++) centre[k] = haltonSpan(i, [2, 3, 5][k], -500, 500)
    for (let k = 0; k < 3; k++) origin[k] = haltonSpan(i, [7, 11, 13][k], -500, 500)
    const h = [17, 19, 23].map((b) => haltonSpan(i, b, 0, 200))
    const range = haltonSpan(i, 29, 0, 600)
    assert.equal(decide(h, range, rule), decide(h, range, hypot), `box ${i}`)
  }
  centre.fill(0)
  origin.fill(0)
  for (const e of edgeValues(0, 1e6)) {
    const h = [e, e, e]
    for (const range of [0, e, hypot(h), rule(h), 1])
      assert.equal(decide(h, range, rule), decide(h, range, hypot), `edge ${e}, range ${range}`)
  }
})

test("a sun level's room: the same float32 as the old hypot", () => {
  const ROOM = 2 ** -16
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [dx, dy, dz] = [2, 3, 5].map((b) => haltonSpan(i, b, -2e4, 2e4))
    const half = haltonSpan(i, 7, 1, 1e4),
      off = haltonSpan(i, 11, 0, 3e4)
    assertSameFloat32(
      ROOM * (Math.hypot(dx, dy, dz) + half + off),
      ROOM * (length3(dx, dy, dz) + half + off),
      `level ${i}`,
    )
  }
  for (const e of edgeValues(-1e6, 1e6))
    assertSameFloat32(
      ROOM * (Math.hypot(e, -e, e) + 1),
      ROOM * (length3(e, -e, e) + 1),
      `edge ${e}`,
    )
})
