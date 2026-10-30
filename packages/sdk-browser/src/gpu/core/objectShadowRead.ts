import { blendTextureBudget } from './stageStorage.ts'

/**
 * WHAT THE BLENDS NEED OF THE DEVICE TO READ THEIR OWN OBJECT'S SHADOW (the translucent self shadow, `blend/objectShadow/objectShadowSelfWgsl.ts`):
 * every read binds the packed table (one `rgba32uint` texture, the item table, the records and, where the atlas is not sampled, the atlas rectangles as
 * packed halves) in both stages of the blends, one sampled texture of the fragment stage; the native read binds the subjects' atlas (one 2D array of two
 * Fourier layers) besides, a second. The widest fragment stage (the display-filtered blends with the rectangle lights' pictures and the reflection group)
 * already binds twenty-three; the session asks for twenty-six where its adapter offers them, with the sorted translucency's depth texture
 * (`WEBGPU_REQUIRED_LIMITS`). A device that grants one fewer reads the atlas from the packed table (a pass copies the subjects' rectangles into it, the same
 * texels, the filter done by hand); a device that grants none to spare (the sixteen WebGPU guarantees, the widest stage's own count) folds a second texture into
 * the packed table: the light profiles' atlas, which the blends then read from it (`'folded'`, the same texels and bilinear weights, one sampled texture freed for the table).
 * A device that is one texture short with the sorted translucency's depth texture folds that one into the table too (`'foldedDepth'`). A device that cannot even hold the widest stage keeps the blends without the read. No storage buffer is bound: the read never
 * touches the storage budgets. The count the read adds to is the widest stage the device's grants allow. The sorted translucency's collect group
 * (`oitLayouts`), which the programs that sort bind past the blend's and the reflection's, adds its own depth texture to the same stage: where the session sorts (`oit`), the read counts it. The list of the features (`BLEND_TEXTURE_FEATURES`, `gpu/core/stageStorage.ts`) is the one the grants, the layouts and the asked limit derive from.
 *
 * How the blends read the atlas of the subjects: from the texture itself, or from the rectangles copied into the packed table (`'packed'`); `'folded'` is the packed
 * read of a device that has no sampled texture to spare for the table: the light profiles' atlas is copied into the table too and read from it, so the table
 * takes the place the profiles' texture leaves; `'foldedDepth'` is the folded read of a device whose sorted translucency (the collect texture of the list) leaves one texture too few
 * even so: the depth the collecting fragments are tested against is written into the table too (a pass, `foldOitDepth`) and read from it, and the collect group binds no depth texture.
 */
export type ObjectShadowAtlasRead = 'texture' | 'packed' | 'folded' | 'foldedDepth'

/** Whether the blends sample the subjects' atlas itself, not the rectangles copied into the packed table. */
export const readsAtlasTexture = (read: ObjectShadowAtlasRead | undefined) => read === 'texture'

/** Whether the read keeps the sorted translucency's depth in the packed table (a pass writes it there), not as a sampled texture. */
export const foldsDepth = (read: ObjectShadowAtlasRead | undefined) => read === 'foldedDepth'

/** Whether the read keeps the light profiles' atlas in the packed table, not as a sampled texture. */
export const foldsProfiles = (read: ObjectShadowAtlasRead | undefined) =>
  read === 'folded' || read === 'foldedDepth'

/** How `device` lets the blends read the subjects' atlas, none where it grants neither; `sorts`: the programs bind the sorted translucency's collect group besides (its depth texture). */
export function objectShadowAtlasRead(
  device: Pick<GPUDevice, 'limits'>,
  sorts = false,
): ObjectShadowAtlasRead | undefined {
  // The list's features in order (pictures, reflection, the collect texture where the programs sort); what is spare past them is the read's.
  const { granted, spare } = blendTextureBudget(device, sorts)
  if (granted.has('objectShadow')) return 'texture'
  if (spare >= 1) return 'packed'
  if (spare >= 0) return 'folded'
  // The sorted translucency's depth texture folded into the table as well: the table takes the place of the profiles' atlas and the depth's.
  return sorts && spare >= -1 ? 'foldedDepth' : undefined
}

/** The width of the packed table, in texels of four words: the item table's rows, the records', the profiles' and the atlas rectangles'. */
export const OBJECT_SHADOW_PACKED_WIDTH = 4096

/**
 * The rows of one layer of the packed table, which is a 2D array texture: a row of the table numbered past them lies in the next layer (layer `row / OBJECT_SHADOW_PACKED_LAYER_ROWS`,
 * line `row % OBJECT_SHADOW_PACKED_LAYER_ROWS`), so the table has no bound of its own short of the device's layers, however many items, records and rectangles a frame holds. Within the 8192 every device
 * grants a texture side.
 */
export const OBJECT_SHADOW_PACKED_LAYER_ROWS = 4096

/**
 * The rows the folded read keeps before the item table: its first texel holds four words, the table's row the profiles' bytes start at, a profile's side in texels, the half floats a row of it spans
 * in the copy (its bytes aligned to a row of 256 bytes) and the profiles held (0: none, every light is unchanged); the region follows the records, before the atlas rectangles
 * (which change with every image), and moves with them, so a fragment finds it without a uniform of the blends' view; the folded read's other texel numbers count from this row. The `'foldedDepth'`
 * read adds a second texel to the row: the row the sorted translucency's depth starts at, the width of the depth (laid row after row, a texel holding four of its values) and its height; the row is 0 where none is held.
 */
export const OBJECT_SHADOW_HEADER_ROWS = 1

/**
 * Where the blends read their object's shadow, in group 0 past the rectangle lights' pictures (`BLEND_RECT_BINDINGS`): the subjects' atlas (a 2D array
 * texture, bound by the native read alone) and the packed table, read by both stages (`rgba32uint`, `OBJECT_SHADOW_PACKED_WIDTH` texels a row, `OBJECT_SHADOW_PACKED_LAYER_ROWS` rows a layer of a 2D array): from its first
 * row the table naming each item's record (a word an item), then the records (`OBJECT_SHADOW_RECORD_TEXELS` texels each, the words of a float stored
 * as its bits), then, in the folded read, the profiles' atlas, then, in the `'foldedDepth'` read, the sorted translucency's depth, then, in the packed read, the atlas rectangles (laid in shelves, several side by side across a row; a texel is two half-float texels of one layer; a rectangle wider than
 * two rows of texels is cut into blocks of `2 * OBJECT_SHADOW_PACKED_WIDTH` texels, the blocks one after the other, each of its two layers one above the other). They are in the layouts of a session whose project
 * switch `translucentObjectShadows` is on only.
 */
export const BLEND_OBJECT_SHADOW_BINDINGS = { atlas: 53, packed: 55 } as const

/** The words of one record (`SelfShadow` in `objectShadowSelfWgsl.ts`): the world-to-clip matrix of the subject's light frame, the rectangle's mapping, its interior, the depth term,
 *  the light's direction and fade, the material's scales and extinction, then the places (layer, light, corner) and the copy's (first row, first texel across, width, height). */
export const OBJECT_SHADOW_RECORD_WORDS = 48

/** A record's texels of the packed table. */
export const OBJECT_SHADOW_RECORD_TEXELS = OBJECT_SHADOW_RECORD_WORDS / 4
