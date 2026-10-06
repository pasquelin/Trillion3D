// What `shaderRun` (`shaderRun.fixture.ts`) declares a variable with no value as: WGSL's zero of
// its type, a structure's built from the text's own declaration.

/** WGSL's zero of a type declared with no value (`var c:array<vec3f,3>;`): `[]`, `[0,0]`, `0`,
 *  a structure's — a capitalised name — from `$zero`. */
export function zeroOf(type: string[]) {
  if (type[0] === 'array') return '[]'
  if (/^[A-Z]/.test(type[0] ?? '')) return `$zero("${type[0]}")`
  const size = /^vec([234])/.exec(type[0] ?? '')?.[1]
  return size ? `[${Array(Number(size)).fill(0)}]` : '0'
}

/** `$zero` of a WGSL text: each structure it declares by name, its members zero, a vector's
 *  components too, so `h.pos.x=…` writes into one. */
export function structZero(source: string) {
  const members = new Map<string, string[][]>()
  for (const [, name, body] of source.matchAll(/struct (\w+)\s*\{([^}]*)\}/g))
    members.set(name, [...body.replace(/\/\/[^\n]*/g, '').matchAll(/(\w+)\s*:\s*(\w+)/g)])
  const zero = (type: string): unknown => {
    const size = /^vec([234])/.exec(type)?.[1]
    if (size) return new Array<number>(Number(size)).fill(0)
    const own = members.get(type)
    return own ? Object.fromEntries(own.map(([, key, member]) => [key, zero(member)])) : 0
  }
  return zero
}
