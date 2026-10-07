import test from 'node:test'
import assert from 'node:assert/strict'
import type { WgslDecl } from './decl.ts'
import { wgslBlock, wgslConst, wgslFn } from './decl.ts'
import { wgslModule, wgslProgram } from './assemble.ts'

const k = wgslConst('K', [], 'const K=2.0;')
const twice = wgslFn('twice', [k], 'fn twice(x:f32)->f32{return x*K;}')
const four = wgslFn('four', [twice], 'fn four(x:f32)->f32{return twice(twice(x));}')
const both = wgslFn('both', [twice, k], 'fn both(x:f32)->f32{return twice(x)+K;}')

/** The module writing `decls` in this order, each once. */
const written = (...decls: readonly WgslDecl[]) => decls.map((decl) => decl.text).join('\n')

test('each declaration is written once, its dependencies before it', () => {
  assert.equal(wgslModule(four), written(k, twice, four))
  assert.equal(wgslModule(both, four, twice), written(k, twice, both, four))
  assert.equal(wgslModule(four, four), wgslModule(four))
})

test('a program puts the library before its own text, and nothing when it uses none', () => {
  const own = 'fn main()->f32{return four(1.0);}'
  assert.equal(wgslProgram(own, [four]), `${wgslModule(four)}\n${own}`)
  assert.equal(wgslProgram(own, []), own)
})

test('a name declared again with the same text is one declaration', () => {
  const again = wgslFn('twice', [k], twice.text)
  assert.equal(wgslModule(twice, again), written(k, twice))
})

test('a name declared twice with two texts is refused', () => {
  const other = wgslFn('twice', [], 'fn twice(x:f32)->f32{return x+x;}')
  assert.throws(() => wgslModule(four, other), /'twice' declared twice/)
  assert.throws(() => wgslModule(wgslFn('use', [other], 'fn use(){}'), four), /declared twice/)
})

test('a dependency cycle is refused', () => {
  // Frozen declarations cannot point back at themselves; one built by hand can.
  const a: { name: string; kind: 'fn'; deps: WgslDecl[]; text: string } = {
    name: 'a',
    kind: 'fn',
    deps: [],
    text: 'fn a(){b();}',
  }
  const b = wgslFn('b', [a], 'fn b(){a();}')
  a.deps.push(b)
  assert.throws(() => wgslModule(a), /'a' depends on itself/)
  assert.throws(() => wgslModule(b), /'b' depends on itself/)
})

test('declarations are frozen, their dependency list too', () => {
  assert.ok(Object.isFrozen(twice) && Object.isFrozen(twice.deps))
})

test('two fragments using one function hold it once, each fragment once, before its host', () => {
  const left = wgslBlock('LEFT', [four], 'fn left()->f32{return four(1.0);}')
  const right = wgslBlock('RIGHT', [twice, left], 'fn right()->f32{return twice(left());}')
  const own = 'fn main()->f32{return right()+left();}'
  assert.equal(wgslModule(right, left), written(k, twice, four, left, right))
  assert.equal(wgslProgram(own, [right, left]), `${wgslModule(four, left, right)}\n${own}`)
})

test('a fragment is named apart from a function of the same name; two of its texts are refused', () => {
  const block = wgslBlock('twice', [], 'fn other()->f32{return 1.0;}')
  assert.equal(wgslModule(twice, block), written(k, twice, block))
  const variant = wgslBlock('twice', [], 'fn other()->f32{return 2.0;}')
  assert.throws(() => wgslModule(block, variant), /'twice' declared twice/)
})

test('a declaration spliced into a template as text refuses: its host lists it', () => {
  const fragment = wgslBlock('FRAGMENT', [twice], 'fn f()->f32{return twice(1.0);}')
  assert.throws(() => `${fragment}`, /'FRAGMENT' spliced as text/)
  assert.throws(() => 'fn g(){}' + twice, /'twice' spliced as text/)
})

test('a program writes its own directives first, before the declarations it uses', () => {
  const own = 'enable f16;\nenable subgroups;\nfn main()->f32{return twice(1.0);}'
  assert.equal(
    wgslProgram(own, [twice]),
    `enable f16;\nenable subgroups;\n${wgslModule(twice)}\n\nfn main()->f32{return twice(1.0);}`,
  )
})

test('a fragment brings the provider it lists, and two providers of one function are refused', () => {
  // `read` is the host's: the fragment that calls it lists the one its host chose.
  const fromTexture = wgslFn('read', [], 'fn read()->f32{return 1.0;}')
  const fromBuffer = wgslFn('read', [], 'fn read()->f32{return 2.0;}')
  const reduce = (provider: WgslDecl) =>
    wgslBlock('REDUCE', [provider], 'fn reduce()->f32{return read();}')
  assert.equal(wgslModule(reduce(fromBuffer)), written(fromBuffer, reduce(fromBuffer)))
  assert.throws(() => wgslModule(reduce(fromTexture), reduce(fromBuffer)), /'read' declared twice/)
})

