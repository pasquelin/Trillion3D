/**
 * The numbers of the standard output transform's two compressions of a colour in the `JMh` of the
 * appearance model (`acesCam.ts`): the colourfulness is compressed with the lightness the tone
 * scale gave the colour, and a colour that still lies past the display's gamut is pulled onto it
 * along a line of constant hue. The gamut's edge is the cone of the display's primaries in `JMh`:
 * its cusp — the most colourful point of each hue — and the curvature of its upper face, both read
 * from tables a hue indexes (`HueTables`), and the reach of the grading gamut that bounds how far a
 * colour is pulled from. The numbers are the transform's: a toe on the colourfulness, an expansion
 * of the less colourful and a compression of the more, a focus of the projection lines that follows
 * the lightness, a smooth minimum of the two faces. The shader repeats them (`acesWgsl.ts`), the
 * tests' evaluation on the processor is `acesModel.fixture.ts`.
 */
import { toneScaleOf, yToJ, type V3 } from './acesCam.ts'

/** The tables a hue indexes: `reach` the largest colourfulness of the grading gamut at each whole
 *  degree (360 entries); `cusp` the display gamut's cusp at each whole degree, as lightness,
 *  colourfulness and hue, sorted by hue with one wrapped entry at each end (362); `gamma` the
 *  curvature of the gamut's upper face at each whole degree, wrapped the same way (362). */
export type HueTables = {
  reach: readonly number[]
  cusp: readonly V3[]
  gamma: readonly number[]
}

/** The transform's numbers for a display of peak luminance `peak`: the tone scale, the lightness
 *  of the peak (`limitJ`) and of the display's middle grey (`midJ`), the exponent that keeps a
 *  colour's chromaticity through the lightness change (`modelGamma`), the chroma compression's
 *  expansion `sat`, its threshold `satThr` and its compression `compr`, the hue-dependent scale
 *  `norm` of the colourfulness, the focus distance of the projection lines and the curvature of
 *  the gamut's lower face. */
export function transformOf(peak: number) {
  const scale = toneScaleOf(peak)
  const logPeak = Math.log10(scale.n / scale.nr)
  return {
    scale,
    limitJ: yToJ(peak),
    midJ: yToJ(scale.ct * 100),
    modelGamma: 1 / (0.59 * (1.48 + Math.sqrt(20 / 100))),
    compr: 2.4 + 2.4 * 3.3 * logPeak,
    sat: Math.max(0.2, 1.3 - 1.3 * 0.69 * logPeak),
    satThr: 0.5 / scale.n,
    norm: (0.03379 * scale.n) ** 0.30596 - 0.45135,
    focus: 1.35 + 1.35 * 1.75 * logPeak,
    lowerGamma: 1.14 + 0.07 * logPeak,
  }
}
