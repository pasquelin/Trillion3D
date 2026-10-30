import assert from 'node:assert/strict'
import { test } from 'node:test'
import { skyTableMips } from '../pathTracing/skyWgsl.ts'
import { SKY_TABLE_BLOCK, skyTableBytes } from './skyTable.ts'

test('a table of 512 texels a side holds the radiance, the density and its mip chain', () => {
  assert.equal(skyTableBytes(512), 512 * 512 * (16 + 4) + (512 * 512 * 4) / 3)
  assert.equal(skyTableMips(512), 10)
})

test('the build parameters of each level sit a uniform offset apart', () => {
  assert.equal(SKY_TABLE_BLOCK, 256)
})
