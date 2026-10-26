// The draw distance a placement's mark gates (`drawDistanceWgsl.ts`): a placement is out where the
// sphere of its bounds lies wholly nearer than its nearest or wholly farther than its farthest, a
// group where no placement can be drawn; the shipped kernel run in JavaScript (`drawDistance.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './selectionShader.fixture.ts'
import { DRAW_DISTANCE_MARK, DRAW_INSTANCE_MARK } from '../frameTable.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import {
  CULL_DRAW_DISTANCE_OFF,
  CULL_NO_DRAW_DISTANCES,
  CULL_SPHERE_EDGE_OFF,
} from './viewsWgsl.ts'
import {
  carriedBounds,
  drawKernel,
  members,
  placement,
  poseOf,
  referenceSphereRadius,
} from './drawDistance.fixture.ts'
import {
  DRAW_DISTANCE_STRIDE,
  drawDistanceAt,
  sameDrawDistanceAt,
  writeDrawDistanceAt,
} from '../drawDistance.ts'
import { drawSphereRadius, outsideDrawDistances } from '../drawDistanceOracle.fixture.ts'
import { fitDrawDistances, outsideGroupDrawDistance } from '../oracle/nodeVerdict.fixture.ts'

const OWN = DRAW_DISTANCE_MARK,
  INSTANCE = DRAW_DISTANCE_MARK | DRAW_INSTANCE_MARK

test('an object is out where its sphere lies wholly nearer than its nearest or wholly farther than its farthest', () => {
  // A point (radius 0): both ends drawn, a scale multiplying both, 0 of an end naming none of it.
  assert.equal(outsideDrawDistances(50, 0, 10, 100, 1), false)
  assert.equal(outsideDrawDistances(5, 0, 10, 100, 1), true, 'nearer than its nearest')
  assert.equal(outsideDrawDistances(101, 0, 10, 100, 1), true, 'past its farthest')
  assert.equal(outsideDrawDistances(100, 0, 10, 100, 1), false)
  assert.equal(outsideDrawDistances(5, 0, 0, 100, 1), false, 'a nearest of 0 names none')
  assert.equal(outsideDrawDistances(1e9, 0, 10, 0, 1), false, 'a nearest alone culls nothing far')
  assert.equal(outsideDrawDistances(5, 0, 10, 0, 1), true, 'and everything wholly nearer')
  assert.equal(outsideDrawDistances(15, 0, 10, 100, 2), true, 'its nearest is 20 at a scale of 2')
  assert.equal(outsideDrawDistances(150, 0, 10, 100, 2), false, 'its farthest is 200')
  assert.equal(outsideDrawDistances(1, 0, 10, 100, 0), true, 'a scale of 0 draws only the eye')
  // A sphere: its nearest point is the farthest distance's, its farthest point the nearest's.
  assert.equal(outsideDrawDistances(105, 5, 10, 100, 1), false)
  assert.equal(outsideDrawDistances(106, 5, 10, 100, 1), true)
  assert.equal(outsideDrawDistances(106, 0, 10, 100, 1), true, 'its centre alone is out at 101')
  assert.deepEqual(
    [7, 6].map((d) => outsideDrawDistances(d, 3, 10, 100, 1)),
    [false, true],
  )
  assert.equal(outsideDrawDistances(2, 50, 10, 100, 1), false, 'a sphere holding the eye')
  assert.equal(outsideDrawDistances(2, 50, 60, 100, 1), true, 'wholly nearer than 60')
})

test('the sphere of a box is the reference’s: its half diagonal at the greatest row, held to the half diagonal of the box its pose makes', () => {
  // A pole 0.2 × 10 × 0.2 stretched ×3 along x: the unheld sphere is 15 m, the box it makes 5.01.
  const low = [-0.1, -5, -0.1],
    high = [0.1, 5, 0.1],
    pose = poseOf([0, 0, 0], [3, 1, 1])
  assert.ok(Math.abs(referenceSphereRadius(pose, low, high) - Math.hypot(0.3, 5, 0.1)) < 1e-9)
  assert.ok(Math.hypot(0.1, 5, 0.1) * 3 > 15, 'the half diagonal at the scale would reach 15 m')
  assert.ok(Math.abs(drawSphereRadius(pose, [0.1, 5, 0.1]) - 5.0098) < 1e-3)
  const kernel = drawKernel(pose)
  assert.ok(Math.abs(kernel.drawSphereRadius(new Mat(pose), [0.1, 5, 0.1]) - 5.0098) < 1e-3)
  // A uniform scale holds nothing back, and a turned one is the greatest row, not the axis scale.
  const flat = poseOf([0, 0, 0], [2, 2, 2], 0.7, 0.3)
  assert.ok(Math.abs(drawSphereRadius(flat, [1, 2, 3]) - 2 * Math.hypot(1, 2, 3)) < 1e-9)
})

