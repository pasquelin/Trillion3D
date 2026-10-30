import type { SingleLayerWaterField } from '../contracts/singleLayerWaterOptions.ts'

/** What each setting of the single-layer water means (`../contracts/singleLayerWaterOptions.ts`): the
 *  surfaces whose material graph wires a water output (`scatteringCoefficients`,
 *  `absorptionCoefficients`, `phaseG`, `colorScaleBehindWater`). */
export const SINGLE_LAYER_WATER_MEANINGS: Readonly<Record<SingleLayerWaterField, string>> = {
  singleLayerWater:
    'Whether the single-layer water is drawn; true by default. Off, no water is drawn.',
  singleLayerWaterReflection:
    "The reflection technique of the water: 'enabled' (the default), the traced front layer as the rest of the scene reflects, always on the water; 'disabled', no reflection; 'captures', the reflection captures and the sky only; 'screenSpace', the screen march and the captures, no scene ray.",
  singleLayerWaterReflectionDownsample:
    'Times fewer pixels a side (1 or 2) the water reflections are traced at; 1 by default. 2 adds noise, best with singleLayerWaterReflectionDenoising.',
  singleLayerWaterReflectionCheckerboard:
    'Whether the downsampling of the water reflections is across alone, blocks of singleLayerWaterReflectionDownsample pixels by one, when that is 2; false by default.',
  singleLayerWaterReflectionReconstruction:
    "Whether a pixel of the water rebuilds its reflection from the rays round it; false by default, the water's reflections being mostly mirrors.",
  singleLayerWaterReflectionDenoising:
    'Whether the water reflections are denoised, temporally and spatially; false by default. It adds some cost and softens them, and removes noise and flicker.',
  singleLayerWaterReflectionTemporal:
    "Whether the screen march's reflection on the water is filtered by the temporal pass; true by default.",
  singleLayerWaterTiledComposite:
    'Whether the reflection composite over the water draws only the 8 by 8 tiles that hold water; true by default.',
  singleLayerWaterTiledSceneColorCopy:
    'Whether the copy of the scene the water refracts is made only on the tiles that hold water; true by default.',
  singleLayerWaterWaveOps:
    'Whether the tiles that hold water are listed with subgroup operations where the device grants them; true by default.',
  singleLayerWaterDepthPrepass:
    "Whether the water's depth is drawn first, ahead of its shading; true by default. The tiles and the refraction mask are made from it.",
  singleLayerWaterUnderwaterFogWhenCameraIsAboveWater:
    'Whether the height fog is also laid on the scene seen through the water, at the depth of what lies behind it, when the camera is above the water; false by default. It avoids artifacts when entering and leaving the water in a strong fog, and causes some when the water is looked at from afar.',
  singleLayerWaterUnderwaterTest:
    'Whether the camera is tested against the water bodies each image (a body: the volume under the footprint of a water surface, down to mesh.waterBody.depth, or to the geometry of the scene under the surface at the camera when unset; only bodies with mesh.waterBody.underwaterPostProcess are weighed, and not those a WaterExclusionVolume (object.waterExclusion()) excludes where the camera stands in it); true by default. A camera possibly in the water has the clouds composed into the scene seen through the water too, a camera under water has the sky, the fog and the clouds composed before the water. Off, no camera is ever in the water.',
  singleLayerWaterUnderwaterTraceDistance:
    'Metres of the sphere swept from the camera up by the same distance to find the water bodies near it; 1 by default. It is inflated to account for waves, which the sweep does not hit.',
  singleLayerWaterUnderwaterPreciseTraceDistance:
    "Metres of the sphere at the camera that verifies the camera overlaps a body once it is under the body's surface; 0.1 by default.",
  singleLayerWaterOptimizedClear:
    "Whether the water's depth is cleared over the view alone, not the whole target; true by default.",
  singleLayerWaterVelocityOutputPass:
    "When the water writes its velocity, the vector the temporal pass and the motion blur read of a pixel: 'depthPrepass' (the default) right after the water's depth is drawn (without the depth pass, with the shading), 'basePass' with the shading, 'none' never, the pixel then moving as the surface behind it. A water pixel moves with the camera alone.",
  singleLayerWaterShadersSupportDistanceFieldShadow:
    "Whether the water programs keep the sun apart from the rest of the water's light, for the sun's distance-field shadow; true by default. Read when the session opens.",
  singleLayerWaterDistanceFieldShadow:
    "Whether the sun's light on the water is kept apart and shadowed by the classic distance-field cascade of the sun (shadowVirtualEnable off), traced on the water's depth and upsampled over the tiles that hold water; true by default. Needs singleLayerWaterShadersSupportDistanceFieldShadow and a scene whose meshes have distance fields.",
  singleLayerWaterShadersSupportVsmFiltering:
    "Whether the water programs hold the full trace of the sun's shadow that singleLayerWaterVsmFiltering turns on; false by default. Read when the session opens.",
  singleLayerWaterVsmFiltering:
    "Whether the sun's shadow on the water is the full trace the opaque surfaces get, not one sample of the shadow map; false by default. Needs singleLayerWaterShadersSupportVsmFiltering.",
  singleLayerWaterCloudShadow: 'Whether the clouds shade the sun on the water; false by default.',
  singleLayerWaterRefractionDownsample:
    'Times fewer pixels a side (1 or 2) the copy of the scene the water refracts is made at; 1 by default.',
  singleLayerWaterRefractionCulling:
    'Whether the refraction is skipped where it shows little (see the distance, Fresnel and depth cullings below); false by default.',
  singleLayerWaterRefractionDistanceCulling:
    'Metres from the camera past which the refraction is skipped, from 0; 0 by default, no distance culling.',
  singleLayerWaterRefractionDistanceCullingFadeRange:
    'Metres over which the refraction fades out before the distance culling, from 0; 4 by default.',
  singleLayerWaterRefractionFresnelCulling:
    'Fresnel reflectance, from 0 to 1, above which the refraction is skipped; 0 by default, no Fresnel culling.',
  singleLayerWaterRefractionFresnelCullingFadeRange:
    'Fresnel range over which the refraction fades out before the Fresnel culling, from 0; 0.2 by default.',
  singleLayerWaterRefractionDepthCulling:
    'Metres of water depth below which the refraction is skipped, from 0; 0 by default, no depth culling.',
  singleLayerWaterRefractionDepthCullingFadeRange:
    'Metres of depth over which the refraction fades out before the depth culling, from 0; 1 by default.',
}
