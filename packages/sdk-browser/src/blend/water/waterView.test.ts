// The camera against the water bodies: outside, possibly in the water, or under it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { WaterExclusionVolume } from '../../../../sdk-core/src/world/object/waterExclusionVolume.ts'
import { classifyWaterView, nearCornerDistance, type WaterFacts } from './waterView.ts'

const underWater = (v: WaterFacts) => v.depth > 0

/** A sea over x and z in [-100, 100] at height 10, carried by waves of the given crest (a flat height at the level, unless a wave
 *  height is given), with an underwater material unless `post` is false. */
const sea = (crest = 0, { post = true, priority = 0, depth = 100, wave = 0, top = 10 } = {}) =>
  ({
    bounds: Float64Array.of(-100, top, -100, 100, top, 100),
    drawSource: {
      node: {
        waves: crest ? { level: top, crest, height: () => top + wave } : null,
        waterBody: { underwaterPostProcess: post, overlapPriority: priority, depth },
      },
    },
  }) as unknown as Parameters<typeof classifyWaterView>[1][number]
const at = (y: number, x = 0) => [x, y, 0]
const view = (): WaterFacts => ({ intersection: 'outside', depth: -1 })

test('a body with no underwater material is not weighed; the default body has one, as every body the reference places', () => {
  assert.equal(classifyWaterView(view(), [sea(0, { post: false })], at(9), 0.1, 1, 0.1).depth, -1)
  const bare = { ...sea(), drawSource: { node: {} } } as unknown as ReturnType<typeof sea>
  const seen = classifyWaterView(view(), [bare], at(9), 0.1, 1, 0.1, () => -50)
  assert.equal(seen.intersection, 'inside')
  assert.equal(seen.depth, 1)
})

test('a body that declares no depth has the scene under its surface for a bottom, else its own box', () => {
  const bare = { ...sea(), drawSource: { node: {} } } as unknown as ReturnType<typeof sea>
  // Nothing known under it: the volume is its box, a camera below is not near it.
  assert.equal(classifyWaterView(view(), [bare], at(5), 0.1, 1, 0.1).depth, -1)
  // A roof pool floor 2 m under the surface: 1 m under is in it, 5 m under (in the room below) is not.
  assert.equal(classifyWaterView(view(), [bare], at(9), 0.1, 1, 0.1, () => 8).depth, 1)
  assert.equal(classifyWaterView(view(), [bare], at(5), 0.1, 1, 0.1, () => 8).depth, -1)
})

test('the volume has a bottom: a camera deeper than it is not near the body', () => {
  assert.equal(classifyWaterView(view(), [sea(0, { depth: 5 })], at(-20), 0.1, 1, 0.1).depth, -1)
  assert.equal(classifyWaterView(view(), [sea(0, { depth: 5 })], at(7), 0.1, 1, 0.1).depth, 3)
})

test('the surface at the camera carries the waves at their clock', () => {
  const swell = sea(0.5, { wave: 0.3 })
  // 10.3 above the camera at 10.2: under the surface, at its depth with the wave.
  const v = classifyWaterView(view(), [swell], at(10.2), 0.1, 1, 0.1)
  assert.ok(Math.abs(v.depth - 0.1) < 1e-9 && underWater(v))
})

test('bodies of different priorities are all weighed, the higher surface giving the depth', () => {
  const low = sea(0, { priority: 1, top: 11 }),
    high = sea(0, { priority: 5, top: 10 })
  const v = classifyWaterView(view(), [low, high], at(10.5), 0.1, 1, 0.1)
  assert.ok(Math.abs(v.depth - 0.5) < 1e-9)
})

test('no body, or none near the camera, leaves the camera outside the water', () => {
  assert.deepEqual(classifyWaterView(view(), [], at(5), 0.1, 1, 0.1), {
    intersection: 'outside',
    depth: -1,
  })
  assert.equal(classifyWaterView(view(), [sea()], at(50), 0.1, 1, 0.1).intersection, 'outside')
  assert.equal(
    classifyWaterView(view(), [sea()], at(10.5, 500), 0.1, 1, 0.1).intersection,
    'outside',
  )
})

test('a camera under the surface is under water, at its depth; deep under is inside', () => {
  const near = classifyWaterView(view(), [sea()], at(9.95), 0.1, 1, 0.1)
  assert.equal(near.intersection, 'possibly')
  assert.ok(Math.abs(near.depth - 0.05) < 1e-9 && underWater(near))
  const deep = classifyWaterView(view(), [sea()], at(7), 0.1, 1, 0.1)
  assert.equal(deep.intersection, 'inside')
  assert.equal(deep.depth, 3)
})

