// The installed package is loaded dynamically inside the browser page, from a bundle this proof
// does not control the types of: `LooseSdk`/`LooseExplorer` describe only the members
// `evaluateInstalledPage` calls, deliberately looser than the package's own declarations.

export interface LooseExplorer {
  profiler: { lastMetrics?: (Record<string, number> & { coverageReady?: boolean }) | null };
  pointsOfInterest(): { pose: unknown }[];
  setPose(pose: unknown): void;
  setPixelError(value: number): void;
  invalidate(): void;
  awaitPages(): Promise<void>;
  render(): void;
  flush(): Promise<void>;
  capture(): Uint8ClampedArray<ArrayBuffer>;
  canvas: { width: number; height: number };
  capabilities: unknown;
  dispose(): void;
}

export interface LooseSdk {
  MATRIX_VALUES: number;
  POSITION_VALUES: number;
  QUATERNION_VALUES: number;
  HIERARCHY_ROOT: number;
  hierarchyUpdateBatch(
    world: Float64Array[],
    positions: Float64Array[],
    rotations: Float64Array[],
    scales: Float64Array[],
    parents: Uint32Array,
    count: number,
    local: Float64Array,
  ): void;
  createExplorer(target: string, options: Record<string, unknown>): Promise<LooseExplorer>;
  decodeManifestBinary(slim: unknown, buffer: ArrayBuffer): LooseMetadata;
}

export interface LooseMetadata {
  primitives: { pages: { geometry?: { url: string } }[] }[];
  binary?: { url: string };
}

declare global {
  var __installedSdk: LooseSdk | undefined;
}

export interface EvaluatedInstalledPage {
  metrics: Record<string, number>;
  capture: {
    sha256: string;
    repeatedSha256: string;
    aaDifferentPixels: number;
    byteLength: number;
    width: number;
    height: number;
    dpr: number;
    pixelError: number;
    camera: unknown;
    capabilities: unknown;
    differentPixelsFromDirect?: number;
  };
  geometryUrl: string;
  hierarchy: { world: number[]; parent: number };
  commonWorker: unknown;
}
