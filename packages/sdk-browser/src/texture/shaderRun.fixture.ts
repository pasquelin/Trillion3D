// Runs whole WGSL functions — vectors, swizzles, matrices, loops — in JavaScript, where
// `shaderFunctions` (`shaderRule.fixture.ts`) takes scalar ones. The shipped text is parsed, not
// matched: an edit of the shader is what the test runs.
import { reachedFunctions } from './shaderRule.fixture.ts'
import { builtins } from './shaderRunBuiltins.fixture.ts'
import { structZero } from './shaderRunStructs.fixture.ts'
import { Translator, tokens } from './shaderRunTranslator.fixture.ts'
import { type WgslSource, wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

const NAMED = /^(?:const|override(?= \w+:\w+=(?:true|false|\d+u?);)) (\w+)(?::[\w<>]+)?=([^;]+);/gm

/** Each program's compiled run, by its text, the functions asked and the scope's names: a test that
 *  runs a program again — a fake device's every dispatch — calls it with its new scope values. */
const compiled = new Map<string, { run: (...values: unknown[]) => unknown; zero: unknown }>()

/** The functions `names` of a shipped WGSL text, run in JavaScript: vectors as arrays, matrices
 *  as `Mat`, arithmetic by component, scalars broadcast, built-ins by `shaderRunBuiltins.fixture`,
 *  bindings by `scope`, constants by it or the text — an override at its literal default. */
export function shaderRun<T>(input: WgslSource, names: string[], scope: object): T {
  const source = wgslSource(input)
  const key = `${names.join(',')}\n${Object.keys(scope).join(',')}\n${source}`
  let held = compiled.get(key)
  if (!held) {
    const zero = structZero(source)
    const all: Record<string, unknown> = { ...builtins, $zero: zero, ...scope }
    const text = reachedFunctions(source, names, all).replace(/bitcast<(\w+)>/g, 'bitcast_$1')
    const js = [...text.matchAll(/(?:@\w+(?:\([^)]*\))?\s*)*fn \w+\(/g)]
      .map((header, i, all) =>
        new Translator(tokens(text.slice(header.index, all[i + 1]?.index))).functionText(),
      )
      .join('\n')
    const constants = [...source.matchAll(NAMED)]
      .filter(([, name]) => !(name in all) && new RegExp(`\\b${name}\\b`).test(text))
      .map(([, name, value]) => `const ${name}=${new Translator(tokens(value)).expression()};`)
    const body = `${constants.join('')}${js};return {${names}};`
    held = {
      run: new Function(...Object.keys(all), body) as (...values: unknown[]) => unknown,
      zero,
    }
    compiled.set(key, held)
  }
  const all: Record<string, unknown> = { ...builtins, $zero: held.zero, ...scope }
  return held.run(...Object.values(all)) as T
}
