import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workgroupSize } from './passSizes.ts'

const fn = (size: string) => `@compute @workgroup_size(${size}) fn main() {}`

test('a workgroup size is read from numbers, constants and overrides, and 0 when it cannot be', () => {
  assert.equal(workgroupSize(fn('64'), 'main', undefined), 64)
  assert.equal(workgroupSize(fn('8u, 8u'), 'main', undefined), 64)
  assert.equal(workgroupSize(`const WG = 16u;\n${fn('WG, 2')}`, 'main', undefined), 32)
  assert.equal(
    workgroupSize(`override LANES_u: u32 = 64;\n${fn('LANES_u')}`, 'main', undefined),
    64,
  )
  assert.equal(workgroupSize(`override WG: u32 = 64;\n${fn('WG')}`, 'main', { WG: 128 }), 128)
  assert.equal(
    workgroupSize(`const WG = 4u * 16u;\n${fn('WG')}`, 'main', undefined),
    0,
    'an expression is not a number read',
  )
  assert.equal(workgroupSize('fn nothing() {}', 'main', undefined), 0)
})
