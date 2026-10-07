import type { Texture } from '../../../sdk-core/src/index.ts'
import type { HostCamera } from '../camera/world.ts'
import type { PresentRect } from '../gpu/core/presentAt.ts'
import type { RasterView } from '../webgpu/pages/runtime.ts'
import type { ResidencyIdentity } from '../webgpu/pages/diagnostic/feedbackAb.ts'
import type { SpatialFeedback } from '../webgpu/pages/diagnostic/spatialCounts.ts'

/** What the bench and the proofs read of the engine beside what a session drives: the last cut,
 *  the view the CPU raster oracles reread, the frame-target measure and the views drawn aside. */
export interface EngineProbes {
  /** Switches the frame target of the same-session measurement (`EngineContext.feedbackTargetAB`);
   *  refused while the pose is not held. */
  setFeedbackTargetAb(target: boolean): Promise<void>
  feedbackAbResidency(): Promise<ResidencyIdentity>
  captureFeedbackAb(): Promise<Uint8Array>
  feedbackAbSpatial(): Promise<SpatialFeedback>
  /** What the CPU raster oracles read of the last image (`../webgpu/pages/io/hostApi.ts`). */
  rasterView(): RasterView
  selectedPageIds(): string[]
  /** The drawn clusters as `mesh/primitive/page`: unique where two clusters share one index
   *  page, whose URL `selectedPageIds` returns for both. */
  selectedClusterIds(): string[]
  /** A texture taken by the atlas after open (`../webgpu/pages/io/appendTexture.ts`); its slot. */
  appendTexture(texture: Texture, kind: 'color' | 'data'): Promise<number>
  /** A view drawn beside the main one, after it, each frame
   *  (`../webgpu/pages/state/persistentView.ts`). */
  addView(
    rect: PresentRect,
  ): Promise<{ render(camera: HostCamera): void; release(): Promise<void> }>
}
