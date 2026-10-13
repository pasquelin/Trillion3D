import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { sideOf } from './materialSide.ts'

test('sideOf: each declared side is the record side, the first of an array decides', () => {
  const front = G.basicSurface({ side: G.FRONT_SIDE }),
    back = G.basicSurface({ side: G.BACK_SIDE }),
    double = G.basicSurface({ side: G.DOUBLE_SIDE })
  assert.equal(sideOf(front), 'front')
  assert.equal(sideOf(back), 'back')
  assert.equal(sideOf(double), 'double')
  assert.equal(sideOf([back, double]), 'back')
  assert.equal(sideOf(G.basicSurface()), 'front', 'unsaid, front')
  assert.equal(sideOf([]), 'front', 'an empty array declares nothing: front, not a crash')
})
