/** The read `name(at)` of the double at word `at` of the `u32` array `array`, as a double is held
 *  in words (`doubleWords.ts`) — low word first in memory, the `vec2u(high, low)` of every operation: one text for
 *  every array a kernel binds doubles in (a frame, key records, water items). */
export const doubleReadFn = (name: string, array: string) =>
  `fn ${name}(at:u32)->vec2u{return vec2u(${array}[at+1u],${array}[at]);}`
