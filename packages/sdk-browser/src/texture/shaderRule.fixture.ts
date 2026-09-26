/** A vector as the shaders build one, flattened: an integer word as an unsigned 32-bit integer, a
 *  float as it is. */
export const vec = (...parts: Array<number | Record<string, number>>) => {
  const words = parts.flatMap((part) =>
    typeof part === 'number' ? [Number.isInteger(part) ? part >>> 0 : part] : Object.values(part),
  );
  return Object.fromEntries(words.map((word, i) => ['xyzw'[i], word]));
};

/** The text of the functions `names` in a shipped shader: each from its header to its closing brace. */
function functionsOf(source: string, names: string[]) {
  return names
    .map((name) => {
      const header = new RegExp(`(?:fn |\\b(?:uint|float|uvec2|bool) )${name}\\(`).exec(source);
      if (!header) throw new Error(`no function ${name}`);
      let depth = 0,
        end = source.indexOf('{', header.index);
      do depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
      while (depth && ++end < source.length);
      return source.slice(header.index, end + 1);
    })
    .join('\n');
}

/**
 * The functions `names` of a shipped WGSL or GLSL text as JavaScript: types stripped, integer
 * conversions truncating, shifts unsigned, `binOf(t)` answered by `scope.binOf`. What the shader
 * runs is what the test runs: an edit of the text is what the test sees.
 */
export function shaderFunctions<T>(source: string, names: string[], scope: object = {}): T {
  // A parameter's name: first in WGSL (`a:u32`), last in GLSL (`uint a`).
  const params = (list: string) =>
    list.split(',').map((param) => param.trim().split(/[\s:]+/)[param.includes(':') ? 0 : 1]);
  const header = (_: string, name: string, list: string) => `function ${name}(${params(list)}){`;
  const js = functionsOf(source, names)
    .replace(/fn (\w+)\(([^)]*)\)->\w+\{/g, header)
    .replace(/^(?:uint|float|uvec2|bool) (\w+)\(([^)]*)\)\{/gm, header)
    .replace(/\b(?:let|var|uint|float|uvec2|uvec4|bool) (\w+)=/g, 'let $1=')
    .replace(/\b(?:vec2u|vec4u|uvec2|uvec4)\(/g, 'vec(')
    .replace(/\b(?:u32|uint)\(/g, 'Math.trunc(')
    .replace(/\b(?:f32|float)\(/g, '(')
    .replace(/\b(min|max|round)\(/g, 'Math.$1(')
    .replace(/\b(0x[\da-f]+|\d+)u\b/g, '$1')
    .replace(/>>/g, '>>>');
  const select = (no: unknown, yes: unknown, when: boolean) => (when ? yes : no);
  const all = { vec, select, ...scope };
  return new Function(...Object.keys(all), `${js};return {${names}};`)(...Object.values(all));
}
