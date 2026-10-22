import type { EffectKind, EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import {
  settingsWatch,
  type SettingsWatch,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import { KIND_RULES, type ValuesOf } from './kindRules.ts'

type Watch = SettingsWatch<Record<string, never>>

/** The options of a view that holds none: every setting at its default. */
const NONE = Object.freeze({})

/** The kinds the view holds settings for (`KIND_RULES[kind].settings`), read off the table once. */
const WITH_SETTINGS = (Object.keys(KIND_RULES) as EffectKind[]).filter(
  (kind) => KIND_RULES[kind].settings,
)

/** Whether `passes` hold a pass of `kind` that may draw: one not idle of its own, or any of a kind
 *  whose view says whether it is (`KIND_RULES[kind].idle`). */
function draws(passes: readonly EffectPass[], kind: EffectKind) {
  for (let at = 0; at < passes.length; at++)
    if (passes[at].kind === kind && (KIND_RULES[kind].idle || !passes[at].idle)) return true
  return false
}

/** Whether the passes hold one that reads the motion the velocity stage measures
 *  (`KIND_RULES[kind].motion`). */
export function readsMotion(passes: readonly EffectPass[]) {
  for (const pass of passes) if (KIND_RULES[pass.kind].motion) return true
  return false
}

/**
 * THE VIEW'S SETTINGS OF THE EFFECT KINDS, one mechanism: each kind that has some names their rules in
 * its `KIND_RULES` entry, and this holds a watch of them for each (made at the kind's first read):
 * - `of` is the reading of the image — the one a view that rests is told by —, `moved` says whether any
 *   setting of a kind the chain draws moved since the image before, so a view that rests is drawn again;
 * - `peek` reads a kind's settings apart, for whoever else asks the same rules (the passes that draw,
 *   the programs to ask): it consumes no change, and gives the kind's defaults where there is no
 *   session;
 * - `drawn` is the passes that draw (not idle, not turned off by `KIND_RULES[kind].off`).
 * Nothing is read for a kind the chain holds no pass of that draws. One per view, kept in its GPU
 * state; a kind adds a line to the table and the type `KindValues`, and no site of its own.
 */
export function createKindSettings() {
  const watches: Partial<Record<EffectKind, Watch>> = {}
  const watchOf = (kind: EffectKind) =>
    (watches[kind] ??= settingsWatch(KIND_RULES[kind].settings!) as unknown as Watch)
  const peek = <K extends EffectKind>(kind: K, context: object | undefined) =>
    (KIND_RULES[kind].settings
      ? watchOf(kind).peek((context ?? NONE) as never)
      : undefined) as ValuesOf<K>
  return {
    /** The settings the view of `context` holds for `kind`, resolved: one object, overwritten by the
     *  next read — the kind's defaults where there is no `context` —; none for a kind with no rules. */
    of<K extends EffectKind>(kind: K, context: object | undefined): ValuesOf<K> {
      if (!context || !KIND_RULES[kind].settings) return peek(kind, context)
      return watchOf(kind).read(context as never) as ValuesOf<K>
    },
    peek,
    /**
     * Writes into `into` the passes of `passes` that draw — not idle (as the view's settings of their
     * kind leave them, where it says: `KIND_RULES[kind].idle`), and not turned off by them — and
     * returns it: nothing is allocated. The settings of a kind are read when the chain holds a pass of
     * it that is not idle and the kind can be turned off, and for no other.
     */
    drawn(passes: readonly EffectPass[], context: object | undefined, into: EffectPass[]) {
      into.length = 0
      for (const pass of passes) {
        const { idle, off } = KIND_RULES[pass.kind] as {
          idle?: (pass: EffectPass, values: unknown) => boolean
          off?: (values: unknown) => boolean
        }
        if (idle ? idle(pass, peek(pass.kind, context)) : pass.idle) continue
        if (!off?.(peek(pass.kind, context))) into.push(pass)
      }
      return into
    },
    /** Whether the settings of a kind `passes` hold a pass of that draws moved since they were last
     *  read — by the image drawn, or by this: a kind turned off is read here alone, so turning it on
     *  again is seen. */
    moved(passes: readonly EffectPass[], context: object) {
      let moved = false
      for (const kind of WITH_SETTINGS) {
        if (!draws(passes, kind)) continue
        const watch = watchOf(kind)
        watch.read(context as never)
        moved ||= watch.moved
      }
      return moved
    },
  }
}
/** The view's settings of the kinds (`createKindSettings`). */
export type KindSettings = ReturnType<typeof createKindSettings>
