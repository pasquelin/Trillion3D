/**
 * The module-scope integer constants of a shader, written from the names and values the host holds:
 * one line `const NAME:u32=7u;` (or `:i32=7;`) each, in the object's order. A shader names a
 * TypeScript number by the same name, so the two never read different values.
 */
export function wgslConsts(values: Readonly<Record<string, number>>, type: 'u32' | 'i32' = 'u32') {
  const suffix = type === 'u32' ? 'u' : ''
  return Object.entries(values)
    .map(([name, value]) => {
      if (!Number.isInteger(value)) throw new RangeError(`${name} is not an integer: ${value}`)
      return `const ${name}:${type}=${value}${suffix};`
    })
    .join('\n')
}
