// What `shaderRun` (`shaderRun.fixture.ts`) declares a variable with no value as: WGSL's zero of
// its type, a structure's built from the text's own declaration; and what a structure's
// constructor (`S(a,b)`) builds, by the same declaration.
import { $cp } from './shaderRunBuiltins.fixture.ts'
import { Mat, Mat3 } from './shaderRunMatrix.fixture.ts'

/** WGSL's zero of a type declared with no value (`var c:array<vec3f,3>;`): `[]`, `[0,0]`,
 *  `false`, `0`, a matrix of zeros, a structure's — a capitalised name — from `$zero`. */
export function zeroOf(type: string[]) {
  if (type[0] === 'array') return '[]'
  if (type[0] === 'bool') return 'false'
  if (type[0] === 'mat4x4f') return `mat4x4f(${Array(16).fill(0)})`
  if (type[0] === 'mat3x3f') return 'mat3x3f([0,0,0],[0,0,0],[0,0,0])'
  if (/^[A-Z]/.test(type[0] ?? '')) return `$zero("${type[0]}")`
  const size = /^vec([234])/.exec(type[0] ?? '')?.[1]
  return size ? `[${Array(Number(size)).fill(0)}]` : '0'
}

/** Each structure a WGSL text declares, by name: its members' names and types, in order. */
function structMembers(source: string) {
  const members = new Map<string, string[][]>()
  for (const [, name, body] of source.matchAll(/struct (\w+)\s*\{([^}]*)\}/g))
    members.set(name, [...body.replace(/\/\/[^\n]*/g, '').matchAll(/(\w+)\s*:\s*(\w+)/g)])
  return members
}

/** `$zero` of a WGSL text: each structure it declares by name, its members zero — a `bool`'s
 *  `false`, an array's `[]` —, a vector's components too, so `h.pos.x=…` writes into one. */
export function structZero(source: string) {
  const members = structMembers(source)
  const zero = (type: string): unknown => {
    const size = /^vec([234])/.exec(type)?.[1]
    if (size) return new Array<number>(Number(size)).fill(0)
    if (type === 'bool') return false
    if (type === 'array') return []
    if (type === 'mat4x4f') return new Mat(new Array<number>(16).fill(0))
    if (type === 'mat3x3f') return new Mat3([0, 1, 2].map(() => [0, 0, 0]))
    const own = members.get(type)
    return own ? Object.fromEntries(own.map(([, key, member]) => [key, zero(member)])) : 0
  }
  return zero
}

/** Each structure's constructor of a WGSL text, by name: its arguments, copied, as its members in
 *  declaration order. */
export function structMakers(source: string) {
  return Object.fromEntries(
    [...structMembers(source)].map(([name, own]) => [
      name,
      (...values: unknown[]) => Object.fromEntries(own.map(([, key], i) => [key, $cp(values[i])])),
    ]),
  )
}
