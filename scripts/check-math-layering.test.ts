import test from 'node:test'
import assert from 'node:assert/strict'
import { mathLayeringBreaks } from './check-math-layering.ts'

test('imports that stay inside packages/math/src are green', () => {
  assert.deepEqual(
    mathLayeringBreaks(
      new Map([
        [
          'packages/math/src/vector/unit.ts',
          'import { dot } from "./dot.ts"\nexport const unit = dot\n',
        ],
        ['packages/math/src/batch/batch.ts', 'export * from "../vector/vector.ts"\n'],
        ['packages/math/src/matrix/a.test.ts', 'import test from "node:test"\n'],
        ['packages/math/src/float/t1.ts', 'export type T = import("./x.ts").T\n'],
        ['packages/math/src/float/t2.ts', 'export const lazy = () => import(`./x.ts`)\n'],
        [
          'packages/math/src/float/t3.ts',
          "export const u = new URL('./x.wasm', import.meta.url)\n",
        ],
      ]),
    ),
    [],
  )
})

test('a path that leaves packages/math/src is red, whatever it is: a package, a test kit, a bare module, a dynamic import, a type import', () => {
  assert.deepEqual(
    mathLayeringBreaks(
      new Map([
        [
          'packages/math/src/vector/unit.ts',
          'import { Vector3 } from "../../../sdk-core/src/world/math/vector3.ts"\n',
        ],
        [
          'packages/math/src/vector/a.test.ts',
          'import { near } from "../../../../tests/kit/near.ts"\n',
        ],
        ['packages/math/src/float/b.ts', 'import { readFileSync } from "node:fs"\n'],
        [
          'packages/math/src/float/c.ts',
          'export const lazy = () => import("../../../sdk-browser/src/x.ts")\n',
        ],
        ['packages/math/src/float/d.ts', 'import type { T } from "../../../sdk-core/src/t.ts"\n'],
        [
          'packages/math/src/float/e.ts',
          'export type T = import("../../../sdk-core/src/t.ts").T\n',
        ],
        [
          'packages/math/src/float/f.ts',
          'export const lazy = () => import(`../../../sdk-core/src/t.ts`)\n',
        ],
        [
          'packages/math/src/float/g.ts',
          "export const u = new URL('../../../sdk-core/src/t.wasm', import.meta.url)\n",
        ],
        ['packages/sdk-core/src/outside.ts', 'import "../../math/src/index.ts"\n'],
      ]),
    ),
    [
      'packages/math/src/vector/unit.ts: ../../../sdk-core/src/world/math/vector3.ts',
      'packages/math/src/vector/a.test.ts: ../../../../tests/kit/near.ts',
      'packages/math/src/float/b.ts: node:fs',
      'packages/math/src/float/c.ts: ../../../sdk-browser/src/x.ts',
      'packages/math/src/float/d.ts: ../../../sdk-core/src/t.ts',
      'packages/math/src/float/e.ts: ../../../sdk-core/src/t.ts',
      'packages/math/src/float/f.ts: ../../../sdk-core/src/t.ts',
      'packages/math/src/float/g.ts: ../../../sdk-core/src/t.wasm',
    ],
  )
})

test('a reference the gate cannot resolve counts as a break', () => {
  const cases: [string, string, string][] = [
    [
      'import(`./${name}.ts`)',
      'export const a = (name: string) => import(`./${name}.ts`)\n',
      'unresolvable import()',
    ],
    ['import(variable)', 'export const b = (p: string) => import(p)\n', 'unresolvable import()'],
    [
      'new URL(variable)',
      'export const c = (p: string) => new URL(p, import.meta.url)\n',
      'unresolvable new URL()',
    ],
    [
      'require',
      "import x = require('../../../sdk-core/src/x.ts')\nexport { x }\n",
      '../../../sdk-core/src/x.ts',
    ],
    [
      'import.meta.resolve',
      "export const d = import.meta.resolve('./x.ts')\n",
      'unresolvable import.meta.resolve()',
    ],
  ]
  for (const [, text, reason] of cases)
    assert.deepEqual(mathLayeringBreaks(new Map([['packages/math/src/float/u.ts', text]])), [
      `packages/math/src/float/u.ts: ${reason}`,
    ])
})

test('a triple-slash reference path that leaves packages/math/src is red', () => {
  assert.deepEqual(
    mathLayeringBreaks(
      new Map([
        ['packages/math/src/float/r.ts', '/// <reference path="../../../sdk-core/src/t.d.ts" />\n'],
      ]),
    ),
    ['packages/math/src/float/r.ts: ../../../sdk-core/src/t.d.ts'],
  )
})

test('a relative specifier that climbs above the repository root is red', () => {
  assert.deepEqual(
    mathLayeringBreaks(
      new Map([['packages/math/src/float/k.ts', 'import "../../../../../math/src/float/x.ts"\n']]),
    ),
    ['packages/math/src/float/k.ts: ../../../../../math/src/float/x.ts'],
  )
})

test('a test of the package reads its reference values beside the sources, a module does not', () => {
  const asset = "new URL('../golden/grid.json', import.meta.url)"
  const folder = "new URL('../golden/', import.meta.url)"
  assert.deepEqual(mathLayeringBreaks(new Map([['packages/math/src/a.fixture.ts', asset]])), [])
  assert.deepEqual(mathLayeringBreaks(new Map([['packages/math/src/a.fixture.ts', folder]])), [])
  const bare = "new URL('../golden', import.meta.url)"
  assert.deepEqual(mathLayeringBreaks(new Map([['packages/math/src/a.fixture.ts', bare]])), [])
  assert.equal(mathLayeringBreaks(new Map([['packages/math/src/a.ts', bare]])).length, 1)
  // The module's own folder is inside the unit.
  const here = "new URL('.', import.meta.url)"
  assert.deepEqual(mathLayeringBreaks(new Map([['packages/math/src/float/a.ts', here]])), [])
  // The unit's parent folder is not.
  const up = "new URL('..', import.meta.url)"
  assert.equal(mathLayeringBreaks(new Map([['packages/math/src/a.fixture.ts', up]])).length, 1)
  assert.equal(mathLayeringBreaks(new Map([['packages/math/src/a.ts', asset]])).length, 1)
  for (const other of [
    "new URL('../../sdk-core/src/x.json', import.meta.url)",
    "new URL('../rust/src/lib.rs', import.meta.url)",
    "import '../package.json'",
    "import '../goldens/x.ts'",
  ])
    assert.equal(
      mathLayeringBreaks(new Map([['packages/math/src/a.fixture.ts', other]])).length,
      1,
      other,
    )
})
