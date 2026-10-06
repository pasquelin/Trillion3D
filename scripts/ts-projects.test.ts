import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { repositoryFiles } from './repository-files.ts'
import {
  changedTypeErrors,
  excludes,
  parseProject,
  projectProgram,
  readsDist,
  tsProjects,
  typeErrors,
} from './ts-projects.ts'

const ROOT = resolve(import.meta.dirname, '..')
const refuse = () => assert.fail('no owner reads dist/: nothing to build')
const project = (name: string) => parseProject(resolve(ROOT, name))

// The #1071 case: a browser proof handed `page.evaluate` a `string[]` where its callback takes a
// `[string, string]`; `check:changed` let it through, and CI's `check:tools-types` refused it.
const proof = (names: string) => `import type { Page } from 'playwright';
export async function pair(page: Page, names: ${names}): Promise<string> {
  return page.evaluate(([a, b]: [string, string]) => a + b, names);
}
`

function errorsOf(names: string): string[] {
  const file = resolve(ROOT, 'tests/gpu/renders/pair.gpu.ts')
  const tools = project('tsconfig.tools.json')
  return typeErrors(projectProgram(tools, [file], new Map([[file, proof(names)]])), ROOT)
}

test('the changed-files gate refuses a type error in a changed GPU proof', () => {
  const errors = errorsOf('string[]')
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(
    errors[0]!,
    /^tests\/gpu\/renders\/pair\.gpu\.ts\(3,.*'string\[\]' is not assignable to type '\[string, string\]'/s,
  )
  assert.deepEqual(errorsOf('[string, string]'), [], 'the same proof, typed right, passes')
})

test('a changed TypeScript file no project type-checks is an error, not a skip', () => {
  assert.deepEqual(changedTypeErrors(ROOT, [], [], refuse), [])
  assert.match(
    changedTypeErrors(ROOT, [], ['tests/gpu/renders/pair.gpu.ts'], refuse).join(),
    /pair\.gpu\.ts: no tsconfig project type-checks it/,
  )
  const tools = project('tsconfig.tools.json')
  assert.ok(excludes(tools, resolve(ROOT, 'tests/fixtures/public/publicTypesOnly.ts')))
  assert.ok(excludes(tools, resolve(ROOT, 'tests/fixtures/public/publicNode.mts')))
  assert.ok(!excludes(tools, resolve(ROOT, 'tests/gpu/renders/pair.gpu.ts')))
  const build = project('tsconfig.json')
  assert.ok(!excludes(build, resolve(ROOT, 'site/app/x.test.ts')), 'outside its include')
  const fixture = resolve(ROOT, 'packages/sdk-browser/src/x.fixture.ts')
  assert.ok(!excludes(build, fixture), 'an emitting project excludes from its output only')
})

test('the site and the tools read trillion3d from dist/, so their check builds first', () => {
  assert.ok(readsDist(project('tsconfig.tools.json')))
  assert.ok(readsDist(project('tsconfig.site.json')))
  assert.ok(!readsDist(project('tsconfig.core.json')), 'the SDK sources need no build')
})

test('the projects are the tracked tsconfig files', () => {
  const projects = tsProjects(repositoryFiles(ROOT) ?? [])
  assert.ok(projects.includes('tsconfig.tools.json'), projects.join())
  assert.ok(projects.includes('tsconfig.site.json'), projects.join())
  assert.deepEqual(tsProjects(['a/tsconfig.json', 'tsconfig.core.json', 'x.json']), [
    'a/tsconfig.json',
    'tsconfig.core.json',
  ])
})
