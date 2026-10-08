// Each inline form of `scripts/lint-maths.ts`, planted in a module and linted through the
// repository's own configuration: refused outside `packages/math`, passed inside it and in the
// declared oracles.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { ESLint } from 'eslint'

const eslint = new ESLint({ cwd: resolve(import.meta.dirname, '..') })

/** The maths findings of `code` linted as the file `path`. */
async function findings(code: string, path: string) {
  const [result] = await eslint.lintText(code, { filePath: path })
  return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax')
}

/** One planted module per form, each a declaration the lint has nothing else to say about. */
const FORMS: Record<string, string> = {
  'ceil of a quotient': 'export const f = (a: number, b: number) => Math.ceil(a / b)\n',
  'clamp, min of max': 'export const f = (x: number) => Math.min(1, Math.max(0, x))\n',
  'clamp, max of min': 'export const f = (x: number, h: number) => Math.max(0, Math.min(h, x))\n',
  'Math.hypot': 'export const f = (x: number, y: number) => Math.hypot(x, y)\n',
  'Math.hypot passed on': 'export const f = (v: number[]) => v.reduce(Math.hypot, 0)\n',
  'matrix copy loop':
    'export function f(o: number[], m: number[]) {\n  for (let i = 0; i < 16; i++) o[i] = m[i]\n}\n',
  'matrix copy loop, braced':
    'export function f(o: number[], m: number[], at: number) {\n  for (let k = 0; k < 16; k++) {\n    o[at + k] = m[k]\n  }\n}\n',
  'π over n': 'export const f = Math.PI / 2\n',
  'negated π over n': 'export const f = -Math.PI / 2\n',
  'π times n': 'export const f = Math.PI * 2\n',
  'n times π': 'export const f = 2 * Math.PI\n',
  'degrees to radians': 'export const f = (x: number) => (x * Math.PI) / 180\n',
  'turns to radians': 'export const f = (x: number) => x * Math.PI * 2\n',
  'turns to radians, π last': 'export const f = (x: number) => x * 2 * Math.PI\n',
  'radians to degrees': 'export const f = (x: number) => (x * 180) / Math.PI\n',
  'power of two above': 'export const f = (v: number) => 2 ** Math.ceil(Math.log2(v))\n',
  'power of two above, by pow':
    'export const f = (v: number) => Math.pow(2, Math.ceil(Math.log2(v)))\n',
}

test('each form is refused outside packages/math, in a package, the site, the bench and a tool', async () => {
  for (const [form, code] of Object.entries(FORMS))
    for (const path of [
      'packages/sdk-core/src/planted.ts',
      'packages/sdk-node/src/planted.mts',
      'site/app/planted.tsx',
      'packages/sdk-core/src/scene/light-shadow/planted.ts',
      'bench/runner/planted.ts',
      'scripts/planted.ts',
      'tests/gpu/planted.ts',
    ])
      assert.equal((await findings(code, path)).length, 1, `${form} in ${path}`)
})

test('the same forms pass inside packages/math and in the declared oracles', async () => {
  for (const [form, code] of Object.entries(FORMS))
    for (const path of [
      'packages/math/src/scalar/planted.ts',
      'bench/oracles/core/planted.ts',
      'bench/witnesses/planted.ts',
      'bench/runner/references/flip.ts',
      'tests/kit/reference/planted.ts',
      'packages/sdk-browser/src/vsm/plantedBefore.fixture.ts',
      'packages/sdk-core/src/planted.test.ts',
      'packages/sdk-browser/src/planted.fixture.ts',
      'tests/gpu/planted.gpu.ts',
    ])
      assert.deepEqual(await findings(code, path), [], `${form} in ${path}`)
})

test('what the maths do not hold passes: π times variables, a negated variable, a three-way bound, a loop of nine', async () => {
  const code = [
    'export const a = (x: number) => Math.sin(Math.PI * x)',
    'export const e = (x: number, y: number) => x * y * Math.PI - -x / 2',
    'export const b = (x: number, y: number, z: number) => Math.max(1, Math.min(x, y, z))',
    'export const c = (a: number, b: number) => Math.floor(a / b)',
    'export function d(o: number[], m: number[]) {\n  for (let i = 0; i < 9; i++) o[i] = m[i]\n}',
    '',
  ].join('\n')
  assert.deepEqual(await findings(code, 'packages/sdk-core/src/planted.ts'), [])
})
