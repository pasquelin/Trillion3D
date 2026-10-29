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
    'Whether the denoiser’s spatial stage runs (true, the default). It is the built-in stage, which passes the radiance on as it is.',
  pathTracingTemporalDenoiser:
    'Whether the denoiser’s temporal stage runs (false, the default): it estimates the motion between the last denoised image and this one, finds where the history can be trusted, and blends it in. It needs an earlier denoised image of the same size.',
  pathTracingTemporalDenoiserMode:
    'When the denoiser runs: 0 or 1 (the default) once, at the last sample, as in offline rendering; 2 at every image, to see it work while the image accumulates. To never denoise, turn pathTracingDenoiser off.',
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
}
