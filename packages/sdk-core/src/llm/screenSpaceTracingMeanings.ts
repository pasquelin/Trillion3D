import type { ScreenSpaceTracingField } from '../contracts/screenSpaceTracingOptions.ts'

/** What each setting of the screen-space traces means (`../contracts/screenSpaceTracingOptions.ts`). The defaults and the ranges are the schema's own. */
export const SCREEN_SPACE_TRACING_MEANINGS: Readonly<Record<ScreenSpaceTracingField, string>> = {
  reflectionMethod:
    "What answers the reflections: scene (the default), the rays traced through the scene; screen, a ray marched through the depth the image drew, which reads the last lit image where it meets a surface; off, nothing, so a surface reflects the captures and the sky light alone. The screen answers where the method is screen and where it is scene but the scene's reflections are not on. true is the default, false is off.",
  globalIlluminationMethod:
    "What answers the indirect diffuse light: scene (the default), the screen probes and the world's light; screen, cosine rays marched through the depth the image drew, which read the last lit image; off, none. The screen answers only where the method is screen. true is the default, false is off.",
  screenReflectionLevel:
    'The cap of the quality of the screen reflections, from 0 to 4 (3 by default): 0 turns them off; the level they trace at is the lowest of this cap and what screenReflectionQuality reaches (low from 0, medium from 40 and cap 2, high from 60 and cap 3, very high from 80 and cap 4).',
  screenReflectionQuality:
    'The view quality of the screen reflections, from 0 to 100 (50 by default, which is medium): the level they trace at, under the cap screenReflectionLevel. Low and medium cast one ray a pixel, high four, very high twelve.',
  screenReflectionIntensity:
    'The share of the reflected light the screen reflections bring back, from 0 to 100 (100 by default); below 1 they are not traced.',
  screenReflectionMaxRoughness:
    'The roughness at which the screen reflections have faded out, from 0.01 to 1 (0.6 by default): a surface half as rough reflects in full, a surface this rough not at all. The lowest two levels fade twice as fast.',
  visualizeScreenReflections:
    'Shows the pixels that trace a screen reflection as a checker of red and yellow instead of the reflection (off by default).',
  screenReflectionHalfResColor:
    "Whether the screen reflections' rays read the half-resolution twin of the last lit image (off by default): cheaper, with little loss.",
  screenReflectionTemporal:
    'Whether the screen reflections go through the temporal filter where the anti-aliasing already accumulates in time (off by default); where it does not, the filter always runs.',
  screenReflectionFilterSize:
    'The width in pixels of the kernel with which the temporal filter of the screen reflections reads the current image (1 by default), from 0.01 to 100.',
  screenReflectionCatmullRom:
    'Whether that kernel is a Catmull-Rom, a little sharper, instead of a Gaussian (off by default).',
  screenReflectionDenoiser:
    'Whether the screen reflections go through the screen denoiser instead of the temporal filter (off by default): the trace also gives how far its rays travelled, the reflections are reconstructed along the reflection lobe of each pixel, widened by the pre-convolution passes, then accumulated over the images. true is on, false is off.',
  screenReflectionDenoiserSamples:
    'The most samples the reflections denoiser reads in its reconstruction, from 1 to 56 (8 by default).',
  screenReflectionDenoiserPreConvolution:
    'The number of widening passes the reflections denoiser runs after its reconstruction, from 0 to 4 (1 by default).',
  screenReflectionDenoiserTemporal:
    'Whether the reflections denoiser accumulates its result over the images (on by default).',
  screenReflectionStencil:
    'Whether the pixels that trace are marked in a stencil first and the trace drawn over them alone (off by default). Not with the tiles.',
  screenReflectionCompute:
    'Whether the screen reflections are traced by a compute pass (off by default, a draw over the view). Not with the tiles or the stencil.',
  screenReflectionTiles:
    'Whether the pixels that trace are gathered by tiles of 8 by 8 pixels and the trace and its composition run over those tiles alone (off by default).',
  screenReflectionTilesMaxRoughness:
    "The roughness above which a pixel does not make its tile trace (-1 by default: the view's screenReflectionMaxRoughness).",
  screenReflectionTilesMinSpecular:
    'The specular below which a pixel does not make its tile trace, from -0.001 to 1.001 (0 by default).',
  screenReflectionTilesShow: 'Tints the tiles that trace (off by default).',
  screenGiLevel:
    'The quality of the screen indirect light, from 1 to 4 (4 by default): 4, 8, 16 or 32 rays a pixel; below 1 it is off, above 4 it is 4.',
  screenGiSkyDistance:
    'Metres (100 000 by default): a pixel of the last lit image farther than this is sky and brings no light to the screen indirect light; 0 turns the test off.',
  diffuseIndirectHalfRes:
    'Whether the screen indirect light is traced at half the size of the image (on by default).',
  screenGiDenoiser:
    'Whether the screen indirect light goes through the screen denoiser (on by default): a reconstruction that mixes the neighbouring pixels of the same surface, then the accumulation over the images. Off, the mean of the rays is the light and no surface is occluded.',
  screenGiDenoiserSamples:
    'The most samples the screen indirect light denoiser reads in its reconstruction, from 1 to 56 (8 by default).',
  screenGiDenoiserTemporal:
    'Whether the screen indirect light denoiser accumulates its result over the images (on by default).',
}
