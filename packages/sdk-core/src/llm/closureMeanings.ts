import { CLOSURES_MAX, CLOSURE_RULES, type ClosureField } from '../contracts/closureOptions.ts'

/** What each closure setting means (`../contracts/closureOptions.ts`). */
export const CLOSURE_MEANINGS: Readonly<Record<ClosureField, string>> = {
  closuresPerPixel: `The most closures a material keeps per pixel, from 1 to ${CLOSURES_MAX} (${CLOSURE_RULES.closuresPerPixel.default} by default). A material built from a closure tree (slabs mixed side by side, layered, added or weighted) that flattens to more is simplified: its deepest operators are blended into one closure each until it fits. A surface without a tree is one closure.`,
  closureCountFromMaterial:
    'Whether a view keeps as many closures a pixel as the most any material in view has, up to closuresPerPixel (true by default); false, every view keeps closuresPerPixel.',
  stochasticClosureLighting:
    "How the sampled lighting lights a pixel of several closures (false by default): false, every closure is lit and the lights summed by the closures' weights; true, one closure is picked at random for each pixel, all equally likely, lit alone and its light divided by the chance of the pick, the denoiser averaging the picks over the frames (cheaper, noisier). A pixel of one closure is unaffected.",
}
