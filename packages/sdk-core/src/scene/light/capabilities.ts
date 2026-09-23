/**
 * What an engine can actually do with the contract lights. A call accepted by the store is
 * not proof of lighting: an engine that does not reread the store leaves the image as-is, and
 * the host must be able to know that before believing its image. Each field is what the ACTIVE
 * engine applies, never what the contract publishes.
 */
export interface LightingCapabilities {
  /** Declared lights actually light this engine's image. */
  sceneLights: boolean;
  /** `setLightingView` actually changes this engine's image. */
  lightingView: boolean;
  /** This engine's lights carry shadows. */
  shadows: boolean;
  /** `setTransform` actually moves a named node on this engine. */
  transforms: boolean;
  /** What the engine does not do and why, in one sentence; absent when everything is applied. */
  reason?: string;
}
