import { reachedFunctions } from '../../materials/texture/shaderRule.fixture.ts'

/** The bindings of `group` (the first by default) that the entries `points` of `program` reach through the functions they call, by the variable's name: a
 *  layout holds each one of them (a pipeline asks it for every binding its entry uses), and may leave out the others the program
 *  declares — the layers of the surface cache's library a hit does not read. */
export function reachedBindings(program: string, points: readonly string[], group = 0) {
  const text = reachedFunctions(program, [...points], {})
  const declared = new RegExp(
    `@group\\(${group}\\)\\s*@binding\\((\\d+)\\)\\s*var(?:<[^>]*>)?\\s+(\\w+)`,
    'g',
  )
  const bindings = [...program.matchAll(declared)]
  return new Map(
    bindings
      .filter(([, , name]) => new RegExp(`\\b${name}\\b`).test(text))
      .map(([, binding, name]) => [Number(binding), name]),
  )
}
