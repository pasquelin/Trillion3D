import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from './git-paths.ts'
import { changedFiles } from './repository-files.ts'

// Behaviour: every gate reads one list of the branch's files, a renamed file under both its names
// and a new file not yet added: a gate never judges a rename the other gates miss.
test('the changed files name a rename by both its paths, and the untracked files', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'changed-files-'))
  t.after(() => rmSync(root, { recursive: true }))
  git(root, 'init', '-q', '-b', process.env.TRILLION3D_BASE_REF ?? 'develop')
  writeFileSync(join(root, 'kept.ts'), 'export const kept = 1\n')
  writeFileSync(
    join(root, 'moved.ts'),
    'export const moved = "a file long enough to be a rename"\n',
  )
  git(root, 'add', '.')
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'a')
  git(root, 'mv', 'moved.ts', 'renamed.ts')
  writeFileSync(join(root, 'new.ts'), '')
  assert.deepEqual([...(await changedFiles(root))].sort(), ['moved.ts', 'new.ts', 'renamed.ts'])
})
