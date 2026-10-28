import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPACT_ARGS_ENTRY,
  COMPACT_ENTRY,
  COMPACT_THREADS,
  compactArgsWgsl,
  compactWgsl,
} from './compactWgsl.ts'

test('the compaction lists the rays still to trace and turns their count into the groups of the dispatch over them', () => {
  const list = compactWgsl()
  assert.ok(list.includes(`fn ${COMPACT_ENTRY}(`))
  assert.ok(list.includes('override MODE'))
  const args = compactArgsWgsl()
  assert.ok(args.includes(`fn ${COMPACT_ARGS_ENTRY}(`))
  assert.ok(args.includes(`(compactCount[SLOT]+${COMPACT_THREADS - 1}u)/${COMPACT_THREADS}u`))
})
