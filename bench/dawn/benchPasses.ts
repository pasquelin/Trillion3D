// Each pass's GPU time per frame on the bench's own timer, every pass of every frame the engine did
// not time itself, by label: its work apart from its wait, whether its timer can be trusted, and
// what it encoded (workgroups, invocations, vertices, bytes).
import { PASSES } from '../../packages/sdk-browser/src/stage/passTable.ts'
import type { FrameRecord } from './frames.ts'
import { emptyWork, type PassWork } from './passWorkHooks.ts'
import { passKey, spread } from './summary.ts'

/** The stage a bench-timed pass belongs to, by its label: the engine's table, `shadows` for a
 *  virtual shadow map pass, else `unlabelled` — a pass the engine names nowhere. */
const stageOfLabel = (label: string) =>
  PASSES[label]?.[0] ?? (label.startsWith('vsm.') ? 'shadows' : 'unlabelled')

const WORK_KEYS = Object.keys(emptyWork()) as (keyof PassWork)[]

/** A pass's batches as one (`passKey`), its frames' numbers, by frame of `timed`. */
export function benchPasses(frames: readonly FrameRecord[]) {
  const timed = frames.filter((frame) => frame.drawn && frame.gpu?.complete)
  type Column = {
    time: Record<'work' | 'wait' | 'span', number[]>
    encoded: Record<keyof PassWork, number[]>
    lost: number
    empty: number
    unknown: number
  }
  const by = new Map<string, Column>()
  const kinds = new Map<string, { kind: string; stage: string; label: string }>()
  const zeros = () => Array<number>(timed.length).fill(0)
  timed.forEach((frame, at) => {
    for (const pass of frame.gpu!.passes) {
      const name = passKey(pass.label)
      if (!kinds.has(name))
        kinds.set(name, { kind: pass.kind, stage: stageOfLabel(pass.label), label: pass.label })
      let c = by.get(name)
      if (!c) {
        const encoded = Object.fromEntries(WORK_KEYS.map((key) => [key, zeros()]))
        by.set(
          name,
          (c = {
            time: { work: zeros(), wait: zeros(), span: zeros() },
            encoded: encoded as Column['encoded'],
            lost: 0,
            empty: 0,
            unknown: 0,
          }),
        )
      }
      c.time.work[at] += pass.ms
      c.time.wait[at] += pass.gapMs
      c.time.span[at] += pass.spanMs
      for (const key of WORK_KEYS) c.encoded[key][at] += pass.work?.[key] ?? 0
      if (pass.state === 'lost') c.lost++
      if (pass.state === 'empty') c.empty++
      if (pass.state === 'unknown') c.unknown++
    }
  })
  const frame = spread(timed.map((record) => record.gpu!.unionMs))?.median ?? 0
  return [...by]
    .map(([name, c]) => {
      const time = spread(c.time.work)!
      const wait = spread(c.time.wait)!
      return {
        name,
        ...kinds.get(name)!,
        ...time,
        share: frame ? time.median / frame : 0,
        /** The GPU's idle before the pass, per frame: it waits, it does not work. */
        waitMs: wait.median,
        waitP95: wait.p95,
        /** The pass's begin-to-end span, its overlaps with earlier passes included. */
        spanMs: spread(c.time.span)!.median,
        /** Runs whose timer the driver lost (work encoded, no timestamp); that encoded no work
         *  (`empty`: a true zero); with only indirect work and no timestamp (`unknown`). */
        lost: c.lost,
        empty: c.empty,
        unknown: c.unknown,
        doubtful: c.lost > 0 || c.unknown > 0,
        /** What the pass encodes per frame, the mean — a pass that runs on some frames only is not zero. */
        encoded: Object.fromEntries(
          WORK_KEYS.map((key) => [key, spread(c.encoded[key])?.mean ?? 0]),
        ) as PassWork,
      }
    })
    .sort((a, b) => b.median - a.median)
}
export type BenchPass = ReturnType<typeof benchPasses>[number]
