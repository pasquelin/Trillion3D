import { createFrameGateCore } from './frameGateCore.ts';

/** What a WebGL image has produced that is observable: see `keep` below. */
const WEBGL_HOLD_VALUES = 6;

export type WebglFrameGate = ReturnType<typeof createWebglFrameGate>;

/**
 * Image gate of the engines rendered by Three: the shared core (`frameGateCore.ts`), and the only
 * thing that belongs to them, the signature of the image they have just produced.
 *
 * A WebGL engine submits nothing itself — the host renders the graph it holds. A held image
 * therefore has nothing to re-emit: the attached scene IS already the image, and doing nothing
 * gives it back to the pixel. What is skipped is the cut, the matrix climb and the lamp update.
 */
export function createWebglFrameGate() {
  const core = createFrameGateCore(WEBGL_HOLD_VALUES);
  // The core is completed, never copied: spreading it would freeze the value of its accessors.
  return Object.assign(core, {
    /**
     * Stores the image that has just been produced. The six numbers describe the CUT, and nothing
     * of the walk that found it: two images that share them have attached exactly the same
     * clusters, in the same order, so they draw the same image.
     *
     * Identity of the cut is the hash of the displayed identifiers, not a walk counter. A frustum
     * reject counts visited nodes: the forcing fallback redescends the tree and used to count
     * them twice, so two images with an identical cut looked different and a still pose never
     * converged.
     */
    keep(
      visible: number,
      selectedTriangles: number,
      shown: ReadonlyArray<{ id: number }>,
      lodLevel: number,
      overBudget: boolean,
    ) {
      let digest = shown.length;
      for (let i = 0; i < shown.length; i++) digest = (Math.imul(digest, 31) + shown[i].id) | 0;
      const sample = core.hold.sample;
      sample[0] = visible;
      sample[1] = selectedTriangles;
      sample[2] = digest;
      sample[3] = lodLevel;
      sample[4] = shown.length;
      sample[5] = overBudget ? 1 : 0;
      core.hold.keep(core.revisions);
    },
  });
}