test('the radius the cut and the rays take equals the reference’s on poses stretched unevenly and boxes long on one axis', () => {
  const next = lcgRandom(5)
  let held = 0
  for (let n = 0; n < 2000; n++) {
    const { m, low, high } = placement(next),
      half = high,
      reference = referenceSphereRadius(m, low, high)
    const kernel = drawKernel(m)
    assert.ok(Math.abs(drawSphereRadius(m, half) - reference) <= 1e-9 * reference, `twin ${n}`)
    const shipped = kernel.drawSphereRadius(new Mat(m), half)
    assert.ok(Math.abs(shipped - reference) <= 1e-4 * reference, `kernel ${n}`)
    // The hold is not idle: the unheld sphere is often the larger.
    const unheld =
      Math.hypot(...half) * Math.max(...[0, 1, 2].map((r) => Math.hypot(m[r], m[4 + r], m[8 + r])))
    if (unheld > reference * 1.01) held++
  }
  assert.ok(held > 300, `${held} of 2000 held to the box`)
})

test('a group is out only where no placement can be drawn, whatever the stretch of its placements and the kind of each', () => {
  const none = { near: 0, far: 0 }
  const named = [
    { near: 5, far: 50 },
    { near: 2, far: 80 },
    { near: 9, far: 60 },
  ]
  assert.deepEqual(fitDrawDistances(named), { near: 2, far: 80 })
  // One placement drawn at every distance makes the group's none, and so does a group with none.
  assert.deepEqual(fitDrawDistances([...named, { near: 3, far: 0 }]), none)
  assert.deepEqual(fitDrawDistances([]), none)
  const next = lcgRandom(7)
  let culled = 0,
    kept = 0
  for (let n = 0; n < 4000; n++) {
    const group = members(next),
      scales = [next() < 0.5 ? 1 : next() * 3, next() < 0.5 ? 1 : next() * 3] as const
    const low = [0, 1, 2].map((a) => Math.min(...group.map((m) => m.carried.low[a]))),
      high = [0, 1, 2].map((a) => Math.max(...group.map((m) => m.carried.high[a])))
    const fit = fitDrawDistances(group)
    if (!outsideGroupDrawDistance(fit.near, fit.far, low, high, scales)) {
      kept++
      continue
    }
    culled++
    for (const m of group)
      assert.ok(
        outsideDrawDistances(
          Math.hypot(...m.centre),
          m.radius,
          m.near,
          m.far,
          scales[+!m.instance],
        ),
        'a placement it would draw',
      )
  }
  assert.ok(culled > 100 && kept > 100, `${culled} culled, ${kept} kept`)
})

test('a placement the group’s tree grouping would hide is drawn or hidden with the group: the elongated pole stretched across its box', () => {
  // A box (-1,-100,-1)..(1,100,1) stretched ×10 along x, its centre 1100 m out, a farthest of 500 m:
  // the sphere unheld is 1000 m and would keep it; held to its box it is 100.5 m and 1100 − 100.5 is
  // past 500, so the placement is out — and so is the group it stands in alone.
  const low = [-1, -100, -1],
    high = [1, 100, 1],
    m = poseOf([1100, 0, 0], [10, 1, 1])
  const radius = referenceSphereRadius(m, low, high),
    box = carriedBounds(m, low, high)
  assert.ok(Math.abs(radius - Math.hypot(10, 100, 1)) < 1e-9)
  assert.equal(outsideDrawDistances(1100, radius, 0, 500, 1), true)
  assert.equal(outsideGroupDrawDistance(0, 500, box.low, box.high), true)
  const kernel = drawKernel(m)
  kernel.placement(0, 500)
  kernel.group(0, 500)
  assert.equal(kernel.outsideDrawDistance(3, OWN, { minimum: low, maximum: high }), true)
  assert.equal(kernel.outsideGroupDrawDistance(5, box.low, box.high), true)
})

