/**
 * THE VERTEX STAGE'S EXTRAS: values a program's vertex stage works out for each vertex and hands to
 * the fragment stage interpolated, past what every program carries (`vsOutWgsl`). A feature that
 * has one asks for it by name and width, once, in a table (`allocateExtras`); the table places each
 * ask in a `vec4f` member of the stage's output (`extras0`, `extras1`, ...), in order, no ask
 * split between two members, and the stage writes and the fragment reads it by its name
 * (`extraWrite`, `extraRead`), never by a lane it has to remember. A program that asks for none
 * has no member: its stage's output is the one it was, word for word.
 */

/** What a feature asks for: a name and the lanes (1 to 4) it takes. */
export interface ExtraAsk {
  readonly name: string
  readonly lanes: 1 | 2 | 3 | 4
}

/** Where an ask lies: the member of the stage's output, its first lane (0 to 3) and its width. */
export interface ExtraPlace {
  readonly member: string
  readonly lane: number
  readonly lanes: number
}

/** The places of `asks`, in order, and the members they fill: an ask that does not fit what is
 *  left of a member opens the next. */
export function allocateExtras(asks: readonly ExtraAsk[]) {
  const places: Record<string, ExtraPlace> = {}
  const members: string[] = []
  let lane = 4
  for (const { name, lanes } of asks) {
    if (name in places) throw new Error(`The vertex extra '${name}' is asked for twice`)
    if (lane + lanes > 4) {
      members.push(`extras${members.length}`)
      lane = 0
    }
    places[name] = { member: members[members.length - 1], lane, lanes }
    lane += lanes
  }
  return { places, members }
}

const LETTERS = 'xyzw'

/** The fragment stage's read of the place `at`, of the stage's input `from`: the whole member for
 *  four lanes, else its lanes. */
export const extraRead = (at: ExtraPlace, from = 'in') =>
  `${from}.${at.member}${at.lanes === 4 ? '' : `.${LETTERS.slice(at.lane, at.lane + at.lanes)}`}`

/** The vertex stage's statements that write `value`, a local of the type of the place (`f32` for one
 *  lane, the vector of that many for more), into the place `at` of the stage's output `out`: the
 *  whole member for four lanes, else one statement a lane. */
export const extraWrite = (at: ExtraPlace, value: string, out = 'out') =>
  at.lanes === 4
    ? `${out}.${at.member}=${value};`
    : Array.from({ length: at.lanes }, (_, i) => {
        const lane = LETTERS[at.lane + i]
        return `${out}.${at.member}.${lane}=${value}${at.lanes === 1 ? '' : `.${LETTERS[i]}`};`
      }).join('')
