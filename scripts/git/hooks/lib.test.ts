// The pre-commit hook's branch read (`currentBranch`): the branch's name, even before its first
// commit, and nothing when detached, where `symbolic-ref -q` fails: never a throw that refuses
// every commit. Old code: `git branch --show-current`, which an older git does not know, threw.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../git-paths.ts'
import { currentBranch } from './lib.ts'

test('the branch is read on an unborn branch, empty when detached or outside a checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'hook-branch-'))
  try {
    assert.equal(currentBranch(root), '', 'no checkout: empty, no throw')
    git(root, 'init', '-q', '-b', '42-name')
    assert.equal(currentBranch(root), '42-name', 'named before its first commit')
    git(
      root,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'a',
    )
    git(root, 'checkout', '-q', '--detach')
    assert.equal(currentBranch(root), '', 'detached')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
