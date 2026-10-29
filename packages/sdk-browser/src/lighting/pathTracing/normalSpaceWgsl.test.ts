// The normal's turn into the camera's space, run in JavaScript from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { Mat3 } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PT_NORMAL_SPACE_ENTRY, PT_NORMAL_SPACE_WGSL } from './normalSpaceWgsl.ts'

const toCamera = () =>
  shaderRun<{ ptNormalToCamera: (m: Mat3, n: number[]) => number[] }>(
    PT_NORMAL_SPACE_WGSL,
    ['ptNormalToCamera'],
    {},
  ).ptNormalToCamera

test('a normal is rotated, not moved: the fourth component is 0', () => {
  const identity = new Mat3([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ])
  assert.deepEqual(toCamera()(identity, [0, 0, 1]), [0, 0, 1, 0])
})

test('the rotation turns a world normal into the camera’s axes: a quarter turn about z sends x to y and y to −x', () => {
  const quarter = new Mat3([
    [0, 1, 0],
    [-1, 0, 0],
    [0, 0, 1],
  ])
  const turn = toCamera()
  assert.deepEqual(turn(quarter, [1, 0, 0]), [0, 1, 0, 0])
  assert.deepEqual(turn(quarter, [0, 1, 0]), [-1, 0, 0, 0])
  assert.deepEqual(turn(quarter, [0, 0, 1]), [0, 0, 1, 0])
  const slanted = turn(quarter, [0.6, 0.0, 0.8])
  assert.ok(Math.abs(Math.hypot(slanted[0], slanted[1], slanted[2]) - 1) < 1e-12)
})

test('the program assembles: every name declared, none reserved, the entry present', () => {
  assertProgramAssembles(
    wgslSource(PT_NORMAL_SPACE_WGSL),
    PT_NORMAL_SPACE_ENTRY,
    'the normal space kernel',
  )
})
