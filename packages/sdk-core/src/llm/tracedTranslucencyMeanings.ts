import type { TracedTranslucencyField } from '../contracts/tracedTranslucencyOptions.ts'

/** What each setting of the traced translucency means (`../contracts/tracedTranslucencyOptions.ts`). */
export const TRACED_TRANSLUCENCY_MEANINGS: Readonly<Record<TracedTranslucencyField, string>> = {
  translucencyType: `The scene's translucency method: 'raster' (the default) draws the see-through surfaces with the raster passes, 'rayTraced' casts rays through the scene's triangles for them (see rayTracedTranslucency).`,
  rayTracedTranslucency: `Whether the translucency is traced: 'translucencyType' (the default) follows translucencyType, 'off' and 'on' decide for it. Needs the scene to have acceleration structures.`,
  rayTracedTranslucencyForceOpaque: `Whether the rays of the traced translucency treat every surface as opaque (off by default), which skips the any-hit test of the masks: masked materials then show their holes filled (off, a ray passes a masked surface where its opacity times its base map's alpha at the hit is under the threshold).`,
  rayTracedTranslucencyRefraction: `Whether the traced translucency bends its rays through refractive surfaces: 'translucencyRefraction' (the default) follows that switch, 'off' and 'on' decide for it. On, the result is composed back onto the scene's colour and the rays are not downsampled.`,
  translucencyRefraction: `The scene's choice of ray bending for the traced translucency, false by default; read when rayTracedTranslucencyRefraction follows it.`,
  rayTracedTranslucencySampleTranslucentReflectionInReflections: `Whether a reflection ray that meets a translucent surface picks stochastically between its reflection and its refraction (true by default); false loses the translucent reflections in reflections but is less noisy.`,
  rayTracedTranslucencyPathThroughputThreshold: `From 0; 0.001 by default. The throughput under which a path of the traced translucency ends.`,
  rayTracedTranslucencyDownsampleFactor: `1 or 2; 1 by default. The pixels a side one ray of the traced translucency stands for; one whenever the rays bend.`,
  rayTracedTranslucencyMaxPrimaryHitEvents: `-1 to 64; -1 by default, which takes translucencyMaxPrimaryHitEvents. The surfaces a primary path passes (at least 1).`,
  translucencyMaxPrimaryHitEvents: `1 to 64; 4 by default. The scene's number of surfaces a primary path of the traced translucency passes.`,
  rayTracedTranslucencyMaxSecondaryHitEvents: `-1 to 64; -1 by default, which takes translucencyMaxSecondaryHitEvents. The surfaces a secondary (reflection or refraction) path passes.`,
  translucencyMaxSecondaryHitEvents: `0 to 64; 2 by default. The scene's number of surfaces a secondary path of the traced translucency passes.`,
  rayTracedTranslucencyMaxRayIntensity: `From 0; 1000 by default. The most a ray of the traced translucency brings back, in the display's white (radiance times the image's pre-exposure), against fireflies.`,
}
