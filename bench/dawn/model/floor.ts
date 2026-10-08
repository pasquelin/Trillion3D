// A pass's theoretical floor on this machine: its work in each resource over that resource's
// measured rate (`../machine.ts`), the slowest resource binding — a pass can do no better than the
// resource it uses most of its rate — plus its fixed cost as a pass. A lower bound, never a
// prediction: what a pass takes above it is waste, overlap aside. Pure.
import type { Machine } from '../machine.ts'

/** A pass's work by resource, in the machine's work units: bytes moved to or from memory, texels
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

/** Each kind of work, its rate on `machine`, work a ms. Memory moves at the faster of the read and
 *  write streams — a lower bound, reads and writes mixed —; a pixel written is 8 bytes stored into
 *  the attachment. */
const RATES: [keyof Work, (machine: Machine) => number][] = [
  ['bytes', (m) => Math.max(m.readGBs, m.writeGBs) * 1e6],
  ['texels', (m) => m.texelLoadG * 1e6],
  ['filtered', (m) => m.texelFilterG * 1e6],
  ['flops', (m) => m.aluTflops * 1e9],
  ['shared', (m) => m.sharedGBs * 1e6],
  ['pixels', (m) => (m.attachmentGBs / 8) * 1e6],
  ['pixelsMrt4', (m) => m.mrt4G * 1e6],
  ['fragments', (m) => m.fragmentsG * 1e6],
  ['triangles', (m) => m.trianglesG * 1e6],
]

/** The floor of `work` on `machine`, ms, and the resource that binds it (`pass` when only the
 *  passes' fixed cost is left): a pass costs `passMs`, a dispatch that waits for the one before a
 *  dispatch and its barrier. */
export function floorOf(work: Work, machine: Partial<Machine>) {
  let ms = 0,
    bound = 'pass'
  for (const [kind, rateOf] of RATES) {
    const amount = work[kind] ?? 0,
      rate = rateOf(machine as Machine)
    if (!amount || !(rate > 0)) continue
    const t = amount / rate
    if (t > ms) [ms, bound] = [t, kind]
  }
  const fixed =
    (work.passes ?? 0) * (machine.passMs ?? 0) +
    (work.dispatches ?? 0) * ((machine.dispatchMs ?? 0) + (machine.barrierMs ?? 0))
  return { ms: ms + fixed, bound: ms >= fixed ? bound : 'pass' }
}
