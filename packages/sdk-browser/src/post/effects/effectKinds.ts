import type { EffectKind, EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import { EFFECT_KINDS } from './kindRules.ts'
import { countKinds } from './targets.ts'
import { type Kinds, WEBGPU_KINDS } from './webgpuKinds.ts'

/** What `settled` answers while nothing compiles: shared, no promise is made for it. */
const SETTLED = Promise.resolve<unknown[]>([])

/** The number of each kind among the passes of one stage that draw (`KindSettings.drawn`: an idle
 *  pass counts for no kind, its code is not loaded until the first image it has something to draw)
 *  and the rank the next pass of each kind takes, rewritten by each image: an image allocates none. */
export function createStage() {
  return {
    counts: {} as Record<EffectKind, number>,
    nth: {} as Record<EffectKind, number>,
  }
}
export type Stage = ReturnType<typeof createStage>

/**
 * The kinds' implementations, made as the chain asks and compiled in the background: a kind's
 * programs are loaded at the first pass that needs it (`ready`), and until every kind of a stage's
 * passes is made the image is drawn without them (`loading`). `fail` is called when one cannot be
 * made, and the image stays without the chain.
 */
export function createKinds(device: GPUDevice, fail: (error: unknown) => void) {
  const made: Partial<Kinds> = {},
    pending = new Map<EffectKind, Promise<void>>()
  let failed = false,
    disposed = false
  const load = <K extends EffectKind>(kind: K) => {
    if (failed || pending.has(kind)) return
    const loaded = WEBGPU_KINDS[kind].create(device, fail).then(
      (implementation) => {
        // Arrived after the chain was disposed (a closed session, a lost device): freed, unsaid.
        if (disposed) return implementation.dispose()
        made[kind] = implementation
        pending.delete(kind)
      },
      (error) => {
        if (disposed) return
        failed = true
        pending.delete(kind)
        fail(error)
      },
    )
    pending.set(kind, loaded)
  }
  const anyArriving = () => {
    for (const kind of EFFECT_KINDS) if (made[kind]?.arriving) return true
    return false
  }
  return {
    made,
    /** True while programs compile, a kind's own after it was made included. */
    get loading() {
      return pending.size > 0 || anyArriving()
    },
    /** Resolves once every program in compilation has arrived or failed. */
    settled: () => {
      if (pending.size === 0 && !anyArriving()) return SETTLED
      return Promise.all([...pending.values(), ...EFFECT_KINDS.map((kind) => made[kind]?.arriving)])
    },
    /** Counts the passes of `passes` — the ones of `stage` that draw — by kind and resets their
     *  ranks; whether every kind they need is compiled, the compile of those that are not started. */
    ready(stage: Stage, passes: readonly EffectPass[]) {
      countKinds(passes, stage.counts)
      for (const kind of EFFECT_KINDS) stage.nth[kind] = 0
      let ready = !failed
      for (const kind of EFFECT_KINDS)
        if (stage.counts[kind] && !made[kind]) {
          load(kind)
          ready = false
        }
      return ready
    },
    /** Bytes of what every kind made holds. */
    get bytes() {
      let bytes = 0
      for (const kind of EFFECT_KINDS) bytes += made[kind]?.bytes ?? 0
      return bytes
    },
    dispose() {
      disposed = true
      for (const kind of EFFECT_KINDS) made[kind]?.dispose()
    },
  }
}

/** The kinds' implementations (`createKinds`). */
export type MadeKinds = ReturnType<typeof createKinds>
