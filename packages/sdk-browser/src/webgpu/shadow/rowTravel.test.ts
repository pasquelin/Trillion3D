// The rows' motion as the chunk bound reads it (`rowTravel.ts`): the spheres keep no CPU copy, only
// what changed in them; a moving placement's committed travel holds every row of it — its sphere at
// the new pose lies within its sphere at the old one grown by it —, a parent's move holds its
// roots' rows the same, and a placement's first move counts its rows whole.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { mulberry32 } from '../../../../math/src/sequence/random.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { writeClusterSphere } from './clusterSphere.ts'
import { createShadowMobility } from './mobility.ts'
import { clusterSpheres } from './rowBuffers.ts'
import { commitRowMotion } from './rowTravel.ts'

test('the spheres keep no CPU copy: the GPU buffer, its rows, and what changed in them', () => {
  const spheres = clusterSpheres(fakeDevice().device, 64)
  assert.deepEqual(Object.keys(spheres).sort(), ['buffer', 'motion', 'rows'])
})

/** A world: a rotation about a random axis by `angle`, scaled by `scale`, at `t`. */
function world(rand: () => number, angle: number, scale: number, t: number[]) {
  const axis = [rand() - 0.5, rand() - 0.5, rand() - 0.5],
    n = Math.hypot(...axis),
    [x, y, z] = axis.map((v) => v / n),
    c = Math.cos(angle),
    s = Math.sin(angle),
    k = 1 - c
  const r = [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ]
  const e = new Float64Array(16)
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++) e[col * 4 + row] = r[row][col] * scale
  e.set([...t, 1], 12)
  return e
}
const product = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

/** Pages within a local box of half size `h` about `at`, reach `reach`, and their root. */
function rootOf(rand: () => number, at: number[], h: number, reach: number) {
  const pages = Array.from({ length: 12 }, () => {
    const c = at.map((v) => v + (rand() * 2 - 1) * h * 0.8),
      e = 0.05 + rand() * h * 0.2
    return { min: c.map((v) => v - e), max: c.map((v) => v + e) } as unknown as PageRec
  })
  const localBox = new Float64Array([...at.map((v) => v - h), ...at.map((v) => v + h)])
  return { pages, localBox, reach, world: { elements: new Float64Array(16) } }
}

/** Every page's sphere at `w` holds within its sphere at `v` grown by `travel`. */
function within(
  root: ReturnType<typeof rootOf>,
  v: ArrayLike<number>,
  w: ArrayLike<number>,
  travel: number,
) {
  const a = new Float32Array(8),
    b = new Float32Array(8)
  for (const page of root.pages) {
    root.world.elements.set(v)
    writeClusterSphere(page, [root], a, 0, 0)
    root.world.elements.set(w)
    writeClusterSphere(page, [root], b, 0, 0)
    const gap = Math.hypot(...[0, 1, 2].map((k) => b[k] + b[4 + k] - a[k] - a[4 + k]))
    assert.ok(gap + b[3] <= a[3] + travel, `${gap} + ${b[3]} past ${a[3]} + ${travel}`)
  }
}

function runtime(roots: ReturnType<typeof rootOf>[], compose?: object) {
  const lights = {
    mobility: createShadowMobility(),
    spheres: clusterSpheres(fakeDevice().device, 8),
  }
  lights.mobility.ensure(roots.length, 8, (rank) => roots[rank].world.elements)
  const rt = { lights, layout: { selectionRoots: roots }, compose } as unknown as WebgpuPagesRuntime
  return { rt, mobility: lights.mobility, motion: lights.spheres.motion }
}

test('a moving placement’s travel holds every row it carries, its first move counted whole', () => {
  const rand = mulberry32(3)
  for (let trial = 0; trial < 20; trial++) {
    const root = rootOf(rand, [rand() * 40 - 20, 3, rand() * 9], 4, trial % 3 ? 0 : 0.5)
    const { rt, mobility, motion } = runtime([root])
    const from = world(rand, rand() * 3, 0.5 + rand(), [1e3 * rand(), 5, -2e3 * rand()])
    root.world.elements.set(from)
    // Its first move: promoted, its rows were binned as still.
    mobility.move(0, from, true)
    commitRowMotion(rt, 0)
    assert.equal(motion.derived, root.pages.length)
    const to = world(rand, rand() * 3, 0.5 + rand(), [1e3 * rand(), 5, -2e3 * rand()])
    const before = motion.travel
    mobility.move(0, to, true)
    commitRowMotion(rt, 0)
    assert.equal(motion.derived, root.pages.length, 'a later move is carried by its travel')
    within(root, from, to, motion.travel - before)
  }
})

test('a parent’s move holds its roots’ rows: their points at their reach about it', () => {
  const rand = mulberry32(9)
  const roots = [0, 1, 2].map((i) => rootOf(rand, [i * 3, 0, 1], 1.5, 0.1))
  const locals = roots.map(() => world(rand, rand() * 3, 0.7 + rand(), [rand() * 5, 2, rand() * 5]))
  const state = {
    ranksOf: [[0, 1, 2]],
    parentOf: Uint32Array.from([0, 0, 0]),
    localMats: Float64Array.from(locals.flatMap((m) => [...m])),
  }
  const { rt, mobility, motion } = runtime(roots, state)
  const from = world(rand, 0.4, 1.2, [10, 0, -4]),
    to = world(rand, 1.9, 0.8, [13, 1, -9])
  mobility.moveLead(0, [0, 1, 2], from, to)
  commitRowMotion(rt, 0)
  roots.forEach((root, i) =>
    within(root, product(from, locals[i]), product(to, locals[i]), motion.travel),
  )
})
