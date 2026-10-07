// The group's exit from the ray loops (`rayCountStatement`, `traceWgsl.ts`) is the projection's alone: the
// fragment stage's trace, which has no group, never asks for it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CODE } from './pageWorld.fixture.ts'

test('the exit is the projection’s alone', () => {
  assert.equal(CODE.match(/&&vsmGroupVoted\(halfStops\)\)\{break;\}/g)?.length, 2)
  // Asked at the first vote and the umbra one, never at the last ray.
  assert.match(CODE, /\(i==0u\|\|i==u32\(settings\.voteAfter\)\)&&i\+1u<rayCap&&/)
})
