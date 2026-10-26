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

/**
 * The set of pipeline variants the scene's current materials and settings reach, which only
 * grows. Prepare compiles that set off the frame; a variant, a responsiveness, a display filter or a
 * holdout that appears later (`reach`) starts its own compile at once, off the thread, in every program
 * that listens (`onChange`), at a frame's entry (`askBlendReach`) with the frames waiting for it. A
 * draw that gets there before the compile lands skips the one pipeline it lacks.
 */
export function createReach(first: {
  variants: readonly number[]
  responsive: boolean
  refracts: boolean
  chromatic: boolean
  filtered: boolean
  holdout?: boolean
}) {
  const state: Reached = {
    variants: new Set(first.variants),
    responsive: first.responsive,
    refracts: first.refracts,
    chromatic: first.chromatic,
    filtered: first.filtered,
    holdout: first.holdout ?? false,
  }
  const changes = createListeners<[]>()
  const size = () =>
    state.variants.size +
    +state.responsive +
    +state.refracts +
    +state.chromatic +
    +state.filtered +
    +state.holdout
  return {
    state,
    onChange: (listener: () => Promise<unknown>) =>
      void changes.subscribe(() => void listener().catch(() => undefined)),
    /** Widens the set by what a frame or a change of the plan now asks for. */
    reach(next: {
      variants?: readonly number[]
      responsive?: boolean
      refracts?: boolean
      chromatic?: boolean
      filtered?: boolean
      holdout?: boolean
    }) {
      const before = size()
      if (next.variants) for (const variant of next.variants) state.variants.add(variant)
      if (next.responsive) state.responsive = true
      if (next.refracts) state.refracts = true
      if (next.chromatic) state.chromatic = true
      if (next.filtered) state.filtered = true
      if (next.holdout) state.holdout = true
      if (size() === before) return
      changes.emit()
    },
  }
}

export type Reach = ReturnType<typeof createReach>
