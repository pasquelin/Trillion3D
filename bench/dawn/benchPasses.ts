// Each pass's GPU time per frame on the bench's own timer, every pass of every frame the engine did
// not time itself, by label: its work apart from its wait, and whether its timer can be trusted.
import { PASSES } from '../../packages/sdk-browser/src/stage/passTable.ts'
import type { FrameRecord } from './frames.ts'
import { passKey, spread } from './summary.ts'

/** The stage a bench-timed pass belongs to, by its label: the engine's table, `shadows` for a
 *  virtual shadow map pass, else `unlabelled` — a pass the engine names nowhere. */
export const stageOfLabel = (label: string) =>
  PASSES[label]?.[0] ?? (label.startsWith('vsm.') ? 'shadows' : 'unlabelled')

/** A pass's batches as one (`passKey`), its frames' numbers, by frame of `timed`. */
export function benchPasses(frames: readonly FrameRecord[]) {
  const timed = frames.filter((frame) => frame.drawn && frame.gpu?.complete)
  type Column = {
    work: number[]
    wait: number[]
    span: number[]
    lost: number
    empty: number
    unknown: number
  }
  const by = new Map<string, Column>()
  const kinds = new Map<string, { kind: string; stage: string; label: string }>()
  timed.forEach((frame, at) => {
    for (const pass of frame.gpu!.passes) {
      const name = passKey(pass.label)
      if (!kinds.has(name))
        kinds.set(name, { kind: pass.kind, stage: stageOfLabel(pass.label), label: pass.label })
      let c = by.get(name)
      if (!c) {
        const zeros = () => Array<number>(timed.length).fill(0)
        by.set(
          name,
          (c = { work: zeros(), wait: zeros(), span: zeros(), lost: 0, empty: 0, unknown: 0 }),
        )
      }
      c.work[at] += pass.ms
      c.wait[at] += pass.gapMs
      c.span[at] += pass.spanMs
      if (pass.state === 'lost') c.lost++
      if (pass.state === 'empty') c.empty++
      if (pass.state === 'unknown') c.unknown++
    }
  })
  const frame = spread(timed.map((record) => record.gpu!.unionMs))?.median ?? 0
  return [...by]
    .map(([name, c]) => {
      const time = spread(c.work)!
      return {
        name,
        ...kinds.get(name)!,
        ...time,
        share: frame ? time.median / frame : 0,
        /** The GPU's idle before the pass, per frame: it waits, it does not work. */
        waitMs: spread(c.wait)!.median,
        waitP95: spread(c.wait)!.p95,
        /** The pass's begin-to-end span, its overlaps with earlier passes included. */
        spanMs: spread(c.span)!.median,
        /** Pass runs whose timer the driver lost (work encoded, no timestamp), that encoded no work
         *  (`empty`: a true zero), or only indirect work with no timestamp (`unknown`). */
        lost: c.lost,
        empty: c.empty,
        unknown: c.unknown,
        doubtful: c.lost > 0 || c.unknown > 0,
      }
    })
    .sort((a, b) => b.median - a.median)
}
export type BenchPass = ReturnType<typeof benchPasses>[number]
