// #573: where each page of a dynamic cut has its vertices, measured as they are rewritten
// (`createPageMotion`). Under random wave fields rewriting random ranges, every page's box is its own
// vertices' box — a rewrite measures the pages it touches, the others keep a box their unmoved
// vertices still fill —, and the reach is the farthest any vertex lies from rest. Each page's row,
// placed by any affine world, sheared included, holds every vertex: its shadow sphere and the
// corners its occlusion test reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { cutDrawnTriangles } from '../page/runtimeCut.ts'
import { servePrimitive } from '../page/runtimePrimitive.ts'
import { packClusterSpheres } from '../../webgpu/shadow/spheres.ts'
import { CLUSTER_SPHERE_FLOATS } from '../../webgpu/shadow/rowBuffers.ts'
import { BOX_CORNER_VALUES, pageCornersInto } from '../../hiz/corners.ts'
import { createPageMotion } from './pageMotion.ts'
import { BOX_VALUES } from '../../../../sdk-core/src/math/primitives/box.ts'
import type { PageRec } from '../../page/selection/types.ts'

/** The same pseudo-random numbers in [0, 1) every run. */
function randomOf(seed: number) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

/** A sheet of 48 × 32 cells, its pages as a held blended surface is cut. */
async function sheet() {
  const drawn = drawnTriangles(geometry.plane(12, 8, 48, 32), 'triangles')!
  const cut = await cutDrawnTriangles(drawn, true, true, { held: true })
  return { cut, rest: Float32Array.from(drawn.positions) }
}

/** Random waves over a random range of `now`'s vertices, the others left where they were. */
function waves(now: Float32Array, rest: Float32Array, random: () => number) {
  const vertices = now.length / 3,
    from = Math.floor(random() * vertices),
    count = 1 + Math.floor(random() * (vertices - from)),
    [height, kx, ky, phase] = [3 * random(), 4 * random(), 4 * random(), 7 * random()]
  for (let v = from; v < from + count; v++)
    for (let a = 0; a < 3; a++)
      now[v * 3 + a] =
        rest[v * 3 + a] + height * Math.sin(kx * rest[v * 3] + ky * rest[v * 3 + 1] + phase + a)
  return [{ name: 'position' as const, from, count }]
}

/** The box of `index`'s corners at `p`, least corner then greatest. */
function cornersBox(index: ArrayBuffer, p: Float32Array) {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const v of new Uint32Array(index))
    for (let a = 0; a < 3; a++) {
      box[a] = Math.min(box[a], p[v * 3 + a])
      box[a + 3] = Math.max(box[a + 3], p[v * 3 + a])
    }
  return box
}

test("each page's box is its own vertices', a partial rewrite measuring the pages it moves", async () => {
  const { cut, rest } = await sheet(),
    now = Float32Array.from(rest),
    motion = createPageMotion(cut, rest),
    random = randomOf(573)
  // At rest, each box is the page's served one.
  const { primitive, urls } = servePrimitive(cut, {}, motion.boxes)
  urls.forEach((url) => URL.revokeObjectURL(url))
  for (const [k, page] of primitive.pages.entries())
    assert.deepEqual([...page.min, ...page.max], cornersBox(cut.pages[k].index, rest))
  for (let frame = 0; frame < 40; frame++) {
    const reach = motion.measure(now, waves(now, rest, random))
    let most = 0
    for (let i = 0; i < now.length; i++) most = Math.max(most, Math.abs(now[i] - rest[i]))
    assert.equal(reach, most, `frame ${frame}: the farthest a vertex lies now`)
    for (const [k, page] of cut.pages.entries()) {
      const at = k * BOX_VALUES
      const own = [...motion.boxes.subarray(at, at + BOX_VALUES)]
      assert.deepEqual(own, cornersBox(page.index, now), `frame ${frame}, page ${k}`)
    }
  }
})

test("every vertex lies in its row's sphere and corners, whatever the placement shears", async () => {
  const { cut, rest } = await sheet(),
    now = Float32Array.from(rest),
    motion = createPageMotion(cut, rest),
    random = randomOf(1573)
  const { primitive, urls } = servePrimitive(cut, {}, motion.boxes)
  urls.forEach((url) => URL.revokeObjectURL(url))
  const recs = primitive.pages as unknown as PageRec[],
    spheres = new Float32Array(recs.length * CLUSTER_SPHERE_FLOATS),
    corners = new Float64Array(BOX_CORNER_VALUES)
  for (let frame = 0; frame < 12; frame++) {
    const reach = motion.measure(now, waves(now, rest, random))
    // An affine world of any linear part — scaled, rotated, sheared — and far from the origin.
    const e = Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 0 : 4 * random() - 2))
    ;[e[12], e[13], e[14], e[15]] = [1e4 * random(), -1e4 * random(), 1e3 * random(), 1]
    for (const [k, rec] of recs.entries()) {
      const at = k * BOX_VALUES
      rec.moved = {
        min: [...motion.boxes.subarray(at, at + 3)],
        max: [...motion.boxes.subarray(at + 3, at + 6)],
      }
    }
    // The root's reach is the farthest anything lies: a moved box takes none of it.
    const roots = [{ world: { elements: e }, reach }]
    packClusterSpheres(recs, roots, spheres, 0, recs.length - 1, () => 0)
    for (const [k, rec] of recs.entries()) {
      const s = spheres.subarray(k * CLUSTER_SPHERE_FLOATS)
      pageCornersInto(corners, 0, rec, roots[0].world, reach)
      const hull = [0, 1, 2].map((a) => [0, 1, 2, 3, 4, 5, 6, 7].map((c) => corners[c * 3 + a]))
      for (const v of new Uint32Array(cut.pages[k].index)) {
        const p = [0, 1, 2].map(
          (a) =>
            e[a] * now[v * 3] + e[4 + a] * now[v * 3 + 1] + e[8 + a] * now[v * 3 + 2] + e[12 + a],
        )
        const d = Math.hypot(...p.map((x, a) => x - (s[a] + s[4 + a])))
        assert.ok(d <= s[3], `frame ${frame}, page ${k}: ${d} past ${s[3]}`)
        for (let a = 0; a < 3; a++)
          assert.ok(
            p[a] >= Math.min(...hull[a]) - 1e-9 * Math.abs(p[a]) &&
              p[a] <= Math.max(...hull[a]) + 1e-9 * Math.abs(p[a]),
            `frame ${frame}, page ${k}, axis ${a}`,
          )
      }
    }
  }
})
