// Validated, resolved campaign settings, split out of `harness/options.ts` to keep it under the file
// line budget.

/** Pools set in session after warmup; a texture pool either in bytes or as a fraction of the
 *  texture bytes the settled pose holds resident (`harness/poolFill.ts`). */
export type LivePools = {
  geometryPoolBytes?: number | null
  texturePoolBytes?: number | null
  textureResidentFraction?: number
}

/** Every field a series or a report reads. */
export interface BenchSettings {
  engine: string
  frames: number
  warmup: number
  pixelErrors: number[]
  maxPages: number | null
  geometryPoolBytes: number | null
  texturePoolBytes: number | null
  livePools: LivePools | null
  width: number
  height: number
  dpr: number
  port: number
  stageProfile: boolean
  trace: boolean
  profileFrames: number
  textureSource: 'cache' | 'host'
  textureUploadMs: number | null
  temporalAntialiasing: boolean
  visible: boolean
  bounce: boolean
  lights: number
  lightShadows: boolean
  lightIntensity: number
  lightRangeFactor: number
  movingLight: boolean
  importedLights: boolean
  sun: boolean
  movingNode: string | null
  movingNodeRadius: number
  movingCamera: boolean
  gazeNetwork: boolean
  instances: number
  isolation: boolean
  mathPath: 'auto' | 'js' | 'wasm'
}
