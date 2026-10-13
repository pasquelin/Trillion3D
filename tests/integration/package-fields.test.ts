// What npm and the tools that read no `exports` find in `package.json`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readJson } from '../../scripts/repository-files.ts'

const pkg = readJson('package.json')

test('a tool that reads no exports finds the root, and the gate list is never shipped', () => {
  // TypeScript's `node10` resolution and older bundlers read `main` and `types`: the root's own.
  assert.equal(pkg.main, pkg.exports['.'].default)
  assert.equal(pkg.types, pkg.exports['.'].types)
  // The size gate's list of the bundle's sources stays out of the archive.
  assert.ok(pkg.files.includes('!dist/*.sources.json'))
  // What the registry shows: a description, its words, the site and where to report a defect.
  for (const field of ['description', 'keywords', 'homepage', 'bugs']) assert.ok(pkg[field], field)
})
