// The shapes of an object from its shadow body: a rigid object is carried by its own matrix, a skinned one by its bone's skinning matrix.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Skeleton } from '../../../../sdk-core/src/world/animation/skeleton.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { CAPSULE_SHAPE_FLOATS } from './shapes.ts'
import { restBodiesOf, writeObjectShapes, type CapsuleObject } from './gather.ts'

const world = (x: number) => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1])
const sphere = { bone: 'none', kind: 'sphere', center: [1, 0, 0], radius: 0.5 } as const

test('a body with no skeleton is carried by the object’s matrix alone', () => {
  const bodies = restBodiesOf([sphere], undefined)
  assert.equal(bodies[0].bone, -1)
  const out = new Float32Array(CAPSULE_SHAPE_FLOATS)
  const ranges: number[] = []
  const rigid: CapsuleObject = {
    bodies,
    skeleton: undefined,
    world: world(10),
    direct: true,
    indirect: false,
    minVisibility: 0.1,
  }
  const count = writeObjectShapes(
    out,
    [rigid, { ...rigid, direct: false }],
    (o) => o.direct,
    [0, 0, 0],
    ranges,
  )
  assert.equal(count, 1)
  assert.deepEqual(ranges, [0, 1])
  assert.deepEqual([...out.slice(0, 4)], [11, 0, 0, 0.5])
})

test('a body on a bone follows the bone from its bind pose', () => {
  const root = object.group()
  const arm = object.group()
  arm.name = 'arm'
  root.add(arm)
  root.updateMatrixWorld(true)
  const skeleton = new Skeleton([arm])
  const bodies = restBodiesOf([{ ...sphere, bone: 'arm' }], skeleton)
  assert.equal(bodies[0].bone, 0)
  arm.position.set(0, 2, 0)
  root.updateMatrixWorld(true)
  const out = new Float32Array(CAPSULE_SHAPE_FLOATS)
  writeObjectShapes(
    out,
    [{ bodies, skeleton, world: world(0), direct: true, indirect: false, minVisibility: 0.1 }],
    () => true,
    [0, 0, 0],
    [],
  )
  assert.deepEqual([...out.slice(0, 3)], [1, 2, 0])
})

test('the shapes stop where the room ends', () => {
  const bodies = restBodiesOf([sphere, sphere], undefined)
  const out = new Float32Array(CAPSULE_SHAPE_FLOATS)
  assert.equal(
    writeObjectShapes(
      out,
      [
        {
          bodies,
          skeleton: undefined,
          world: world(0),
          direct: true,
          indirect: true,
          minVisibility: 0.1,
        },
      ],
      () => true,
      [0, 0, 0],
      [],
    ),
    0,
  )
})
