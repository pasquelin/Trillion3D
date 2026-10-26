import { LAYOUT, type PoolList } from './geometryPoolLayout.ts'
import type { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'

type List = Geometry['attributes'][string]
/** Floats, grown to the largest write and kept: a steady frame allocates nothing. */
let scratch = new Float32Array(0)

/** The scratch as the last `fillScratch` left it: read it after the fill, which may regrow it. */
export const scratchFloats = () => scratch

/** Drops the scratch: a largest list is not kept past the open or a growth. */
export const releaseScratch = () => {
  scratch = new Float32Array(0)
}

/** Fills the scratch with vertices `from` to `from + n - 1` of list `name` of `a`: its floats. */
export function fillScratch(a: Geometry['attributes'], name: PoolList, from: number, n: number) {
  const { stride, parts } = LAYOUT[name]
  if (scratch.length < n * stride) scratch = new Float32Array(n * stride)
  let part = 0
  for (const [source, width, missing] of parts) {
    const list: List | undefined = a[source]
    if (list) list.readInto(scratch, part, stride, from, n, width, missing)
    else
      for (let i = 0; i < n; i++)
        scratch.fill(missing, part + i * stride, part + i * stride + width)
    part += width
  }
  return n * stride
}
