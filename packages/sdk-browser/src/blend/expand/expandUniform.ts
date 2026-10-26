import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
/**
 * THE TWELVE UNIFORM WORDS OF THE EXPANSION KERNEL (one slot a view, `expansionViews.ts`), written once.
 *
 * Three writes and one read share them: production encoding, the “GPU = model” proof, the test
 * double, and the struct the shader declares. Reordering a word in one of the four let the other
 * three compile and pass while reading the wrong fields — exactly the devices meant to catch the
 * drift. They all read here.
 */
const UNI_FIELDS = [
  'entryCount',
  'groupCount',
  'runCount',
  'instanceBase',
  'argsBase',
  'maxVertexWords',
  'vertexShift',
  'orderBase',
  'runsBase',
  'exclude',
  'required',
] as const
/** The struct of these words, padding included, laid out by the one struct rule. */
const UNI = fieldLayout('Uni', [
  ...UNI_FIELDS.map((name) => [name, 'u32'] as const),
  ['pad0', 'u32'],
] as const)
export const UNI_WORDS = UNI.words
export const EXPAND_UNI = UNI.at
/** WGSL declaration of these words, in the same order, padding included. */
export const expandUniformWgsl = () => wgslBlock('expandUniformWgsl', [], UNI.wgsl)
