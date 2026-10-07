import test from 'node:test'
import assert from 'node:assert/strict'
import { WGSL_LIBRARY } from './library.fixture.ts'
import { wgslModule } from './assemble.ts'
import { withoutComments } from './comments.fixture.ts'
import type { WgslDecl } from './decl.ts'
import { wgslConst, wgslFn, wgslStruct } from './decl.ts'

test('each declaration opens with its own name, function or constant', () => {
  for (const decl of WGSL_LIBRARY) {
    const header =
      decl.kind === 'fn'
        ? new RegExp(`^fn ${decl.name}\\((\\w+:[\\w<>]+,?)*\\)(->[\\w<>]+)?\\{`)
        : decl.kind === 'struct'
          ? new RegExp(`^struct ${decl.name}\\{`)
          : new RegExp(`^const ${decl.name}(:\\w+)?=[^;]+;$`)
    assert.match(decl.text, header, decl.name)
    assert.equal(decl.text.endsWith(decl.kind === 'const' ? ';' : '}'), true, decl.name)
  }
})

test('the library holds each name once, and assembles whole', () => {
  const names = WGSL_LIBRARY.map((decl) => decl.name)
  assert.equal(new Set(names).size, names.length)
  // No two texts under one name, no cycle: each declaration written once.
  assert.equal(
    wgslModule(...WGSL_LIBRARY).length,
    WGSL_LIBRARY.reduce((sum, decl) => sum + decl.text.length + 1, -1),
  )
})

/** What a declaration's text names of others: the whole text — signature, return type, constant
 *  initialiser, body — without its comments and its own name. */
const namesIn = (decl: WgslDecl, names: readonly string[]) => {
  const text = withoutComments(decl.text).replace(new RegExp(`\\b${decl.name}\\b`, 'g'), ' ')
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(text))
}

test('a declaration names its dependencies, wherever its text names one', () => {
  const names = WGSL_LIBRARY.map((decl) => decl.name)
  for (const decl of WGSL_LIBRARY)
    assert.deepEqual(
      namesIn(decl, names).sort(),
      decl.deps.map((dep) => dep.name).sort(),
      decl.name,
    )
  // A structure named in a signature only, a constant in an initialiser, are dependencies too.
  const pair = wgslStruct('Pair', [], 'struct Pair{a:f32,b:f32,}')
  const first = wgslFn('first', [], 'fn first(p:Pair)->f32{return p.a;}')
  const doubled = wgslConst('DOUBLED', [], '// SCALE twice\nconst DOUBLED=SCALE*2.0;')
  assert.deepEqual(namesIn(first, ['Pair', 'SCALE', 'first']), ['Pair'])
  assert.deepEqual(namesIn(doubled, ['Pair', 'SCALE', 'DOUBLED']), ['SCALE'])
  assert.deepEqual(namesIn(pair, ['Pair']), [])
  // Comments nest in WGSL: the name after the inner close is still a comment.
  const nested = wgslFn('nested', [], 'fn nested(){/* a /* SCALE */ SCALE */ return;}')
  assert.deepEqual(namesIn(nested, ['SCALE', 'nested']), [])
})
