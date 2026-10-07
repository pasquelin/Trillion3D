/** An unsigned vector as the shaders build one (`vec2u`, `vec4u`…), flattened: each word converted
 *  as the GPU does, truncated and wrapped to an unsigned 32-bit integer. */
export const vec = (...parts: Array<number | Record<string, number>>) => {
  const words = parts.flatMap((part) =>
    typeof part === 'number' ? [part >>> 0] : Object.values(part),
  )
  return Object.fromEntries(words.map((word, i) => ['xyzw'[i], word]))
}

/** The text of the functions `names` in a shipped shader: each from its header to its closing brace. */
export function functionsOf(source: string, names: string[]) {
  return names
    .map((name) => {
      const header = new RegExp(`fn ${name}\\(`).exec(source)
      if (!header) throw new Error(`no function ${name}`)
      let depth = 0,
        end = source.indexOf('{', header.index)
      do depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0
      while (depth && ++end < source.length)
      return source.slice(header.index, end + 1)
    })
    .join('\n')
}

/** Every scalar `const` of a WGSL text whose value is a literal — `f32`, `u32` or `i32` —, by
 *  name: what the shader compiles, not a copy of it. */
export function wgslConstants(source: string) {
  const found: Record<string, number> = {}
  for (const [, name, literal] of source.matchAll(/\bconst (\w+):(?:f32|u32|i32)=([^;]+);/g)) {
    // A hex digit `f` is no suffix: `0xff` is 255, not `0xf`.
    const value = Number(literal.replace(/^0x/i.test(literal) ? /[ui]$/ : /[uif]$/, ''))
    if (Number.isFinite(value)) found[name] = value
  }
  return found
}

/**
 * The functions `names` of a shipped WGSL text as JavaScript: types stripped, integer
 * conversions truncating, shifts unsigned, `binOf(t)` answered by `scope.binOf`. What the shader
 * runs is what the test runs: an edit of the text is what the test sees.
 */
export function shaderFunctions<T>(source: string, names: string[], scope: object = {}): T {
  // A parameter's name, before its type (`a:u32`).
  const params = (list: string) => list.split(',').map((param) => param.trim().split(/[\s:]+/)[0])
  const header = (_: string, name: string, list: string) => `function ${name}(${params(list)}){`
  const js = functionsOf(source, names)
    .replace(/fn (\w+)\(([^)]*)\)->\w+\{/g, header)
    .replace(/\b(?:let|var) (\w+)(?::\w+)?=/g, 'let $1=')
    .replace(/\b(?:vec2u|vec4u)\(/g, 'vec(')
    .replace(/\bu32\(/g, 'Math.trunc(')
    .replace(/\bf32\(/g, '(')
    .replace(/\b(min|max|round)\(/g, 'Math.$1(')
    .replace(/\b(0x[\da-f]+|\d+)u\b/g, '$1')
    .replace(/>>/g, '>>>')
  const select = (no: unknown, yes: unknown, when: boolean) => (when ? yes : no)
  const all = { vec, select, ...scope }
  return new Function(...Object.keys(all), `${js};return {${names}};`)(...Object.values(all))
}
