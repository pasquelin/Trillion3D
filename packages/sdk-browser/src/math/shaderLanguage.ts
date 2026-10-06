export function shaderLanguage(source: string, language: 'wgsl' | 'glsl') {
  if (language === 'wgsl') return source
  return source
    .replace(
      /fn (\w+)\(([^)]*)\)->(\w+)\{/g,
      (_, name, args: string, result) =>
        `${result} ${name}(${args.replace(/(\w+):(\w+)/g, '$2 $1')}){`,
    )
    .replace(/var (\w+):(\w+)/g, '$2 $1')
    .replace(/\bvec([234])f\b/g, 'vec$1')
    .replace(/\bvec([234])i\b/g, 'ivec$1')
    .replace(/\bf32\b/g, 'float')
    .replace(/\bi32\b/g, 'int')
    .replace(/\bu32\b/g, 'uint')
    .replace(/\b(\d+)u\b/g, '$1')
    .replace('any(pixel<ivec2(0))', 'any(lessThan(pixel,ivec2(0)))')
    .replace('any(pixel>=ivec2(size))', 'any(greaterThanEqual(pixel,ivec2(size)))')
    .replace('all(pixel==origin)', 'all(equal(pixel,origin))')
}
