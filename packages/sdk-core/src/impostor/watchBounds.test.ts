// What the watch keeps stays bounded by the roots, and its classes hold where the image can see:
// a root read every image under a still view holds one place in the heaps, never one per read; a
// far root whose pivot lies just past the frustum's widest direction while its sphere still
// reaches the image keeps the plan's verdict; a root appended to the list in place is read, its
// radius taken.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planImpostors, type ImpostorRoot } from './plan.ts'
import { createImpostorWatch } from './watch.ts'
import { COS, FOCAL, PROJECTION, TREE, field, section, viewAt } from './watch.fixture.ts'
import { impostorTexelDepth, impostorTriangleDepth } from './switch.ts'

test('roots read every image under a still view hold one place each in the heaps', () => {
  const roots = field(600),
    watch = createImpostorWatch(),
    view = viewAt([0, 2, 0], 0)
  watch.update(roots, section, view, FOCAL, COS)
  const settled = watch.waiting
  assert.ok(settled > 0 && settled <= roots.length)
  // The engine moves every root each image, the camera still: each is read again.
  for (let image = 0; image < 200; image++) {
    roots.forEach((_, rank) => watch.touch(rank))
    watch.update(roots, section, view, FOCAL, COS)
    assert.equal(watch.reads, roots.length)
  }
  assert.equal(watch.waiting, settled, 'one place a root, whatever the reads')
})

test('a far root past the frustum’s widest direction whose sphere reaches the image keeps the plan’s verdict', () => {
  const view = viewAt([0, 0, 0], 0)
  // The frustum's widest direction from its axis, as the watch widens it, then a little past it.
  const x = 1.01 / PROJECTION[0],
    y = 1.01 / PROJECTION[5],
    past = 1.004
  const length = Math.hypot(past * x, past * y, 1),
    u = [(past * x) / length, (past * y) / length, -1 / length]
  // Just beyond the distance past which a pivot in that cone always switches.
  const a = impostorTexelDepth(TREE.objectRadius, TREE.frameSide, FOCAL),
    b = impostorTriangleDepth(TREE.objectRadius, TREE.rootTriangles, TREE.coverage, FOCAL),
    d = 1.0005 * Math.max(a / COS ** 2, b / COS ** 1.5)
  const root: ImpostorRoot = {
    mesh: 1,
    world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d * u[0], d * u[1], d * u[2], 1] },
  }
  // Its sphere reaches back across the frustum's edge: the root may be drawn.
  assert.ok(Math.asin(TREE.objectRadius / d) > Math.acos(COS) - Math.acos(-u[2]) + 0.001)
  const plan = planImpostors([root], section, view, FOCAL)
  assert.equal(plan.switched[0], 0, 'the plan draws its mesh there')
  const watch = createImpostorWatch()
  watch.update([root], section, view, FOCAL, COS)
  assert.equal(watch.switched[0], plan.switched[0])
})

test('a root appended to the list in place is read, its radius taken', () => {
  const roots = field(300),
    watch = createImpostorWatch(),
    view = viewAt([0, 2, 0], 0)
  watch.update(roots, section, view, FOCAL, COS)
  roots.push({
    mesh: 1,
    world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -2000, 1] },
  })
  watch.update(roots, section, view, FOCAL, COS)
  const rank = roots.length - 1
  assert.equal(watch.reads, 1, 'the appended root alone')
  assert.equal(watch.switched[rank], 1)
  assert.equal(watch.radiusOf(rank), TREE.objectRadius)
  assert.equal(planImpostors(roots, section, view, FOCAL).switched[rank], 1)
})

test('roots whose scale changes every image keep the watch at its size', () => {
  const roots = field(200),
    watch = createImpostorWatch(),
    view = viewAt([0, 2, 0], 0)
  watch.update(roots, section, view, FOCAL, COS)
  const held = watch.hostBytes
  assert.ok(held > 0)
  for (let image = 1; image <= 300; image++) {
    // Every root scaled a little more: each takes another sphere, another bound.
    roots.forEach((root, rank) => {
      const elements = root.world.elements as number[]
      for (const k of [0, 5, 10]) elements[k] = 1 + image / 1000
      watch.touch(rank)
    })
    watch.update(roots, section, view, FOCAL, COS)
  }
  assert.equal(watch.hostBytes, held, 'a bound a root, never one a shape it once took')
})
