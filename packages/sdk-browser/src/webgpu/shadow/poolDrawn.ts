/** Whose draw a page holds for its entry (`poolWgsl.ts`): the host's (`pool.drew`), none yet —
 *  mapped by the GPU —, or the GPU's own (`freshWgsl.ts`), which the host has not seen. */
export const DRAWN_HOST = 0,
  DRAWN_NONE = 1,
  DRAWN_GPU = 2;
