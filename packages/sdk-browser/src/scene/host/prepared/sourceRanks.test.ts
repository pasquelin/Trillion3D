import test from 'node:test'
import assert from 'node:assert/strict'
import { readPreparedSourceRank } from './sourceRanks.ts'

test('fixed-width source ranks decode every u32 boundary and reject malformed encodings', () => {
  assert.equal(readPreparedSourceRank('00000000', 7), 0)
  assert.equal(readPreparedSourceRank('ffffffff', 7), 0xffffffff)
  assert.equal(readPreparedSourceRank(undefined, 7), 7)
  for (const value of [0, null, '', '09000', '000009000', 'FFFFFFFF', '0000900g', '-0000001'])
    assert.throws(() => readPreparedSourceRank(value, 7), /eight lowercase hexadecimal digits/)
})

test('a node of a partitioned table names its source rank: its table rank would name another node', () => {
  assert.equal(readPreparedSourceRank('00000002', 0, true), 2)
  assert.throws(() => readPreparedSourceRank(undefined, 0, true), {
    code: 'INVALID_SCENE_TABLES',
    message: 'a node of a partitioned table names no sourceNode',
  })
})
