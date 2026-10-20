/** A deep copy of JSON-shaped data, through its JSON text: `JSON.parse(JSON.stringify(value))`.
 *  `undefined` has no text and throws, as `JSON.parse` does. */
export const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
