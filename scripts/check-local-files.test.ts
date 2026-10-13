import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { trackedIgnoredFiles } from './check-local-files.ts'
import { git } from './git-paths.ts'
import { repositoryFiles } from './repository-files.ts'
import { existingChangedFiles } from './check-changed.ts'
import { consumerImports } from './sdk-api-model.ts'

test('ignored personal content stays outside shared checks and force-addition is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-local-files-'))
  try {
    git(root, 'init', '-q')
    writeFileSync(join(root, '.gitignore'), 'personal/\nPRIVATE.md\n')
    mkdirSync(join(root, 'personal'))
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'personal/session.test.ts'), 'throw Error("private");')
    writeFileSync(join(root, 'docs/PRIVATE.md'), 'private')
    writeFileSync(join(root, 'docs/guide.md'), 'guide')
    git(root, 'add', '.')
    assert.deepEqual(trackedIgnoredFiles(root), [])
    const files = repositoryFiles(root)
    assert.ok(files)
    assert.deepEqual(files.sort(), ['.gitignore', 'docs/guide.md'])
    git(root, 'add', '--force', 'docs/PRIVATE.md')
    assert.deepEqual(trackedIgnoredFiles(root), ['docs/PRIVATE.md'])
    git(root, 'rm', '--cached', 'docs/PRIVATE.md')
    const changed = new Set(['docs/PRIVATE.md', 'docs/guide.md'])
    assert.deepEqual(existingChangedFiles(changed, root), ['docs/guide.md'])
    writeFileSync(join(root, 'personal/helper.ts'), "import { hidden } from 'trillion3d';")
    writeFileSync(join(root, 'consumer.ts'), "import { visible } from 'trillion3d';")
    assert.deepEqual([...consumerImports(root)], [['visible', new Set(['consumer.ts'])]])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
