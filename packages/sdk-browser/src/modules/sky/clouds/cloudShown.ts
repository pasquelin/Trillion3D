import { composedImage } from './compose.ts'
import type { CloudViewFrame } from './viewGroups.ts'
import type { CloudImages, CloudShown } from './viewTargets.ts'

/** What the translucent surfaces read of this image (`CloudShown`): `colour` over the depth image of
 *  `shown`, scaled from the view's screen coordinates to the part of the texture the image fills. */
export function cloudShownOf(
  f: Pick<CloudViewFrame, 'plan' | 'image' | 'part'>,
  shown: Pick<CloudImages, 'views'>,
  colour: GPUTextureView,
): CloudShown {
  const { texture, view } = composedImage(f.plan)
  return {
    colour,
    depth: shown.views.depth,
    uvScale: [view.width / texture.width, view.height / texture.height],
    uvMax: [(view.width - 0.51) / texture.width, (view.height - 0.51) / texture.height],
    preExposure: f.image.preExposure ?? 1,
    softBlendingKm: Math.max(1e-4, f.part.quality.cloudSoftBlendingDistanceOnTranslucent),
    frame: f.image.frameIndex,
  }
}
