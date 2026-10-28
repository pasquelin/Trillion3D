import { createListeners } from '../../../sdk-core/src/runtime/listeners.ts'

/** What a transparent pass has to be able to draw without compiling: the blend variants — a blending
 *  mode in a lighting program, `variantOf` — of the scene's surfaces, whether the responsiveness pass is drawn, whether a surface refracts, whether
 *  display layers can be on and whether the holdout is accumulated. */
type Reached = {
  variants: Set<number>
  responsive: boolean
  refracts: boolean
  chromatic: boolean
  filtered: boolean
  holdout: boolean
}

/** What a set of items and settings reaches: the first scope of a program, or the one a layer about to join widens it by (`BlendModePipelines.prepare`). */
export type ReachedBy = {
  variants: readonly number[]
  responsive: boolean
  refracts: boolean
  chromatic: boolean
  filtered: boolean
  holdout?: boolean
}

/**
 * The set of pipeline variants the scene's current materials and settings reach, which only
 * grows. Prepare compiles that set off the frame; a variant, a responsiveness, a display filter or a
 * holdout that appears later (`reach`) starts its own compile at once, off the thread, in every program
 * that listens (`onChange`), at a frame's entry (`askBlendReach`) with the frames waiting for it. A
 * draw that gets there before the compile lands skips the one pipeline it lacks.
 */
export function createReach(first: ReachedBy) {
  const state: Reached = {
    variants: new Set(first.variants),
    responsive: first.responsive,
    refracts: first.refracts,
    chromatic: first.chromatic,
    filtered: first.filtered,
    holdout: first.holdout ?? false,
  }
  const changes = createListeners<[]>()
  /** The size of the set the programs were last told of. */
  let told = 0
  const size = () =>
    state.variants.size +
    +state.responsive +
    +state.refracts +
    +state.chromatic +
    +state.filtered +
    +state.holdout
  told = size()
  return {
    state,
    onChange: (listener: () => Promise<unknown>) =>
      void changes.subscribe(() => void listener().catch(() => undefined)),
    /** Widens the set by what a frame or a change of the plan now asks for. `quiet`: the programs are not told (`announce` tells them), for a widening whose compile the caller awaits itself. */
    reach(
      next: {
        variants?: readonly number[]
        responsive?: boolean
        refracts?: boolean
        chromatic?: boolean
        filtered?: boolean
        holdout?: boolean
      },
      quiet = false,
    ) {
      const before = size()
      if (next.variants) for (const variant of next.variants) state.variants.add(variant)
      if (next.responsive) state.responsive = true
      if (next.refracts) state.refracts = true
      if (next.chromatic) state.chromatic = true
      if (next.filtered) state.filtered = true
      if (next.holdout) state.holdout = true
      if (quiet || size() === before) return
      told = size()
      changes.emit()
    },
    /** Tells the programs of a quiet widening once its compile landed: the other programs of the set compile what it reached. */
    announce() {
      if (size() === told) return
      told = size()
      changes.emit()
    },
  }
}

export type Reach = ReturnType<typeof createReach>
