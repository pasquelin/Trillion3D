/**
 * What the engine does with the contract lights beyond rereading them: the declared lights, the
 * lighting view and node moves always apply at the next frame; shadows are the engine's to
 * declare. Each field is what the ACTIVE engine applies, never what the contract publishes.
 */
export interface LightingCapabilities {
  /** This engine's lights carry shadows. */
  shadows: boolean
  /** What the engine does not do and why, in one sentence; absent when everything is applied. */
  reason?: string
}
