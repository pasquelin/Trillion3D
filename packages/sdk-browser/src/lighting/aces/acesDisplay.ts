/**
 * The standard output transform for a standard dynamic range display — sRGB's gamut and a peak of
 * 100 nits —: its numbers (`TRANSFORM`) and the two viewing conditions it takes a colour between,
 * the light's — the grading gamut's white — and the display's — its sRGB white —, at a luminance of
 * 100. The light is multiplied by the scene's multiplier, taken to the model's lightness,
 * colourfulness and hue (`acesCam.ts`), its lightness put through the tone scale, its colourfulness
 * compressed with it and the colour pulled into the display's gamut (`acesHull.ts`), then taken back
 * to the display's primaries: the shader does it (`acesWgsl.ts`), the tests hold it to its twin on
 * the processor (`acesModel.fixture.ts`).
 */
import { FILM } from '../filmCurveConstants.ts'
import { times3 } from '../triple.ts'
import { viewingFor } from './acesCam.ts'
import { transformOf } from './acesHull.ts'

/** The display the transform is for: its peak, in nits. */
const DISPLAY_PEAK = 100

/** The transform's numbers for the display's peak. */
export const TRANSFORM = transformOf(DISPLAY_PEAK)
/** The viewing conditions of the light — the grading gamut's white — and of the display — its
 *  sRGB white — at a luminance of 100. */
export const LIGHT_VIEW = viewingFor(times3(FILM.numbers.ap0ToXyz, [100, 100, 100]))
export const DISPLAY_VIEW = viewingFor(times3(FILM.numbers.srgbToXyz, [100, 100, 100]))
