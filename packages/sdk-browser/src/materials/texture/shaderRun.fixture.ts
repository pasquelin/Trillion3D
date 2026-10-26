// Runs whole WGSL functions — vectors, swizzles, matrices, loops — in JavaScript, where
// `shaderFunctions` (`shaderRule.fixture.ts`) takes scalar ones. The shipped text is parsed, not
// matched: an edit of the shader is what the test runs.
import { reachedFunctions } from './shaderRule.fixture.ts'
import { builtins } from './shaderRunBuiltins.fixture.ts'
import { structMakers, structZero } from './shaderRunStructs.fixture.ts'
import { Translator } from './shaderRunTranslator.fixture.ts'
import { tokens } from './shaderRunTokens.fixture.ts'
import { type WgslSource, wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

const NAMED =
  /^(const|var<private>|override(?= \w+:\w+=(?:true|false|\d+u?);)) (\w+)(?::[\w<>]+)?=([^;]+);/gm

/** Each program's compiled run, by its text, the functions asked and the scope's names: a test that
 *  runs a program again — a fake device's every dispatch — calls it with its new scope values. */
const compiled = new Map<
  string,
  { run: (...values: unknown[]) => unknown; zero: unknown; makers: object }
>()

/** The functions `names` of a shipped WGSL text, run in JavaScript: vectors as arrays, matrices
 *  as `Mat`, arithmetic by component, scalars broadcast, built-ins by `shaderRunBuiltins.fixture`,
 *  a structure's constructor by its declaration, bindings by `scope`, constants by it or the text
 *  — an override at its literal default, a private variable at its initial value. */
export function shaderRun<T>(input: WgslSource, names: string[], scope: object): T {
  const source = wgslSource(input)
  const key = `${names.join(',')}\n${Object.keys(scope).join(',')}\n${source}`
  let held = compiled.get(key)
  if (!held) {
    const zero = structZero(source),
      makers = structMakers(source)
    const all: Record<string, unknown> = { ...builtins, ...makers, $zero: zero, ...scope }
    const text = reachedFunctions(source, names, all).replace(/bitcast<(\w+)>/g, 'bitcast_$1')
    const js = [...text.matchAll(/(?:@\w+(?:\([^)]*\))?\s*)*fn \w+\(/g)]
      .map((header, i, all) =>
        new Translator(tokens(text.slice(header.index, all[i + 1]?.index))).functionText(),
      )
      .join('\n')
    // A private variable with an initial value is a variable the functions may write, its own. A
    // constant is taken where the functions name it or a constant taken names it, in the text's
    // order (`const TV_L0 = PI`).
    const declared = [...source.matchAll(NAMED)].filter(([, , name]) => !(name in all))
    const named = (name: string, by: string) => new RegExp(`\\b${name}\\b`).test(by)
    const taken = new Set<string>()
    const wanted = (name: string) =>
      named(name, text) || declared.some(([, , other, by]) => taken.has(other) && named(name, by))
    for (let grew = true; grew;) {
      grew = false
      for (const [, , name] of declared)
        if (!taken.has(name) && wanted(name)) {
          taken.add(name)
          grew = true
        }
    }
    const constants = declared
      .filter(([, , name]) => taken.has(name))
      .map(
        ([, kind, name, value]) =>
          `${kind === 'var<private>' ? 'let' : 'const'} ${name}=${new Translator(tokens(value)).expression()};`,
      )
    const body = `${constants.join('')}${js};return {${names}};`
    held = {
      run: new Function(...Object.keys(all), body) as (...values: unknown[]) => unknown,
      zero,
      makers,
    }
    compiled.set(key, held)
  }
  const all: Record<string, unknown> = {
    ...builtins,
    ...held.makers,
    $zero: held.zero,
    ...scope,
  }
  return held.run(...Object.values(all)) as T
}
