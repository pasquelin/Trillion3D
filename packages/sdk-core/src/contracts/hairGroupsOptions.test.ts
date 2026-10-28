// The groups of a groom as a job names them: only what the job named reaches the compiler.
import test from 'node:test'
import assert from 'node:assert/strict'
import { hairGroupsJob, type HairGroupsOption } from './hairGroupsOptions.ts'

test('a job that names no group, or only empty ones, gives the compiler nothing', () => {
  const none: (HairGroupsOption | null | undefined)[] = [
    undefined,
    null,
    {},
    { 3: {} },
    { 3: { scatterSceneLighting: null } },
  ]
  for (const hairGroups of none)
    assert.deepEqual(hairGroupsJob.fields({ hairGroups }), {}, JSON.stringify(hairGroups))
  assert.deepEqual(hairGroupsJob.flags({}), [])
})

test('a group gives the compiler the settings it named, under its group number', () => {
  const hairGroups = { 2: { stableRasterization: true }, '-1': { scatterSceneLighting: false } }
  const wire = { 2: { stableRasterization: true }, '-1': { scatterSceneLighting: false } }
  assert.deepEqual(hairGroupsJob.fields({ hairGroups }), { hairGroups: wire })
  assert.deepEqual(hairGroupsJob.flags({ hairGroups }), [`--hair-groups=${JSON.stringify(wire)}`])
})

test('what is not a group number, a setting or a boolean is refused by name', () => {
  assert.throws(
    () => hairGroupsJob.fields({ hairGroups: { hair: {} } }),
    /hairGroups.*group number/,
  )
  assert.throws(() => hairGroupsJob.fields({ hairGroups: { 1.5: {} } }), /group number/)
  assert.throws(() => hairGroupsJob.fields({ hairGroups: { 1: 'stable' } as never }), /object/)
  assert.throws(
    () => hairGroupsJob.fields({ hairGroups: { 1: { shadow: true } } as never }),
    /setting/,
  )
  assert.throws(
    () => hairGroupsJob.fields({ hairGroups: { 1: { stableRasterization: 1 } } as never }),
    /true or false/,
  )
  assert.throws(() => hairGroupsJob.fields({ hairGroups: [] as never }), /object/)
})
