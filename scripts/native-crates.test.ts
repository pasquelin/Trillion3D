import test from 'node:test'
import assert from 'node:assert/strict'
import { NATIVE_CRATES } from './native-crates.ts'
import { repositoryFiles } from './repository-files.ts'

test('the native crate list names every Cargo.toml of packages/ but the Jolt sources', (t) => {
  const files = repositoryFiles()
  if (!files) return t.skip('not a Git checkout')
  const crates = files
    .filter((file) => /^packages\/.+\/Cargo\.toml$/.test(file))
    .filter((file) => !file.startsWith('packages/physics-jolt-wasm/'))
    .map((file) => file.slice(0, -'/Cargo.toml'.length))
    .sort()
  assert.deepEqual(crates, NATIVE_CRATES.map((crate) => crate.path).sort())
  assert.equal(NATIVE_CRATES.filter((crate) => crate.wasm).length, 1)
})
