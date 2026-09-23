// Validated, resolved campaign settings, split out of `options.ts` to keep it under the file
// line budget.

/** Every field a series or a report reads. */
export interface BenchSettings {
  engine: string;
  frames: number;
  warmup: number;
  pixelErrors: number[];
  maxPages: number | null;
  geometryPoolBytes: number | null;
  texturePoolBytes: number | null;
  geometryPoolCeilingBytes: number | null;
  poolVivant: { geometryPoolBytes?: number | null; texturePoolBytes?: number | null } | null;
  width: number;
  height: number;
  port: number;
  stageProfile: boolean;
  trace: boolean;
  profileFrames: number;
  textureSource: 'cache' | 'host';
  textureUploadMs: number | null;
  temporalAntialiasing: boolean;
  visible: boolean;
  bounce: boolean;
  lights: number;
  lightShadows: boolean;
  lightIntensity: number;
  lightRangeFactor: number;
  movingLight: boolean;
  importedLights: boolean;
  sun: boolean;
  shadowBudgetMs: number | null;
  shadowPages: boolean;
  shadowDigest: boolean;
  movingNode: string | null;
  movingNodeRadius: number;
  movingCamera: boolean;
  instances: number;
  isolation: boolean;
  mathPath: 'auto' | 'js' | 'wasm';
}
