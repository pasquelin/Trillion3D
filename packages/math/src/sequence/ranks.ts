/** Each name of `names` and its rank among them, typed by the names: a table's positions read by
 *  name, built once from the table. */
export const ranksOf = <const N extends readonly string[]>(names: N) =>
  Object.fromEntries(names.map((name, rank) => [name, rank])) as {
    readonly [K in N[number]]: number
  }
