import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FILTER_CODE } from './filterWgsl.ts'

test('the cube filter reads its source through a filtering sampler, not the nearest texel', () => {
  assert.match(FILTER_CODE, /var cubeSampler:sampler;/)
  assert.match(FILTER_CODE, /textureSampleLevel\(source,cubeSampler,d,level\)/)
  assert.doesNotMatch(FILTER_CODE, /\bnearest\b/)
})
