import type { HizField } from '../contracts/hizOptions.ts'

/** The settings of the depth pyramid that govern the roots' test against it. */
export type HzbOcclusionField = Extract<
  HizField,
  `hzbOcclusion${string}` | 'occlusionQueries' | 'downsampledOcclusionQueries'
>

/** What each of them means (`../contracts/hizOptions.ts`). */
export const HZB_OCCLUSION_MEANINGS: Readonly<Record<HzbOcclusionField, string>> = {
  occlusionQueries:
    "Whether the main view hides the objects the depth it drew already hides, by hardware occlusion queries: off by default. On, the world boxes of the objects are drawn sixteen to a query against the depth the image drew, nothing written, and an object whose group let no sample through is left out of the cut a few images later, until a later group lets a sample through; an object with no box or a box that reaches the eye's plane is never hidden, and the shadow maps never see the verdict. Applies where hzbOcclusion is 0; above 0 the depth pyramid's test takes its place.",
  downsampledOcclusionQueries:
    'Whether the hardware occlusion queries (occlusionQueries) test the boxes against a smaller copy of the depth the image drew: off by default. On, the depth is first reduced to half its size on each side, each texel keeping the farthest of the four it covers, and the boxes are drawn at that size against the reduction; an object is then hidden only where the whole square of texels hides it, so fewer objects are hidden and the queries cost fewer samples. Applies where occlusionQueries is on and hzbOcclusion is 0.',
  hzbOcclusion:
    "Whether the main view hides the objects the depth it drew already hides: 0, the default, none; 1, each object's world box is projected and tested against the farthest depth of the pyramid every image, the verdicts come back a few images late, and an object found behind the depth is left out of the next images' cut until a test finds it in front again; 2, the same, forced. The test is conservative: it never hides an object whose box reaches the near plane or lies in front of the depth, though an object that comes into view is drawn a few images late.",
  hzbOcclusionNeverTestDistance:
    'Metres from the eye within which an object is never tested, 0 by default (none). A finite number of at least 0. Applies where hzbOcclusion is above 0.',
  hzbOcclusionExpandAmount:
    'Metres every tested box is grown by on each side before it is projected, 0 by default; the larger, the fewer the objects hidden and the fewer the objects that show late. A finite number of at least 0. Applies where hzbOcclusion is above 0.',
  hzbOcclusionExpandNewlyAmount:
    'Metres an object not tested for hzbOcclusionFramesNotTestedToExpand images has its box grown by, beside hzbOcclusionExpandAmount, for the next hzbOcclusionFramesToExpandNewly images it is tested, 0 by default. A finite number of at least 0. Applies where hzbOcclusion is above 0.',
  hzbOcclusionExpandScreenSpace:
    'Pixels every tested box is grown by on each side in the screen, 0 by default, applied after hzbOcclusionExpandAmount. A finite number of at least 0. Applies where hzbOcclusion is above 0.',
  hzbOcclusionExpandNewlyScreenSpace:
    'Pixels an object not tested for hzbOcclusionFramesNotTestedToExpand images has its box grown by in the screen, beside hzbOcclusionExpandScreenSpace, for the next hzbOcclusionFramesToExpandNewly images it is tested, 0 by default. A finite number of at least 0. Applies where hzbOcclusion is above 0.',
  hzbOcclusionFramesNotTestedToExpand:
    'The images an object goes untested (outside the view, or within hzbOcclusionNeverTestDistance) before it counts as newly tested and has its box grown by the newly amounts, 5 by default. A whole number from 0 to 1000000. Applies where hzbOcclusion is above 0.',
  hzbOcclusionFramesToExpandNewly:
    'The images a newly tested object has its box grown by the newly amounts, 2 by default. A whole number from 0 to 1000000. Applies where hzbOcclusion is above 0.',
}
