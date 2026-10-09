// The group's exit from the ray loops (`rayCountStatement`, `traceWgsl.ts`): one in each trace, asked
// where its halves vote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CODE } from './pageWorld.fixture.ts'

test('each trace leaves its loop where both halves voted to stop', () => {
  assert.equal(CODE.match(/&&vsmGroupVoted\(halfStops\)\)\{break;\}/g)?.length, 2)
  // Asked at the first vote and the umbra one, never at the last ray.
  assert.match(CODE, /\(i==0u\|\|i==u32\(settings\.voteAfter\)\)&&i\+1u<rayCap&&/)
})
