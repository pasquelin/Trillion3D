// The installed package is loaded dynamically inside the browser page, from a bundle this proof
// does not control the types of: `LooseSdk`/`LooseWorld` describe only the members
// `evaluateInstalledPage` calls, deliberately looser than the package's own declarations.

export interface LooseWorld {
  ready: Promise<void>
  scene: { load(url: string): Promise<{ bounds: unknown }> }
  camera: { set(pose: unknown): void }
  pixelError: number
  awaitPages(): Promise<void>
  diagnostic: { error: { message: string; details?: { cause?: unknown } } | null }
  render(): void
  canvas: { width: number; height: number }
  dispose(): void
}

export interface LooseSdk {
  multiplyMatrix4Batch(
    out: Float64Array[],
    a: readonly Float64Array[],
    b: readonly Float64Array[],
    n: number,
  ): void
  createWorld(target: string, options: Record<string, unknown>): LooseWorld
  pose: { fromBounds(box: unknown, options: { aspect: number }): unknown }
  metric: { frame(world: LooseWorld): Record<string, number> | null }
  capture: {
    buffer(
      world: LooseWorld,
      size: { width: number; height: number },
    ): Promise<{ data: Uint8Array<ArrayBuffer> }>
  }
  readPagedManifest(
    root: unknown,
    read: (page: { url: string }) => Promise<Uint8Array>,
  ): Promise<LooseMetadata>
}

interface LooseMetadata {
  primitives: { pages: { geometry?: { url: string } }[] }[]
}

declare global {
  var __installedSdk: LooseSdk | undefined
}

export interface EvaluatedInstalledPage {
  metrics: Record<string, number>
  capture: {
    sha256: string
    repeatedSha256: string
    aaDifferentPixels: number
    byteLength: number
    width: number
    height: number
    dpr: number
    pixelError: number
    camera: unknown
    differentPixelsFromDirect?: number
  }
  product: number[]
  commonWorker: unknown
}
