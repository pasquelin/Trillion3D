import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathDependencies, productionSources } from './buildInputs.mts'

const packages = resolve(import.meta.dirname, '../../..')

// Behaviour: the crates the compiler links are read from the manifests, each once, the maths
// reached through the page codec as well as directly.
test('the compiler links the page codec and the maths', () => {
  assert.deepEqual(pathDependencies(join(packages, 'asset-compiler-rust')), [
    '../math/rust',
    '../page-codec-wasm',
  ])
})

// Behaviour: the golden harness and the tests are no production source; the primitives are.
test("the maths crate's production sources leave its test code out", () => {
  const crate = join(packages, 'math/rust')
  const sources = productionSources(crate).map((file) => file.slice(crate.length + 1))
  assert.ok(sources.includes(join('src', 'lib.rs')))
  for (const test of ['golden.rs', 'golden/value.rs', 'golden_tests.rs', 'js_tests.rs'])
    assert.ok(!sources.includes(join('src', test)), test)
})
