/**
 * One half of the check the runtime runs on the cache's tables: does the surface the table
 * declares describe the material the loader built?
 *
 * Both sides are read in the engine's own words — the table by the compiler, the host material by
 * `hostSurfaceImport.ts` — so this file compares records, never a host object with a JSON field.
 */
import {
  TABLE_FLAGS,
  TABLE_NUMBERS,
  TABLE_SLOTS,
  TABLE_TRIPLETS,
  type TableMaterial,
  type TableTexture,
  type TableTextureSlot,
  type Texture,
} from '../sdk-core/index.ts';
import type { VisMaterial } from './visibilityTypes.ts';

/** Two values of the same quantity, one composed in Rust and one in JavaScript: equal to the last
 *  digit either shares. Anything coarser would let a wrong factor through as rounding. */
export function near(expected: number, actual: number) {
  return Math.abs(expected - actual) <= 1e-6 * Math.max(1, Math.abs(expected), Math.abs(actual));
}
const SAMPLER_FIELDS = ['wrapS', 'wrapT', 'magFilter', 'minFilter'] as const;
/** Two glTF textures the loader folds into one object: same image, same sampler state. It keys
 *  its cache on exactly that (`GLTFLoader.loadTextureImage`), and the rank it then publishes for
 *  the shared object is the first of them — so a slot naming either one names the same record. */
const sameTexture = (a: TableTexture | undefined, b: TableTexture) =>
  !!a && a.image === b.image && SAMPLER_FIELDS.every((field) => a[field] === b[field]);

function sampler(slot: TableTextureSlot, texture: Texture, textures: readonly TableTexture[]) {
  const declared = textures[slot.texture];
  if (!declared) return `texture ${slot.texture} is outside the texture table`;
  for (const field of SAMPLER_FIELDS)
    if (declared[field] !== texture[field])
      return `${field} ${texture[field]} where the table says ${declared[field]}`;
  const transform = texture.transform;
  for (let i = 0; i < slot.transform.length; i++)
    if (!near(slot.transform[i], transform[i] ?? Number.NaN)) return `transform element ${i}`;
  return null;
}
/**
 * One map slot: filled on both sides or empty on both, the same glTF rank when the loader
 * published one for the record it built, and the same sampler state.
 *
 * A rank the loader did not publish — the association table is shared between a texture and the
 * copy `KHR_texture_transform` makes of it — leaves the rank unchecked and the sampler checked;
 * the slot's presence and its addressing still have to agree.
 */
function slotDivergence(
  expected: TableTextureSlot | null,
  actual: Texture | undefined,
  ranks: ReadonlyMap<Texture, number>,
  textures: readonly TableTexture[],
) {
  if (!expected !== !actual) return expected ? 'is empty where the table fills it' : 'is filled';
  if (!expected || !actual) return null;
  const rank = ranks.get(actual);
  const declared = textures[expected.texture];
  if (
    rank !== undefined &&
    rank !== expected.texture &&
    declared &&
    !sameTexture(textures[rank], declared)
  )
    return `names texture ${rank} where the table names ${expected.texture}`;
  return sampler(expected, actual, textures);
}
/**
 * Every field the engine reads of a surface, compared against the table entry the node table
 * pointed at. Returns the first divergence, named by its field, or `null` when the two agree.
 */
export function materialDivergence(
  expected: TableMaterial | undefined,
  actual: VisMaterial,
  ranks: ReadonlyMap<Texture, number>,
  textures: readonly TableTexture[],
) {
  if (!expected) return 'the material table has no entry at that rank';
  for (const field of TABLE_FLAGS)
    if (expected[field] !== actual[field])
      return `${field} is ${actual[field]} where the table says ${expected[field]}`;
  for (const field of TABLE_NUMBERS)
    if (!near(expected[field], actual[field]))
      return `${field} is ${actual[field]} where the table says ${expected[field]}`;
  for (const field of TABLE_TRIPLETS)
    for (let axis = 0; axis < 3; axis++)
      if (!near(expected[field][axis], actual[field][axis]))
        return `${field}[${axis}] is ${actual[field][axis]} where the table says ${expected[field][axis]}`;
  for (const field of TABLE_SLOTS) {
    const divergence = slotDivergence(expected[field], actual[field], ranks, textures);
    if (divergence) return `${field} ${divergence}`;
  }
  return null;
}
