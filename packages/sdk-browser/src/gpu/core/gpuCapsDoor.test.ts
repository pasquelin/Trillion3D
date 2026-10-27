// The record of what a device can do (`gpuCaps.ts`) is the one door to a device's features: no other module asks
// `device.features.has(...)` or writes a feature's name. The sites that still do are listed, each to leave this list when its reader
// is moved onto the record; a new site is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCK_FEATURES, FEATURE } from './gpuCaps.ts'

const SOURCE = fileURLToPath(new URL('../../', import.meta.url))

/** The modules that may ask a device's features: the record, and the session's request of them. */
const DOORS = new Set(['gpu/core/gpuCaps.ts', 'session/gpuDevice.ts'])

/** The readers not yet moved onto the record (`gpuCapsOf`): the temporal pass's wave operations and analysis, and the surface cache's
 *  block compression. */
const PENDING = new Set([
  'post/taa/waveOps.ts',
  'post/taa/analysisPipelines.ts',
  'lighting/surfaceCache/compress.ts',
])

/** The label a timing sample names its method by is no feature read. */
const LABELS = new Set(['timestamp-query'])

const isTest = (path: string) => /\.(test|fixture)\.ts$/.test(path)

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.ts') && !isTest(entry.name) ? [path] : []
  })
}

test('no module but the record and the session’s request asks a device’s features', () => {
  const names = [...Object.values(FEATURE), ...Object.values(BLOCK_FEATURES)]
    .filter((name) => name !== 'subgroups' && !LABELS.has(name))
    .map(String)
  const quoted = new RegExp(`['"](?:${names.join('|')})['"]`)
  const asks = /\bfeatures\??\.has\(/
  const found: string[] = []
  for (const path of sources(SOURCE)) {
    const name = relative(SOURCE, path).split('\\').join('/')
    if (DOORS.has(name) || PENDING.has(name)) continue
    const text = readFileSync(path, 'utf8')
    if (asks.test(text) || quoted.test(text)) found.push(name)
  }
  assert.deepEqual(
    found,
    [],
    'move the reader onto `gpuCapsOf`, or name the feature through `FEATURE`',
  )
})

test('the sites still pending ask a device’s features, and leave the list when they stop', () => {
  const asks = /\bfeatures\??\.has\(|BLOCK_FEATURES/
  for (const name of PENDING)
    assert.ok(
      asks.test(readFileSync(join(SOURCE, name), 'utf8')),
      `${name} is moved: take it off the list`,
    )
})
