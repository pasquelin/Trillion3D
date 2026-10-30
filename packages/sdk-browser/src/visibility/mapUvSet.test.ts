import assert from 'node:assert/strict'
import test from 'node:test'
import { mapUvSetFlags, mapUvSetOf, MAP_UV_SET } from './mapUvSet.ts'
import { FLAG_MAP_UV_HIGH, FLAG_MAP_UV_LOW, FLAG_MAP_UV_TOP } from './types.ts'

test('the texture set round-trips through the three flags, 0 to 7', () => {
  for (let set = 0; set < 8; set++) assert.equal(mapUvSetOf(mapUvSetFlags(set)), set)
  assert.equal(mapUvSetFlags(1), FLAG_MAP_UV_LOW)
  assert.equal(mapUvSetFlags(2), FLAG_MAP_UV_HIGH)
  assert.equal(mapUvSetFlags(4), FLAG_MAP_UV_TOP)
})

test('the WGSL twin reads the same bits', () => {
  const text = MAP_UV_SET.text
  for (const flag of [FLAG_MAP_UV_LOW, FLAG_MAP_UV_HIGH, FLAG_MAP_UV_TOP])
    assert.ok(text.includes(`(flags&${flag}u)!=0u`))
})
