// The passes ranked by what they really cost — their work, never their wait — each set against the
// least the machine could do it in: the floor. What a pass encoded and what the machine can do are
// facts; the cause named is the one the numbers prove, and "to dissect" where they cannot say.
import type { BenchPass } from './benchPasses.ts'
import type { Machine } from './machine.ts'
import type { PassSource } from './passSource.ts'

/** The causes a pass's time can have. `unproven`: the numbers rule the others out but do not name
 *  one — `--dissect` cuts the shader to find it. */
export type Cause = 'wait' | 'bandwidth' | 'launch' | 'occupancy' | 'wasted work' | 'unproven'

/** One pass of the ranking. Floors in ms: `floorMs` the least a pass of this encoded work needs
 *  (its attachments stored, its threads launched, its fixed cost); `floorMaxMs` if every byte it
 *  binds were moved. The gain is bounded: `gainMs` at most, `certainMs` at least. */
export type Bottleneck = {
  name: string
  stage: string
  kind: string
  workMs: number
  waitMs: number
  share: number
  encoded: BenchPass['encoded']
  floorMs: number
  floorMaxMs: number
  gainMs: number
  certainMs: number
  cause: Cause
  evidence: string
  source: PassSource | null
}

/** A pass waits when the GPU idles before it for this share of its work, and at least `WAIT_MIN`. */
const WAIT_SHARE = 0.3
const WAIT_MIN_MS = 0.1
/** Under this many workgroups a compute pass cannot fill a GPU. */
const FEW_GROUPS = 64
/** A floor this share of the time makes the pass bound by it. */
const BOUND = 0.7
/** The engine counters that say a pass has nothing to do: a pass of this stage, a counter at zero. */
const IDLE_COUNTERS: Record<string, [key: string, what: string]> = {
  transparents: ['transparentMeshes', 'no transparent mesh'],
}

const inMs = (value: number) => `${value.toFixed(2)} ms`

/** The floor of a pass on `machine`: the larger of its fixed cost, its threads' launch and its
 *  attachments' stores; and the one with every bound byte moved at the slowest read rate. */
export function floorsOf(pass: Pick<BenchPass, 'encoded' | 'kind'>, machine: Machine) {
  const { encoded } = pass
  const launch = encoded.invocations / machine.threadsPerMs
  const stores = encoded.attachBytes / machine.attachmentGBs / 1e6
  const fixed = machine.passMs + encoded.calls * machine.dispatchMs
  const floorMs = Math.max(fixed, launch, stores)
  const moved = encoded.boundBytes / Math.min(machine.readGBs, machine.textureReadGBs) / 1e6
  return { floorMs, floorMaxMs: Math.max(floorMs, moved + stores), launch, stores, moved }
}

/** The cause the numbers prove, and the numbers that prove it. A cause is named only when its floor
 *  alone is most of the pass's time; the others a floor rules out are said, so what is left to
 *  find — the shader's own cost — is told as such. */
function causeOf(
  pass: BenchPass,
  floors: ReturnType<typeof floorsOf>,
  counters: Record<string, unknown>,
): [Cause, string] {
  const work = pass.median
  // A pass that took no time has nothing to gain, and a floor of zero is not most of zero.
  if (work < 0.001) return ['unproven', 'under 1 µs measured: nothing to gain']
  const idle = IDLE_COUNTERS[pass.stage]
  if (idle && counters[idle[0]] === 0 && work > 0.02)
    return ['wasted work', `${inMs(work)} with ${idle[1]} (${idle[0]} = 0)`]
  if (pass.waitMs >= WAIT_MIN_MS && pass.waitMs >= WAIT_SHARE * work)
    return ['wait', `the GPU idles ${inMs(pass.waitMs)} before it, ${inMs(work)} of work`]
  if (floors.stores >= BOUND * work)
    return [
      'bandwidth',
      `its attachments' ${(pass.encoded.attachBytes / (1 << 20)).toFixed(0)} MiB take ${inMs(floors.stores)} to store, ${inMs(work)} measured`,
    ]
  if (floors.launch >= BOUND * work)
    return [
      'launch',
      `${pass.encoded.invocations.toExponential(2)} threads take ${inMs(floors.launch)} to launch, ${inMs(work)} measured`,
    ]
  if (pass.kind === 'compute' && pass.encoded.groups > 0 && pass.encoded.groups < FEW_GROUPS)
    return [
      'occupancy',
      `${pass.encoded.groups} workgroups cannot fill the GPU, ${inMs(work)} measured`,
    ]
  const ruled = [
    floors.launch < 0.5 * work ? 'launch' : '',
    floors.stores < 0.5 * work ? 'stores' : '',
    floors.moved < 0.5 * work ? 'bandwidth' : '',
  ].filter(Boolean)
  const possible =
    floors.moved >= 0.5 * work
      ? ' bandwidth is possible (bound bytes alone would take ' + inMs(floors.moved) + ').'
      : ''
  return [
    'unproven',
    `floor ${inMs(floors.floorMs)} to ${inMs(floors.floorMaxMs)} against ${inMs(work)}; ruled out: ${ruled.join(', ') || 'none'}.${possible} Dissect the shader.`,
  ]
}

/** The ranking: every pass by its work, largest first, with its floor, its gain and its cause. */
export function rankBottlenecks(
  passes: readonly BenchPass[],
  machine: Machine,
  counters: Record<string, unknown>,
  sources: ReadonlyMap<string, PassSource>,
): Bottleneck[] {
  return passes
    .map((pass) => {
      const floors = floorsOf(pass, machine)
      const [cause, evidence] = causeOf(pass, floors, counters)
      return {
        name: pass.name,
        stage: pass.stage,
        kind: pass.kind,
        workMs: pass.median,
        waitMs: pass.waitMs,
        share: pass.share,
        encoded: pass.encoded,
        floorMs: floors.floorMs,
        floorMaxMs: floors.floorMaxMs,
        gainMs: Math.max(0, pass.median - floors.floorMs),
        certainMs: Math.max(0, pass.median - floors.floorMaxMs),
        cause,
        evidence,
        source: sources.get(pass.name) ?? null,
      }
    })
    .sort((a, b) => b.workMs - a.workMs)
}

/** What a pass could give back, at most: its gain, or, for a wait, the idle it costs — the ms one
 *  removes by feeding the GPU, not by speeding the pass. */
export const gainOf = (b: Bottleneck) => (b.cause === 'wait' ? b.waitMs : b.gainMs)

/** The `count` biggest gains the ranking holds. */
export function topGains(ranking: readonly Bottleneck[], count = 5) {
  return [...ranking].sort((a, b) => gainOf(b) - gainOf(a)).slice(0, count)
}