test('the shipped kernel is out of the distances as the CPU’s function is, a pair for the instances and a pair for the objects of their own', () => {
  const next = lcgRandom(11),
    range = (low: number, high: number) => low + next() * (high - low)
  let culled = 0,
    byEdge = 0
  for (let n = 0; n < 3000; n++) {
    const { m, low, high } = placement(next, 20),
      kernel = drawKernel(m)
    Object.assign(kernel.view, {
      viewDistanceScale: next() < 0.4 ? 1 : range(0, 3),
      primitiveDistanceScale: next() < 0.4 ? 1 : range(0, 3),
    })
    const near = next() < 0.4 ? 0 : range(0, 200),
      far = next() < 0.25 ? 0 : near + range(1, 300),
      instance = next() < 0.5,
      mark = instance ? INSTANCE : OWN,
      node = { minimum: low, maximum: high }
    kernel.placement(near, far)
    const away = Math.hypot(m[12], m[13], m[14]),
      scale = instance ? kernel.view.viewDistanceScale : kernel.view.primitiveDistanceScale
    const radius = instance ? 0 : referenceSphereRadius(m, low, high)
    const out = (d: number, r: number) => outsideDrawDistances(d, r, near, far, scale)
    const verdict = kernel.outsideDrawDistance(3, mark, node)
    // The kernel's single precision is the double's but for a case on the edge of a distance.
    const spread = 1e-3 * (away + radius)
    if (verdict !== out(away, radius))
      assert.notEqual(out(away - spread, radius), out(away + spread, radius), `edge ${n}`)
    if (verdict) culled++
    // The sphere's edge turned off, an object tests its centre alone, as an instance does.
    kernel.view.cullOff = CULL_SPHERE_EDGE_OFF
    if (!instance && kernel.outsideDrawDistance(3, mark, node) !== verdict) byEdge++
    kernel.view.cullOff = 0
    assert.equal(kernel.outsideDrawDistance(3, 0, node), false, 'no bit, no distance')
  }
  assert.ok(culled > 300 && culled < 2700, `${culled} of 3000 culled`)
  assert.ok(byEdge > 20, `${byEdge} objects the sphere's edge draws and the centre culls`)
})

test('the host’s switch turns off the instances’ cull alone: an object of its own is tested whatever it says', () => {
  const kernel = drawKernel(poseOf([200, 0, 0])),
    node = { minimum: [-1, -1, -1], maximum: [1, 1, 1] }
  kernel.placement(0, 100)
  assert.equal(kernel.outsideDrawDistance(3, OWN, node), true)
  assert.equal(kernel.outsideDrawDistance(3, INSTANCE, node), true)
  kernel.view.cullOff = CULL_DRAW_DISTANCE_OFF
  assert.equal(kernel.outsideDrawDistance(3, OWN, node), true, 'an object of its own is culled')
  assert.equal(kernel.outsideDrawDistance(3, INSTANCE, node), false, 'an instance is not')
  // Each mark takes its own scale: an object of its own the primitives', an instance the views'.
  kernel.view.cullOff = 0
  Object.assign(kernel.view, { viewDistanceScale: 3, primitiveDistanceScale: 1 })
  assert.equal(kernel.outsideDrawDistance(3, OWN, node), true)
  assert.equal(kernel.outsideDrawDistance(3, INSTANCE, node), false, '3 × 100 m reaches 200 m')
  // The placement's mark bit decides: none, no distance, whatever the words say.
  assert.equal(kernel.outsideDrawDistance(3, 0, node), false)
  assert.ok(DAG_SELECTION_SHADER.includes(`if((mark&${DRAW_DISTANCE_MARK}u)==0u){return false;}`))
})