test("a directive after the program's leading comments is written first all the same", () => {
  const own = '// The program.\nenable f16;\nfn main()->f32{return twice(1.0);}'
  assert.equal(
    wgslProgram(own, [twice]),
    `enable f16;\n${wgslModule(twice)}\n// The program.\n\nfn main()->f32{return twice(1.0);}`,
  )
})

test("a fragment's directives are written once, first, never a word of a comment or a body", () => {
  const half = wgslBlock(
    'HALF',
    [twice],
    'enable f16;\n// enable nothing: a comment\nfn half()->f16{/* requires */return 1.0h;}',
  )
  const store = wgslBlock(
    'STORE',
    [],
    '/* a /* nested */ comment */\nrequires readonly_and_readwrite_storage_textures;\n' +
      '@diagnostic(off,derivative_uniformity) fn store(){}\nenable  f16;',
  )
  const own = 'enable f16;\nenable subgroups;\nfn main()->f32{return twice(1.0);}'
  const halfText = '\n// enable nothing: a comment\nfn half()->f16{/* requires */return 1.0h;}'
  const storeText =
    '/* a /* nested */ comment */\n\n@diagnostic(off,derivative_uniformity) fn store(){}\n'
  assert.equal(
    wgslProgram(own, [half, store]),
    'enable f16;\nenable subgroups;\nrequires readonly_and_readwrite_storage_textures;\n' +
      `${written(k, twice)}\n${halfText}\n${storeText}\n\nfn main()->f32{return twice(1.0);}`,
  )
  assert.equal(wgslModule(half), `enable f16;\n${written(k, twice)}\n${halfText}`)
})

test('two providers are refused naming the fragment that brought each', () => {
  const left = wgslBlock('LEFT', [twice], 'fn left()->f32{return twice(1.0);}')
  const other = wgslFn('twice', [], 'fn twice(x:f32)->f32{return x+x;}')
  const right = wgslBlock('RIGHT', [other], 'fn right()->f32{return twice(2.0);}')
  assert.throws(
    () => wgslModule(left, right),
    /'twice' declared twice: LEFT > twice and RIGHT > twice \(line/,
  )
})

test('a conflict names the path of each declaration and the first line that differs', () => {
  const other = wgslFn('twice', [], 'fn twice(x:f32)->f32{\n return x+x;}')
  assert.throws(
    () => wgslModule(four, wgslFn('use', [other], 'fn use(){}')),
    /four > twice and use > twice \(line 1: 'fn twice\(x:f32\)->f32\{return x\*K;\}' against 'fn twice\(x:f32\)->f32\{'\)/,
  )
})

test('a program with no declaration still hoists the directives of its own text', () => {
  assert.equal(wgslProgram('fn a(){}\nenable f16;fn b(){}', []), 'enable f16;\nfn a(){}\nfn b(){}')
  assert.equal(wgslProgram('enable f16;fn a(){}', []), 'enable f16;fn a(){}')
})

test('a directive in any kind of declaration is hoisted, once', () => {
  const half = wgslFn('half', [], 'enable f16;fn half(x:f16)->f16{return x;}')
  const again = wgslBlock('again', [half], 'enable  f16;\nfn again(){}')
  assert.equal(wgslModule(again), 'enable f16;\nfn half(x:f16)->f16{return x;}\n\nfn again(){}')
})

test('a declaration opening on a line of its own after the directives gets no second break', () => {
  const half = wgslBlock('HALF', [], 'enable f16;\nfn half()->f16{return 1.0h;}')
  assert.equal(wgslModule(half), 'enable f16;\nfn half()->f16{return 1.0h;}')
})

test('a name reached again through its own dependencies is written once, or refused', () => {
  // `again` and `other` name `twice` and list `four`, which brings the first `twice`.
  const again = wgslFn('twice', [four], twice.text)
  assert.equal(wgslModule(again), written(k, twice, four))
  const other = wgslFn('twice', [four], 'fn twice(x:f32)->f32{return x+x;}')
  assert.throws(() => wgslModule(other), /'twice' declared twice: twice > four > twice and twice/)
})

test('a parameter, a body word or an attribute spelled like a directive is never cut', () => {
  const named = wgslFn('f', [], 'fn f(diagnostic:f32)->f32{return diagnostic;}')
  assert.equal(wgslModule(named), named.text)
  const spaced = '@ diagnostic(off, derivative_uniformity) fn g(){let a=1;}'
  assert.equal(wgslProgram(spaced, [named]), `${named.text}\n${spaced}`)
  const after = wgslFn('h', [], 'fn h(){}\n/* note */ enable f16;')
  assert.equal(wgslModule(after), 'enable f16;\nfn h(){}\n/* note */ ')
})
