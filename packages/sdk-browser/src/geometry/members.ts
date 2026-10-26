/** The members of `parts` joined into one object, getters kept live: a spread would read each
 *  getter once and freeze it. A name in two parts belongs to the later. */
export function joinMembers<T extends object[]>(...parts: T): Joined<T> {
  const joined = {}
  for (const part of parts) Object.defineProperties(joined, Object.getOwnPropertyDescriptors(part))
  return joined as Joined<T>
}

type Joined<T extends object[]> = T extends [infer Head, ...infer Rest extends object[]]
  ? Head & Joined<Rest>
  : unknown
