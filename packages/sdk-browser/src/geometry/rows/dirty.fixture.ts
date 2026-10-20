import type { RowRunVisitor } from './dirty.ts'

/** The runs `walk` visits, as `[first, last]` pairs in order. */
export function runsOf(
  walk: (ctx: number[][], visit: RowRunVisitor<number[][]>) => void,
): [number, number][] {
  const out: number[][] = []
  walk(out, (runs, from, to) => void runs.push([from, to]))
  return out as [number, number][]
}
