// A pass's theoretical floor on this machine: its work in each resource over that resource's
// measured peak (`../peaks/`), the slowest resource binding — a pass can do no better than the
// resource it uses most of its peak — plus its fixed cost as a pass. A lower bound, never a
// prediction: what a pass takes above it is waste, overlap aside. Pure.
import type { Resource } from '../peaks/plan.ts'

/** A pass's work by resource, in the peaks' work units: bytes moved to or from memory, texels
 *  loaded or filtered, floating-point operations, workgroup-memory bytes, pixels written by the
 *  raster (one target, or four), fragments shaded, triangles set up; `passes` its passes, each
 *  costing an empty dispatch's fixed time (a render pass's attachments are its bytes), and
 *  `dispatches` those of its dispatches that wait for the one before (`dependentDispatch`). */
export type Work = Partial<
  Record<
    | 'bytes'
    | 'texels'
    | 'filtered'
    | 'flops'
    | 'shared'
    | 'pixels'
    | 'pixelsMrt4'
    | 'fragments'
    | 'triangles'
    | 'passes'
    | 'dispatches',
    number
  >
>

/** The machine's peaks, as `peaks/run.ts` measured them: a rate per resource in its unit
 *  (GB/s, Gtexel/s, TFLOP/s, Gpixel/s, Gtriangle/s), a pass's fixed cost in ms. */
export type Peaks = Partial<Record<Resource, number>>

/** Each kind of work, the peak it runs at and that peak's unit (work per ms at a rate of one). */
const RESOURCES: [keyof Work, Resource, number][] = [
  ['bytes', 'copy', 1e6],
  ['texels', 'texelLoad', 1e6],
  ['filtered', 'texelFilter', 1e6],
  ['flops', 'alu', 1e9],
  ['shared', 'shared', 1e6],
  ['pixels', 'fill', 1e6],
  ['pixelsMrt4', 'fillMrt4', 1e6],
  ['fragments', 'fragments', 1e6],
  ['triangles', 'triangles', 1e6],
]

/** The floor of `work` on `peaks`, ms, and the resource that binds it (`pass` when only the
 *  passes' fixed cost is left). Memory moves at the copy kernel's rate, reads and writes mixed. */
export function floorOf(work: Work, peaks: Peaks) {
  let ms = 0,
    bound = 'pass'
  for (const [kind, resource, perMs] of RESOURCES) {
    const amount = work[kind] ?? 0,
      rate = peaks[resource]
    if (!amount || !rate) continue
    const t = amount / (rate * perMs)
    if (t > ms) [ms, bound] = [t, kind]
  }
  const fixed =
    (work.passes ?? 0) * (peaks.computePass ?? 0) +
    (work.dispatches ?? 0) * (peaks.dependentDispatch ?? 0)
  return { ms: ms + fixed, bound: ms >= fixed ? bound : 'pass' }
}
