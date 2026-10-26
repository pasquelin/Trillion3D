import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { REPOSITORY_ROOT, readJson } from '../../scripts/git/repository-files.ts'
import { diagnostics, HOSTS } from './declarations.fixture.ts'

test('package metadata exposes one environment-aware root', () => {
  const packageJson = readJson(resolve(REPOSITORY_ROOT, 'package.json'))
  assert.equal(packageJson.name, 'trillion3d')
  assert.equal(packageJson.version, '1.0.0')
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.bin['trillion3d-compile'], './dist/sdk-node/src/cli/cli.mjs')
  assert.deepEqual(Object.keys(packageJson.exports), ['.', './module', './package.json'])
  const conditions = ['browser', 'node', 'types', 'import', 'default']
  assert.deepEqual(Object.keys(packageJson.exports['.']), conditions)
  assert.equal(packageJson.exports['.'].default, './dist/sdk/index.js')
  // The CDN bundle, one module, beside the unbundled entries a bundler reads.
  const bundle = './dist/trillion3d.module.js'
  assert.deepEqual(packageJson.exports['./module'], {
    types: './dist/sdk/browser.d.ts',
    default: bundle,
  })
  for (const cdn of ['unpkg', 'jsdelivr']) assert.equal(packageJson[cdn], bundle)
  assert.equal(packageJson.sideEffects, false)
  // The host library is no requirement of the package, nor a development tool of the repository.
  for (const field of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
    'devDependencies',
  ]) {
    assert.equal(packageJson[field]?.three, undefined, `${field} names three`)
    assert.equal(packageJson[field]?.['@types/three'], undefined, `${field} names @types/three`)
  }
  assert.ok(packageJson.files.includes('!dist/witnesses'), 'the witness entry stays unpublished')
  const browserPackage = readJson(resolve(REPOSITORY_ROOT, 'packages/sdk-browser/package.json'))
  assert.equal(browserPackage.peerDependencies?.three, undefined)
  assert.equal(browserPackage.dependencies?.three, undefined)
  assert.equal(packageJson.scripts.preinstall, undefined)
})

test('NodeNext, browser Bundler, and the safe default resolve matching declarations', () => {
  assert.deepEqual(diagnostics('tests/fixtures/public/publicNode.mts', HOSTS.node), [])
  assert.deepEqual(diagnostics('tests/fixtures/public/publicBrowser.ts', HOSTS.browser), [])
  assert.deepEqual(diagnostics('tests/fixtures/public/publicCommon.ts', HOSTS.common), [])
})

test('type-only imports leave no runtime package import', () => {
  const source = readFileSync(
    resolve(REPOSITORY_ROOT, 'tests/fixtures/public/publicTypesOnly.ts'),
    'utf8',
  )
  const emitted = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  assert.doesNotMatch(emitted, /trillion3d/)
})

test('the browser condition imports rendering and common bindings without initialization', () => {
  const probe = `
    const sdk = await import('trillion3d');
    if (typeof sdk.createWorld !== 'function') throw new Error('missing createWorld');
    if ('openMeasuredWorld' in sdk) throw new Error('the measurement entry leaked into the package');
    if (typeof sdk.multiplyMatrix4 !== 'function') throw new Error('missing common maths');
    if ('prepare' in sdk) throw new Error('Node API leaked into browser');
  `
  execFileSync(process.execPath, ['--conditions=browser', '--input-type=module', '-e', probe], {
    cwd: REPOSITORY_ROOT,
    stdio: 'pipe',
  })
})
