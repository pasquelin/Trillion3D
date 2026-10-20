/** The members of every part of `P`, each with its type. */
type Joined<P extends readonly object[]> = P extends readonly [infer F, ...infer R extends object[]]
  ? F & Joined<R>
  : unknown

/** `a` given the members of every later part, each accessor kept as an accessor: a spread would
 *  read it once and keep the value. */
export function joined<A extends object, P extends object[]>(a: A, ...parts: P) {
  for (const part of parts) Object.defineProperties(a, Object.getOwnPropertyDescriptors(part))
  return a as A & Joined<P>
}
