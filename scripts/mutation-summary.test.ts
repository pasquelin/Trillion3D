import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesGlob } from 'node:path'
import { mutationMarkdown, mutationTargets, summarizeMutation } from './mutation-summary.ts'

test('the summary credits every killing test file, names the idle ones and ranks the survivors', () => {
  const mutants = [
    { fileName: 'a.ts', status: 'Killed', killedBy: ['a.test.ts', 'b.test.ts'] },
    { fileName: 'a.ts', status: 'Killed', killedBy: ['a.test.ts'] },
    { fileName: 'a.ts', status: 'Timeout' },
    { fileName: 'a.ts', status: 'Survived' },
    { fileName: 'b.ts', status: 'NoCoverage' },
    { fileName: 'b.ts', status: 'Survived' },
    { fileName: 'b.ts', status: 'CompileError' },
  ]
  const summary = summarizeMutation(mutants, ['a.test.ts', 'b.test.ts', 'idle.test.ts'])
  assert.equal(summary.score, 50, 'killed and timed out over those plus survived and uncovered')
  assert.deepEqual(
    [...summary.kills],
    [
      ['a.test.ts', 2],
      ['b.test.ts', 1],
      ['idle.test.ts', 0],
    ],
  )
  assert.deepEqual(summary.idle, ['idle.test.ts'])
  assert.deepEqual(
    summary.survivors.map(({ file, count }) => [file, count]),
    [
      ['b.ts', 2],
      ['a.ts', 1],
    ],
  )
  const lines = mutationMarkdown(summary, 1).split('\n')
  assert.equal(lines[0], 'Mutation score: 50.00 % (3 detected, 3 undetected)')
  assert.deepEqual(lines.slice(-2), ['| b.ts | 2 |', ''], 'the top one file alone')
  assert.equal(summarizeMutation([], []).score, 0, 'no mutant: a zero, never NaN')
})

test('a narrowed run mutates the sources it names, never their tests or fixtures', () => {
  const mutated = (globs: string[], file: string) =>
    globs.some((glob) => !glob.startsWith('!') && matchesGlob(file, glob)) &&
    !globs.some((glob) => glob.startsWith('!') && matchesGlob(file, glob.slice(1)))
  const contracts = mutationTargets('packages/sdk-core/src/', [
    'packages/sdk-core/src/contracts/**/*.ts',
  ])
  for (const globs of [mutationTargets('packages/sdk-core/src/'), contracts]) {
    assert.equal(mutated(globs, 'packages/sdk-core/src/contracts/cache.ts'), true)
    assert.equal(mutated(globs, 'packages/sdk-core/src/contracts/cache.test.ts'), false)
    assert.equal(mutated(globs, 'packages/sdk-core/src/scene/core/proxy.fixture.ts'), false)
  }
  assert.equal(mutated(contracts, 'packages/sdk-core/src/scene/core/proxy.ts'), false)
})
