import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const native = (...args: string[]) =>
  spawnSync(process.execPath, ['scripts/native.ts', ...args], { encoding: 'utf8' })

// Behaviour: an unknown command or crate is an error naming it, exit 2, before any cargo runs.
test('an unknown command or crate exits 2 naming it', () => {
  for (const [args, named] of [
    [['nothing'], 'one of'],
    [['test', 'packages/nope'], 'packages/nope'],
    [['test', './packages/nope/'], 'packages/nope'],
  ] as const) {
    const run = native(...args)
    assert.equal(run.status, 2, args.join(' '))
    assert.ok(run.stderr.includes(named), run.stderr)
  }
})
