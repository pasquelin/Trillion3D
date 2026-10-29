import type { PathTracingField } from '../contracts/pathTracingOptions.ts'

/** What the view's path tracer and denoiser settings mean (`../contracts/pathTracingOptions.ts`). */
export const PATH_TRACING_MEANINGS: Readonly<Record<PathTracingField, string>> = {
  pathTracing:
    "Whether the view is drawn by the path tracer (false, the default): a render mode that traces the scene's triangles, bounce after bounce, and keeps adding the samples of each image to those of the one before while the view and the scene stand still, until pathTracingSamplesPerPixel is reached. It replaces the frame's lighting, so every cost of the normal frame is paid again by the tracer instead. False draws the normal frame and reads none of the pathTracing settings.",
  pathTracingExperimental:
    'Whether the path tracer’s rarely used modes are on (false, the default); adaptive sampling is one, and pathTracingAdaptiveSampling has no effect without it.',
  pathTracingSamplesPerPixel:
    'How many samples each pixel gathers before the image stops accumulating: 2048 by default, 1 at least. The image is shown from the first sample and refined as the others come.',
  pathTracingMaxBounces:
    'How many bounces a path may take: 32 by default, 0 for the light that reaches the eye straight from the first surface.',
  pathTracingCompactionDepth:
    'The last bounce whose live paths are packed together before it is traced (6 by default); a value under 1, or past pathTracingMaxBounces, packs every bounce. The bounces after it go on over the paths of the last packed one, without packing again, which saves the launches of a tail few paths reach.',
  pathTracingDispatchSize:
    'The side, in pixels, of the tiles the image is traced in: 2048 by default. A smaller tile makes each dispatch shorter, which keeps a heavy scene from running past the time the device allows one.',
  pathTracingAdaptiveSampling:
    'Whether a pixel whose error has fallen under pathTracingAdaptiveSamplingErrorThreshold stops being traced (false, the default). It needs pathTracingExperimental.',
  pathTracingAdaptiveSamplingErrorThreshold:
    'The perceptual error under which a pixel is no more sampled when adaptive sampling is on: 0.001 by default, from 0.',
  pathTracingAdaptiveSamplingVisualize:
    'A view that shows how adaptive sampling works, from 0 to 7 (0, the default, none): 1 the active pixels as a heat map (the converged ones are shown as they are), 2 the sample count of each pixel against the current maximum, 3 to 7 a level of the error’s mip chain. Read only when adaptive sampling is on.',
  pathTracingProgressDisplay:
    'Whether a bar shows the samples gathered against pathTracingSamplesPerPixel (true, the default); it goes away when the count is reached and the accumulation stops.',
  pathTracingWiperMode:
    'Whether the path tracer is drawn only to the right of the cursor (false, the default), the normal frame left to show to the cursor’s left, to compare the two; the whole image is traced all the same, so that the accumulation stays in step. With no cursor in the view, its middle.',
  pathTracingDenoiser:
    'Whether the image is denoised (true, the default): the denoiser reads the radiance with its albedo, normals and depth once the last sample is gathered, or, when the accumulation has stopped, as soon as this is turned on.',
  pathTracingDenoiserNormalSpace:
    'The space the normals the denoiser reads are in: 0, the default, the world’s; 1 the camera’s, for which a pass converts them before the denoiser reads them.',
  pathTracingSpatialDenoiser:
    'Whether the denoiser’s spatial stage runs (true, the default): the radiance filtered, edge-aware, guided by the albedo, the normals and the per-pixel variance of the prepass.',
  pathTracingTemporalDenoiser:
    'Whether the denoiser’s temporal stage runs (false, the default): it estimates the motion between the last denoised image and this one, finds where the history can be trusted, and blends it in. It needs an earlier denoised image of the same size.',
  pathTracingDenoiserVarianceType:
    'Which variance the denoiser’s prepass keeps per pixel: 0 one per colour channel of the radiance, 1 (the default) one for the luminance, one for the albedo and the length of the mean normal (a short mean normal means normals that disagree), and the alpha.',
  pathTracingDenoiserOutputVarianceTexture:
    'Whether the variance image (the standard error of the mean) is always written (false, the default: only when the spatial stage or a feature fusion needs it).',
  pathTracingDenoiserRankedLuminanceVariance:
    'Whether the luminance used for the variance ranks the channels first (false, the default): better in dim, high-variance light such as dawn or dusk.',
  pathTracingTemporalDenoiserVisualizeMotionVector:
    'Whether the motion the temporal stage found is drawn over the image (false, the default): a colour wheel by direction and length, with arrows on a grid.',
  pathTracingTemporalDenoiserSubPixelOffset:
    'Whether the motion is refined under a pixel by a quadratic fit (true, the default).',
  pathTracingTemporalDenoiserKappa:
    'How fast the history weight falls with the matching error (-1, the default, derives it from pathTracingTemporalDenoiserDeltaE).',
  pathTracingTemporalDenoiserEta:
    'The matching error under which the history keeps its full weight (1 by default; -1 takes the error of one just-noticeable colour difference).',
  pathTracingTemporalDenoiserDeltaE:
    'The CIE colour difference at which the low-frequency history weight reaches zero (5 by default; 1 is barely visible, 10 visible at a glance). Used when Kappa is -1.',
  pathTracingTemporalDenoiserDeltaEHighFrequency:
    'The per-pixel CIE colour difference between the warped history and the new image from which the history weight is cut (2.1 by default, at least 1).',
  pathTracingTemporalDenoiserAlpha:
    'The weight of the history in the exponential average (1 by default).',
  pathTracingTemporalDenoiserSource:
    'What the motion is estimated on: 0 (the default) the last denoised radiance against the new image, 1 the normals, 2 the albedo, 3 the raw radiance, any other value a fusion of the variances.',
  pathTracingTemporalDenoiserSubPixelOffsetStartMip:
    'The coarsest level of the 7-level pyramid from which the sub-pixel motion is estimated (8 by default: every level).',
  pathTracingTemporalDenoiserMotionOperation:
    '0 uses the motion estimated as it is; 1 (the default) subtracts the motion estimated of the image against itself, which removes the bias of the sub-pixel fit.',
  pathTracingTemporalDenoiserVisualizeWarp:
    '0 (the default) none; 1 draws the history warped by the motion; 2 the same with the weights.',
  pathTracingTemporalDenoiserDistanceMetrics:
    'How two pixels are compared to find the motion: 0 their luminance, 1 their colour distance, 2 (the default) the CIE 2000 colour difference.',
  pathTracingTemporalDenoiserTotalVariation:
    'Whether less history is used where the matching error varies a lot in a neighbourhood (true, the default).',
  pathTracingTemporalDenoiserPatchCount:
    'How many similar patches are merged by a bilateral weight in the temporal blend (1 by default, up to 16).',
  pathTracingTemporalDenoiserMode:
    'When the denoiser runs: 0 or 1 (the default) once, at the last sample, as in offline rendering; 2 at every image, to see it work while the image accumulates. To never denoise, turn pathTracingDenoiser off.',
  pathTracingVisualize:
    'Draws a field of what each pixel sees in place of the lit image (default none, the lit image): a normal or the tangent, a colour, the transparency (its colour, or the count of translucent surfaces the ray goes through), the roughness, the anisotropy, the index of refraction, the shading model, the lighting channels, the position, the light grid’s count, axis, list or singular cells, the lights a volume sees, which side of the surface is hit, the fuzz, the subsurface colour, radius, weight or phase, the opacity, or a colour by the triangle, the instance or the cluster; PrimaryRays is the path tracer itself with no air, cloud, denoiser or adaptive sampling. The views see every surface the ray goes through and add their colours in proportion to what they cover; one sample, no denoiser.',
  pathTracingVisualizeIncludeTranslucent:
    'Whether the views see the meshes that are translucent whole (true, the default); off, the rays go through them and only the opaque surfaces show.',
  pathTracingVisualizeSamplesPerPixel:
    'The samples per pixel the PrimaryRays view gathers (1 by default); the other views take one.',
  pathTracingVisualizeMaxCount:
    'The lights the views that turn a count into a colour take as the red end of their blue to red ramp (16 by default); a cell past it is pink.',
  pathTracingVisualizeAmbientOcclusionMaxDistance:
    'How far, in metres, the occlusion ray goes that gives the views of the payload a little shading (2 by default, the reference’s 200 centimetres); a negative value shades by the facing ratio instead.',
  pathTracingMISMode:
    'How the lights are integrated at each surface the path meets: 0 by the material’s samples alone, 1 by sampling the lights alone, 2 (the default) by both, each weighed against the other so that neither is counted twice. 0 and 1 are for checking one method against the other.',
  pathTracingMISCompensation:
    'Whether the sky’s importance sampling leaves out what the material’s samples already find well (true, the default): the average of the sky is taken from its table, so that dim parts are left to the material and the lights’ samples go to the bright ones. It takes effect only with pathTracingMISMode 2.',
  pathTracingMaxPathIntensity:
    'The brightest a path that has left the camera’s ray adds to a pixel, from 1 to 65504 (24 by default); a brighter path is dimmed to it, its colour kept. It clips the rare bright paths that make single white pixels, at the price of a little light.',
  pathTracingIndirectDispatch:
    'Whether each packed bounce is dispatched over exactly the paths still alive (true: the GPU reads the count the bounce before wrote), or over every path of the tile with the surplus threads ending at once (false, the default). The image is the same; the choice is one of speed.',
  pathTracingFilterWidth:
    'The width of the anti-aliasing filter the camera’s rays are drawn through, in pixels (3 by default, from 0 to 64): each sample of a pixel is jittered by a Gaussian whose width covers plus or minus three standard deviations, so 3 is a standard deviation of half a pixel. 0 samples the centre of the pixel; a wider filter softens the image.',
  pathTracingApproximateCaustics:
    'Whether the paths that would carry a smooth surface’s light onto a rough one, the caustics, are roughened so that they stop making speckles (true, the default).',
  pathTracingEnableEmissive:
    'Whether emissive surfaces light the scene (true, the default). Off, they stay dark: their light is not added by a path that meets them.',
  pathTracingBackgroundAlpha:
    'The alpha of a pixel whose ray meets nothing, from 0, transparent (the default), to 1, solid.',
  pathTracingSamplerType:
    'The random numbers of the paths: 0 (the default) a sequence of its own for each pixel; 1 one sequence across the whole image, ordered along a curve so that the error of the last sample spreads out like blue noise (the error of the samples before it looks like white noise).',
  pathTracingFrameIndependentTemporalSeed:
    'Whether the sequence of random numbers goes on from one restart of the accumulation to the next (true, the default), so that no pattern repeats; off, each restart begins the same sequence over, for images that must be the same twice.',
  pathTracingSkylightCaching:
    'Whether the sky’s sampling tables are kept from one image to the next (true, the default); off, they are made again at each image, for measuring.',
  pathTracingVisibleLights:
    'Which lights the camera’s own rays see: 0 (the default) none, 1 all of them, 2 the sky alone.',
  pathTracingLightGridResolution:
    'The side of the grid that culls the lights a point need not look at: 256 by default, a power of two (a number between is rounded up). The finer it is, the fewer lights each cell keeps.',
  pathTracingLightGridMaxCount:
    'The most lights a cell of that grid keeps, from 1 to 256 (128 by default); the lights of the scene, if fewer, are all it can keep.',
  pathTracingLightGridAxis:
    'The axis the lights are projected along to make the grid: 0, 1 or 2, or -1 (the default) for the best of the three at each cell.',
  pathTracingEnableReferenceAtmosphere:
    'Whether the paths trace the atmosphere as a volume that scatters light (1), or leave the air to the sky light (0); -1 (the default) follows the view’s post process setting, which is off where it sets none.',
  pathTracingAtmosphereOpticalDepthLUTResolution:
    'The side, in texels, of the table of the air’s optical depth the traced atmosphere reads its transmittance from: 512 by default, held to what the device makes a texture of.',
  pathTracingAtmosphereOpticalDepthLUTNumSamples:
    'The samples integrated along the ray of each texel of that table: 16384 by default.',
  pathTracingEnableAtmosphereGround:
    'Whether the camera’s rays see the planet’s ground under the traced atmosphere (default off); the paths that scattered in the air always see it, so that it colours the air.',
  pathTracingUseAnalyticTransmittance:
    'Whether the transmittance through the traced atmosphere is read from the optical depth table (true, the default); off, it is estimated by stepping through the volume.',
  pathTracingMaxRaymarchSteps:
    'The most steps a ray takes through a volume before it stops (768 by default); raise it if the limit is reached, which biases the image.',
  pathTracingVolumeMISMode:
    'How the lamps and rectangles light a volume, the traced air and the clouds: 0 by the scattering events the density gives, 1 (the default) by a point drawn on the ray’s stretch of the volume with a density that follows the light’s reach (equi-angular sampling), the events then lighting by the suns and the sky alone.',
  pathTracingEnableReferenceClouds:
    'Whether the paths march the cloud layer’s material as a volume (true, the default); it needs the traced atmosphere and a sky with a clouds part; off, the clouds are left to the sky light.',
  pathTracingCloudAccelerationMapResolution:
    'The side, in texels, of the map that bounds the clouds’ march: for each column of the layer, its densest cloud and the lowest and highest heights that hold any (512 by default, from 1 to 4096 and no more than the device makes a texture of).',
  pathTracingCloudAccelerationMapNumSamples:
    'The samples of the cloud material each image adds to each texel of that map (64 by default, from 1 to 65536); the bounds tighten as the images accumulate.',
  pathTracingCloudAccelerationMapVisualize:
    'Draws the acceleration map in place of the clouds (default off), to judge its resolution.',
  pathTracingCloudMultipleScatterMode:
    'How the light scattered several times inside a cloud is made: 0 none, the material’s approximation ignored and the roughness cutoff applied; 1 (the default) the material’s approximation, the cutoff applied; 2 by the paths alone, the material’s approximation ignored and the cutoff lifted.',
  pathTracingCloudRoughnessCutoff:
    'The roughness of a path beyond which the clouds are not marched, to save time: 0.05 by default, from 0 to 1.',
}
