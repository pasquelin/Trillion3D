import { unit } from './vectorTuple.ts'

/** `v` made unit (`unit`), each component then rounded to f32: a direction as a shader reads it. */
export const unitF32 = (v: number[]) =>
  unit(v as [number, number, number]).map(Math.fround) as [number, number, number]
