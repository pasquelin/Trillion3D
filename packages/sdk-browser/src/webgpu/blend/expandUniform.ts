/**
 * THE TWELVE UNIFORM WORDS OF THE EXPANSION KERNEL, written once.
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
] as const;
export const UNI_WORDS = 12;
export const EXPAND_UNI = Object.fromEntries(UNI_FIELDS.map((nom, rang) => [nom, rang])) as Record<
  (typeof UNI_FIELDS)[number],
  number
>;
/** WGSL declaration of these words, in the same order, padding included. */
export const expandUniformWgsl = () =>
  `struct Uni{${UNI_FIELDS.map((nom) => `${nom}:u32,`).join('')}pad0:u32,pad1:u32,pad2:u32,}`;
