import test from 'node:test'
import assert from 'node:assert/strict'
import { libraryRedeclarations } from './check-wgsl-library.ts'

/** A shader module declaring a function, a constant and a structure of the library again. */
const SHADER = [
  'const SHADER = `',
  'fn edgeFunction(a:vec2f,b:vec2f,p:vec2f)->f32{return 0.0;}',
  'const FLOAT32_MAX:f32=3.4e38;',
  'struct Frame3{x:vec3f}',
  '@compute @workgroup_size(64) fn main(){}`',
  '',
].join('\n')

test('a shader writing a library declaration again is refused, wherever it lives', () => {
  for (const path of [
    'packages/sdk-browser/src/planted.ts',
    'packages/sdk-core/src/planted.ts',
    'tests/gpu/planted.ts',
    'bench/runner/planted.ts',
    'site/demos/planted.ts',
  ])
    assert.deepEqual(libraryRedeclarations(new Map([[path, SHADER]])), [
      `${path}: fn edgeFunction`,
      `${path}: const FLOAT32_MAX`,
      `${path}: struct Frame3`,
    ])
})

test('a declaration in a quoted string or a template with substitutions is read too', () => {
  const quoted = "const S = 'fn edgeFunction(a:vec2f)->f32{return 0.0;}'\n"
  const spliced =
    'const n = 2\nconst S = `const K=${n};\nfn edgeFunction(a:vec2f)->f32{return 0.0;}`\n'
  for (const code of [quoted, spliced])
    assert.deepEqual(libraryRedeclarations(new Map([['packages/sdk-browser/src/a.ts', code]])), [
      'packages/sdk-browser/src/a.ts: fn edgeFunction',
    ])
})

test('the library itself, the oracles and TypeScript names pass', () => {
  const files = new Map([
    ['packages/math/src/wgsl/planted.ts', SHADER],
    ['bench/oracles/browser/planted.ts', SHADER],
    ['packages/sdk-browser/src/plantedBefore.fixture.ts', SHADER],
    ['packages/sdk-browser/src/planted.test.ts', SHADER],
    // A TypeScript constant of a library name is no shader: outside the strings, never read.
    [
      'packages/sdk-core/src/planted.ts',
      'const FLOAT32_MAX = 3.4e38\nfunction edgeFunction() {}\n',
    ],
  ])
  assert.deepEqual(libraryRedeclarations(files), [])
})