test('a camera above the surface within a crest and the near corner may intersect it, not under', () => {
  const waved = classifyWaterView(view(), [sea(0.5)], at(10.4), 0.1, 1, 0.1)
  assert.equal(waved.intersection, 'possibly')
  assert.ok(!underWater(waved) || waved.depth <= 0)
  assert.equal(
    classifyWaterView(view(), [sea(0.5)], at(10.5 + 0.2), 0.1, 1, 0.1).intersection,
    'outside',
  )
})

test('the near plane corner of a perspective camera', () => {
  const projection = new Float64Array(16)
  projection[0] = 1
  projection[5] = 1
  assert.ok(
    Math.abs(nearCornerDistance({ projection, near: 0.5, perspective: 1 }) - 0.5 * Math.SQRT2) <
      1e-12,
  )
})

// The exclusion volumes (`WaterExclusionVolume`): inside one that excludes a body, the camera is out of that body.
/** A world: a root node with a link that hears everything and does nothing. */
const world = () => {
  const root = new Object3D()
  root._link = { pose() {}, structure() {}, content() {}, posed() {} }
  return root
}
/** The sea, hung under `root`. */
const inSea = (root: Object3D) => {
  const body = sea()
  Object.assign(body.drawSource!.node as object, { parent: root, _link: root._link })
  return body
}
/** A volume of the given centre and size in `root`. */
const volume = (root: Object3D, centre: number[], size: number[]) => {
  const v = new WaterExclusionVolume()
  v.position.set(centre[0], centre[1], centre[2])
  v.scale.set(size[0], size[1], size[2])
  root.add(v)
  return v
}

test('inside a volume that excludes the body, the camera is outside it', () => {
  const root = world(),
    body = inSea(root)
  assert.equal(classifyWaterView(view(), [body], at(9), 0.1, 1, 0.1).depth, 1)
  const hold = volume(root, [0, 9, 0], [4, 4, 4])
  const seen = classifyWaterView(view(), [body], at(9), 0.1, 1, 0.1)
  assert.deepEqual(seen, { intersection: 'outside', depth: -1 })
  // Outside the box, the body counts again.
  assert.equal(classifyWaterView(view(), [body], at(9, 50), 0.1, 1, 0.1).depth, 1)
  root.remove(hold)
  assert.equal(classifyWaterView(view(), [body], at(9), 0.1, 1, 0.1).depth, 1)
})

test('a volume that names another body, or does not overlap this one, changes nothing', () => {
  const root = world(),
    body = inSea(root)
  const listed = volume(root, [0, 9, 0], [4, 4, 4])
  listed.bodies = [body.drawSource!.node as never]
  assert.equal(classifyWaterView(view(), [body], at(9), 0.1, 1, 0.1).depth, 1, 'all but the listed')
  listed.mode = 'onlyListed'
  assert.equal(classifyWaterView(view(), [body], at(9), 0.1, 1, 0.1).depth, -1, 'only the listed')
  listed.bodies = [new Object3D()]
  assert.equal(classifyWaterView(view(), [body], at(9), 0.1, 1, 0.1).depth, 1, 'another body')
  // A box far above the sea overlaps no body: the camera in it is not excluded.
  const high = world(),
    lake = inSea(high)
  volume(high, [0, 60, 0], [4, 4, 4])
  assert.equal(classifyWaterView(view(), [lake], at(60), 0.1, 1, 0.1).depth, -1)
  // A volume of another world does not act.
  const mine = inSea(world())
  assert.equal(classifyWaterView(view(), [mine], at(9), 0.1, 1, 0.1).depth, 1)
})

test('a turned box is tested in its own frame', () => {
  const root = world(),
    body = inSea(root)
  const v = volume(root, [0, 9, 0], [10, 4, 1])
  v.rotation.y = Math.PI / 2
  // The long side runs along z now: x = 2 is outside, z = 2 is inside.
  assert.equal(classifyWaterView(view(), [body], [2, 9, 0], 0.1, 1, 0.1).depth, 1)
  assert.equal(classifyWaterView(view(), [body], [0, 9, 2], 0.1, 1, 0.1).depth, -1)
})
