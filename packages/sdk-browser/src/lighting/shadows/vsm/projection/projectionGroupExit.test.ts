// The group's exit from the ray loop (`rayCountStatement`, `../trace/traceWgsl.ts`): one in the one trace
// every light's map runs, asked where its halves vote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CODE } from '../pageWorld.fixture.ts'

test('the trace leaves its loop where both halves voted to stop', () => {
  assert.equal(CODE.match(/\{if\(vsmGroupVoted\(halfStops\)\)\{break;\}\}/g)?.length, 1)
  // Asked at the first vote and the umbra one (where the adaptive ray count is on), never at the last ray.
  assert.match(CODE, /let votes=vsm\.adaptiveRayCount>0u&&\(i==0u\|\|i==vsm\.adaptiveRayCount\);/)
  assert.match(CODE, /if\(votes&&i\+1u<rayCap\)\{if\(vsmGroupVoted\(halfStops\)\)\{break;\}\}/)
})
