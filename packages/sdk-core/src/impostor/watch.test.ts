// The watch holds the plan's switch for every root in view, image after image, and reads a root
// again only once the view may have moved its verdict: a still view reads nothing, a swaying or
// turning one what nears its switch — as many at 10⁵ roots as at 10³, on generated fields of one
// density.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planImpostors, type ImpostorRoot } from './plan.ts'
import { createImpostorWatch, impostorViewCosine } from './watch.ts'
import { bakedMesh } from './bakedMesh.fixture.ts'
import type { ImpostorSection } from '../contracts/impostor.ts'

const FOCAL = 1117
const TREE = { objectRadius: 4.2, rootTriangles: 2100, coverage: 0.43, frameSide: 128 }
const section: ImpostorSection = {
  ...{ version: 1, frames: 12, focalPixels: FOCAL, textureLimit: 8192, baked: 1, refused: 0 },
  meshes: [bakedMesh(1, 'tree', TREE)],
}
/** A perspective of 60° vertically at 16:9, reversed and infinite. */
const PROJECTION = (() => {
  const f = 1 / Math.tan(Math.PI / 6)
  return Float64Array.of(f / (16 / 9), 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0)
})()
const COS = impostorViewCosine(PROJECTION)

/** `count` trees at one per 400 m² on a disk about the origin, a few scaled or another mesh-less. */
function field(count: number): ImpostorRoot[] {
  const radius = Math.sqrt((count * 400) / Math.PI)
  let seed = 7
  const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: count }, (_, k) => {
    const r = radius * Math.sqrt(next()),
      a = 2 * Math.PI * next(),
      s = k % 7 === 0 ? 1.5 : 1
    const elements = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, r * Math.cos(a), 0, r * Math.sin(a), 1]
    return { mesh: k % 11 === 0 ? undefined : 1, world: { elements } }
  })
}

/** The view of an eye at `eye` turned by `yaw` about the vertical, looking down −z at rest. */
function viewAt(eye: readonly number[], yaw: number) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw)
  // The camera's axes in the world: right (c, 0, −s), up (0, 1, 0), back (s, 0, c); the view is
  // their transpose, the eye taken off.
  const view = Float64Array.of(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1)
  for (let i = 0; i < 3; i++)
    view[12 + i] = -(view[i] * eye[0] + view[4 + i] * eye[1] + view[8 + i] * eye[2])
  return view
}

/** Whether root `root`'s pivot is in `view`'s frustum (`PROJECTION`, no far plane). */
function inView(view: Float64Array, root: ImpostorRoot) {
  const w = root.world.elements,
    p = [0, 1, 2].map(
      (i) => view[i] * w[12] + view[4 + i] * w[13] + view[8 + i] * w[14] + view[12 + i],
    )
  if (p[2] >= 0) return false
  return Math.abs(p[0] * PROJECTION[0]) <= -p[2] && Math.abs(p[1] * PROJECTION[5]) <= -p[2]
}

/** Frame `k` of a camera swaying about `[x, 2, z]`: a metre aside and a degree about the vertical,
 *  `turn` adding a slow sweep of the view. */
function swayAt(k: number, turn = 0) {
  const eye = [Math.sin(k * 0.21), 2, 0.6 * Math.cos(k * 0.13)]
  return viewAt(eye, (Math.PI / 180) * Math.sin(k * 0.17) + turn * k)
}

test('the watch holds the plan’s verdict for every root in view, still, swaying and turning', () => {
  const roots = field(3000),
    watch = createImpostorWatch()
  let checked = 0
  for (let k = 0; k < 90; k++) {
    const view = k < 10 ? swayAt(0) : swayAt(k, k >= 50 ? 0.02 : 0)
    watch.update(roots, section, view, FOCAL, COS)
    const plan = planImpostors(roots, section, view, FOCAL)
    for (let rank = 0; rank < roots.length; rank++) {
      if (!inView(view, roots[rank])) continue
      checked++
      assert.equal(watch.switched[rank], plan.switched[rank], `frame ${k}, root ${rank}`)
    }
  }
  assert.ok(checked > 3000, `${checked} roots checked in view`)
})

/** Reads per image of a field of `count` roots: the first, still images, then a sway and a turn. */
function readsOf(count: number) {
  const roots = field(count),
    watch = createImpostorWatch()
  watch.update(roots, section, swayAt(0), FOCAL, COS)
  const first = watch.reads
  let still = 0
  for (let k = 0; k < 8; k++) {
    watch.update(roots, section, swayAt(0), FOCAL, COS)
    still += watch.reads + watch.changedCount
  }
  let moving = 0,
    changed = 0
  for (let k = 1; k <= 120; k++) {
    watch.update(roots, section, swayAt(k, k > 60 ? 0.01 : 0), FOCAL, COS)
    moving += watch.reads
    changed += watch.changedCount
  }
  return { first, still, moving: moving / 120, changed: changed / 120 }
}

test('a still view reads nothing; a moving one what nears its switch, flat in the field’s size', () => {
  const counts = [1e3, 1e4, 1e5].map(readsOf)
  for (const [i, { first, still }] of counts.entries()) {
    assert.equal(first, [1e3, 1e4, 1e5][i], 'the first image reads every root once')
    assert.equal(still, 0, 'a still view reads and changes nothing')
  }
  const [small, , large] = counts
  console.log(
    counts
      .map(({ moving, changed }) => `${moving.toFixed(1)} read, ${changed.toFixed(1)} switched`)
      .join(' · '),
  )
  assert.ok(
    large.moving <= 1.5 * small.moving + 20,
    `${large.moving} reads at 10⁵ against ${small.moving}`,
  )
  assert.ok(large.moving <= 40 * (large.changed + 1), 'reads bounded by the switches')
})
