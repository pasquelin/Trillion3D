// The roots pass's parameters are sent when the roots or the lists they run over move, never on a
// still frame: one uniform block, whatever the world's size. On a generated session of two
// composed roots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { session, turn } from './composeSession.fixture.ts'

test('a still frame sends the roots pass no parameter, one block whatever the world', () => {
  const { rt, rows, frame, writes } = session()
  composeWebgpuPlacements(
    rt,
    {},
    turn(0),
    [0, 1].map((index) => ({ rows, index, local: turn(0) })),
    true,
  )
  frame()
  const block = rt.compose!.gpu!.rootParams.buffer
  assert.ok(block, 'the roots pass ran')
  assert.equal(block.size, 16, 'one block of four words')
  const params = () => writes.filter((write) => write.buffer === block).length
  const sent = params()
  assert.ok(sent > 0)
  frame()
  assert.equal(params(), sent, 'the same roots and lists: no parameter sent')
})
