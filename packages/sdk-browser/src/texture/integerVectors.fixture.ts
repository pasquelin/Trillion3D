/** WGSL's integer vector constructor: its arguments flattened, one scalar splat to `size`. */
export const integers =
  (size: number, unsigned: boolean) =>
  (...args: Array<number | number[]>) => {
    const flat = args.flat().map((x) => (unsigned ? Math.trunc(x) >>> 0 : Math.trunc(x)))
    return flat.length === 1 ? new Array<number>(size).fill(flat[0]) : flat
  }
