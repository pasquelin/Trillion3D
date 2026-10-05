import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';

/** What a transparent pass has to be able to draw without compiling: the blending modes of the
 *  scene's surfaces, the share targets a frame binds, and whether display layers can be on. */
type Reached = { modes: Set<Blending>; shares: Set<boolean>; filtered: boolean };

/**
 * The set of pipeline variants the scene's current materials and settings reach, which only
 * grows. Prepare compiles that set off the frame; a mode, a share or a display filter that appears
 * later (`reach`) starts its own compile at once, off the thread, in every program that listens
 * (`onChange`). A frame that gets there before the compile lands makes the one pipeline it needs
 * itself, as it always did.
 */
export function createReach(first: {
  modes: readonly Blending[];
  share: boolean;
  filtered: boolean;
}) {
  const state: Reached = {
    modes: new Set(first.modes),
    shares: new Set([first.share]),
    filtered: first.filtered,
  };
  const listeners = new Set<() => Promise<unknown>>();
  return {
    state,
    onChange: (listener: () => Promise<unknown>) => void listeners.add(listener),
    /** Widens the set by what a frame or a change of the plan now asks for. */
    reach(next: { modes?: readonly Blending[]; share?: boolean; filtered?: boolean }) {
      const before = state.modes.size + state.shares.size + +state.filtered;
      for (const mode of next.modes ?? []) state.modes.add(mode);
      if (next.share !== undefined) state.shares.add(next.share);
      if (next.filtered) state.filtered = true;
      if (state.modes.size + state.shares.size + +state.filtered === before) return;
      // A compile that fails leaves the frame its own synchronous one.
      for (const listener of listeners) listener().catch(() => undefined);
    },
  };
}

export type Reach = ReturnType<typeof createReach>;
