import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheFingerprint, differences } from './compiler-hashes.ts'

/** A cache as the compiler lays it out, under `key`, with one page of `page` bytes and a manifest
 *  that reports the run's time, whether it found a cutout sheet, the threads
 *  it ran on and names the folder it was written to. */
function cache(
  key: string,
  page: string,
  compileMs: number,
  found?: boolean,
  threads?: number,
): string {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-hashes-'))
  const manifest = {
    key,
    url: `${key}/c`,
    sheet: join(root, 'cutouts.json'),
    metrics: { compileMs, threads },
    cutouts: { changes: { decisions: { file: join(root, 'cutouts.json'), found, answers: 0 } } },
  }
  mkdirSync(join(root, 'native/full', key), { recursive: true })
  writeFileSync(join(root, 'native/.lock'), String(process.pid))
  writeFileSync(join(root, 'native/full/manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'native/full', key, 'page.bin'), page)
  return root
}

// Behaviour: two compilers that cook the same bytes have one fingerprint, whatever their key, their
// run's times, the cutout sheet an older head says it found, the threads it ran on
// and their folder; one changed byte is named — the platforms against Linux x64, the branch
// against develop.
test('the fingerprint compares the cooked bytes and names the file that differs', () => {
  const develop = cache('a'.repeat(64), 'page', 1, false, 4),
    branch = cache('b'.repeat(64), 'page', 2),
    changed = cache('c'.repeat(64), 'pagf', 1)
  try {
    const record = (compiler: string, root: string) => ({
      compiler,
      files: cacheFingerprint(root, 'scene'),
    })
    const reference = record('develop', develop)
    assert.deepEqual(Object.keys(reference.files), [
      'scene/native/full/<sha>/page.bin',
      'scene/native/full/manifest.json',
    ])
    assert.deepEqual(differences(reference, record('branch', branch)), [])
    assert.deepEqual(differences(reference, record('changed', changed)), [
      'scene/native/full/<sha>/page.bin',
    ])
  } finally {
    for (const root of [develop, branch, changed]) rmSync(root, { recursive: true, force: true })
  }
})

/** A cache whose `physics.json` names one collider object of `shape` bytes, beside a page. */
function physicsCache(shape: string): string {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-hashes-'))
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')
  mkdirSync(join(root, 'native/objects'), { recursive: true })
  writeFileSync(join(root, 'native/objects', `${sha(shape)}.bin`), shape)
  writeFileSync(join(root, 'native/objects', `${sha('page')}.bin`), 'page')
  const physics = { colliders: [{ tiles: [{ url: `../../objects/${sha(shape)}.bin` }] }] }
  writeFileSync(join(root, 'native/physics.json'), JSON.stringify(physics))
  return root
}

// Behaviour: the Jolt colliders `physics.json` names are listed apart, and a base whose Jolt cook
// still fuses is allowed to differ on them alone; every other file is still compared.
test('the colliders may differ from a fusing base, and nothing else', () => {
  const develop = physicsCache('fused'),
    branch = physicsCache('unfused')
  try {
    const base = { compiler: 'develop', files: cacheFingerprint(develop, 'scene') }
    const head = { compiler: 'branch', files: cacheFingerprint(branch, 'scene') }
    const collider = 'scene/native/objects/<sha>.bin (Jolt collider)'
    assert.deepEqual(Object.keys(head.files).sort(), [
      'scene/native/objects/<sha>.bin',
      collider,
      'scene/native/physics.json',
    ])
    assert.deepEqual(differences(base, head), [collider])
    assert.deepEqual(differences(base, head, true), [])
    const page = { ...head, files: { ...head.files, 'scene/native/objects/<sha>.bin': 'other' } }
    assert.deepEqual(differences(base, page, true), ['scene/native/objects/<sha>.bin'])
  } finally {
    for (const root of [develop, branch]) rmSync(root, { recursive: true, force: true })
  }
})
