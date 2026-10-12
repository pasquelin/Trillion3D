import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { differences } from './compiler-hashes.ts'
import { cacheVersions, classify } from './compiler-versions.ts'

const record = (
  compiler: string,
  files: Record<string, string>,
  versions: Record<string, string>,
) => ({
  compiler,
  files,
  versions,
})
const table = 'scene/native/full/<sha>/world-roots.table'
const page = 'scene/native/full/<sha>/manifest-page-<sha>.json'

// Behaviour: against the base, a family whose version changed may differ, listed with its versions;
// a family whose bytes changed with no version change fails, naming the version to bump.
test('a changed family is allowed with its version changed, and fails without', () => {
  const base = record(
    'develop',
    { [table]: 'a', [page]: 'p', 'scene/proxy.bin': 'x' },
    { worldRoots: '3', proxy: '5' },
  )
  const bumped = record(
    'branch',
    { [table]: 'b', [page]: 'q', 'scene/proxy.bin': 'x' },
    { worldRoots: '5', proxy: '5' },
  )
  const { allowed, failures } = classify(base, bumped, differences(base, bumped))
  assert.deepEqual(failures, [])
  assert.deepEqual([...allowed.keys()], ['worldRoots v3 → v5'])
  assert.deepEqual(allowed.get('worldRoots v3 → v5'), [page, table].sort())
  const silent = record(
    'branch',
    { [table]: 'b', [page]: 'p', 'scene/proxy.bin': 'y' },
    { worldRoots: '3', proxy: '5' },
  )
  assert.deepEqual(
    classify(base, silent, differences(base, silent)).failures,
    [
      { file: 'scene/proxy.bin', bump: ['proxy'] },
      { file: table, bump: ['worldRoots'] },
    ].sort((a, b) => a.file.localeCompare(b.file)),
  )
  // another family's bump does not excuse this one
  const other = record(
    'branch',
    { [table]: 'b', [page]: 'p', 'scene/proxy.bin': 'x' },
    { worldRoots: '3', proxy: '6' },
  )
  assert.equal(classify(base, other, differences(base, other)).failures.length, 1)
})

// Behaviour: the versions are read from the cache's own files.
test('the versions a cache declares are read from its files', () => {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-versions-'))
  try {
    const key = 'k'.repeat(64),
      head = 'h'.repeat(64)
    mkdirSync(join(root, 'native/full', key), { recursive: true })
    const write = (path: string, value: unknown) =>
      writeFileSync(join(root, 'native/full', path), JSON.stringify(value))
    write('manifest.json', { key })
    write(`${key}/clusters.json`, {
      head: `${head}00`,
      formatVersion: 11,
      compilerVersion: '1.0.0',
    })
    write(`${key}/manifest-page-${head}.json`, {
      worldRoots: { version: 5 },
      geometryPages: { formatVersion: 7 },
    })
    assert.deepEqual(cacheVersions(root), {
      cacheFormat: '11',
      compiler: '1.0.0',
      geometryPages: '7',
      worldRoots: '5',
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