test('the shipped kernel’s group is out as the CPU’s is, with the nearest at the smaller scale and the farthest at the larger', () => {
  const next = lcgRandom(13),
    range = (low: number, high: number) => low + next() * (high - low)
  let culled = 0
  for (let n = 0; n < 2000; n++) {
    const kernel = drawKernel(),
      scales = [range(0.2, 3), range(0.2, 3)] as const,
      near = next() < 0.4 ? 0 : range(0, 200),
      far = near + range(1, 300)
    Object.assign(kernel.view, { viewDistanceScale: scales[0], primitiveDistanceScale: scales[1] })
    kernel.group(near, far)
    const low = [range(-300, 300), range(-300, 300), range(-300, 300)],
      high = low.map((v) => v + range(0, 80))
    const expected = outsideGroupDrawDistance(near, far, low, high, scales)
    const verdict = kernel.outsideGroupDrawDistance(5, low, high)
    if (verdict !== expected) assert.ok(Math.abs(near - far) < 1e-3, `group ${n}`)
    if (expected) culled++
    // The instances’ switch off, or a packing naming no distance: a group is never culled.
    for (const bits of [CULL_DRAW_DISTANCE_OFF, CULL_NO_DRAW_DISTANCES]) {
      kernel.view.cullOff = bits
      assert.equal(kernel.outsideGroupDrawDistance(5, low, high), false)
    }
    // A cut in one pass tests its placements alone.
    kernel.view.cullOff = 0
    kernel.view.occlusion = 0
    assert.equal(kernel.outsideGroupDrawDistance(5, low, high), false)
  }
  assert.ok(culled > 100 && culled < 1900, `${culled} of 2000 culled`)
})

test('a group holding the eye is kept, one naming no distance between its distances is kept, and a scale of 0 culls what cannot hold the eye', () => {
  const kernel = drawKernel(),
    around = [
      [-500, -500, -500],
      [500, 500, 500],
    ],
    beyond = [
      [190, -5, -5],
      [210, 5, 5],
    ]
  kernel.group(0, 100)
  assert.equal(kernel.outsideGroupDrawDistance(5, around[0], around[1]), false, 'the eye inside')
  assert.equal(kernel.outsideGroupDrawDistance(5, beyond[0], beyond[1]), true, 'past its farthest')
  Object.assign(kernel.view, { viewDistanceScale: 0, primitiveDistanceScale: 0 })
  assert.equal(kernel.outsideGroupDrawDistance(5, beyond[0], beyond[1]), true, 'a scale of 0')
  assert.equal(kernel.outsideGroupDrawDistance(5, around[0], around[1]), false)
  Object.assign(kernel.view, { viewDistanceScale: 1, primitiveDistanceScale: 1 })
  kernel.group(50, 50)
  assert.equal(kernel.outsideGroupDrawDistance(5, beyond[0], beyond[1]), false, 'min equal to max')
  // A group is kept where a placement reaches in from past the box with a sphere as big as its own.
  kernel.group(0, 100)
  const low = [110, -10, -10],
    high = [130, 10, 10]
  assert.equal(kernel.outsideGroupDrawDistance(5, low, high), false)
  assert.equal(outsideDrawDistances(111, 17.3, 0, 100, 1), false, 'the placement is drawn')
})

test('a column of draw distances is read and written by one layout: three floats a placement, none where it names none', () => {
  const column = new Float32Array(DRAW_DISTANCE_STRIDE * 4)
  assert.equal(drawDistanceAt(undefined, 2), undefined, 'no column, no placement names one')
  assert.equal(drawDistanceAt(column, 1), undefined, 'a zero row names none')
  writeDrawDistanceAt(column, 1, { min: 2.5, max: 90, perInstance: false })
  writeDrawDistanceAt(column, 3, { min: 4, max: 0, perInstance: false })
  writeDrawDistanceAt(column, 2, { min: 4, max: 0, perInstance: true })
  assert.deepEqual(drawDistanceAt(column, 1), { min: 2.5, max: 90, perInstance: false })
  assert.deepEqual(drawDistanceAt(column, 3), { min: 4, max: 0, perInstance: false })
  assert.equal(drawDistanceAt(column, 2), undefined, 'an instance’s nearest alone is none')
  assert.deepEqual(Array.from(column.subarray(3, 6)), [2.5, 90, 0], 'nearest, farthest, instance')
  // Compared in place, nothing made of the column's floats.
  assert.equal(sameDrawDistanceAt(column, 1, { min: 2.5, max: 90, perInstance: false }), true)
  assert.equal(sameDrawDistanceAt(column, 1, { min: 2.5, max: 90, perInstance: true }), false)
  assert.equal(sameDrawDistanceAt(column, 2, undefined), true, 'a row that names none')
  assert.equal(sameDrawDistanceAt(undefined, 0, undefined), true)
  assert.equal(sameDrawDistanceAt(undefined, 0, { min: 0, max: 1, perInstance: false }), false)
  writeDrawDistanceAt(column, 1, undefined)
  assert.deepEqual(Array.from(column.subarray(3, 6)), [0, 0, 0])
})
