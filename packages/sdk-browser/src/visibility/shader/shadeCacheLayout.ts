import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { bitMask, bitWord, byteOf } from '../../../../math/src/wgsl/integer.ts'
import { InvT3, invTranspose3Prep } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { windingKept, worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { PIXEL_TRIANGLE_WGSL } from './pixelTriangleWgsl.ts'

/**
 * THE RESOLVE'S FRAME CACHE (`shadeCache`): what many pixels compute alike, computed once
 * a frame by compute passes before the class draws (`../../webgpu/visibility/shadeCache.ts`) and
 * read back word for word by the resolve (`shadeWgsl.ts`). Each pass calls the very function the
 * pixel calls without it, on the same inputs, and a float travels as its bits: what a pixel reads
 * is what it would have computed. Each pass's work follows what the image reads, never the
 * table's size.
 *
 * - A row's frame: the inverse transpose of its world's 3×3 (`invTranspose3Prep`: a
 *   normalisation, nine divisions, three cross products) and the side of its determinant, for a
 *   row a pixel reads — a mark in either plane. A row no pixel reads keeps words nothing reads.
 * - A triangle: `decodeTriangle` — the page's header, corners, positions, normals and texture
 *   coordinates decoded, the world and camera products, the framebuffer and perspective
 *   divisions —, forty-two words, for each triangle two pixels or more of the visibility buffer
 *   read. One pixel alone gains nothing from a decode it would pay once either way, and keeps
 *   its own.
 *
 * The marks pass reads the visibility buffer by 8×8 tiles: a pixel whose left or upper neighbour
 * in its tile holds its triangle proves it read twice and sets plane B; a pixel that starts a run
 * met nowhere above sets plane A, and plane B when A already held the triangle. B is set exactly
 * for the triangles read by two pixels or more; past their first pixels, a triangle's pixels read B and write nothing. The rows pass
 * then composes the frames, counts each row's B triangles, takes their slots with one atomic add
 * on the cursor, and keeps where each B word's triangles start (a byte each: at most 224
 * triangles precede the last word); a row past the capacity clears its B words, and its pixels
 * decode, as without the cache. A row that fits writes each slot's triangle — its row and index —
 * in the slot's first word, raises the end of the fitting slots and the triangles pass's dispatch
 * (`openSlice`); the slots fill from zero in the cursor's order, so the rows that fit hold every
 * slot below that end. The triangles pass then decodes one triangle per lane, over those slots
 * alone, and stores it over its first word. A pixel's slot is its row's first slot, the count
 * before its word, and the B bits below its own (`cachedSlot`).
 *
 * Words: the header — the triangle cursor, the rows the sections are laid for, the triangle
 * capacity, both written by the host each frame, the end of the fitting slots —, a record per row
 * (its frame, its first slot, its two prefix words), the marks — planes A then B, 8 words each,
 * the 256 triangles a visibility identifier addresses —, then the triangles. A row at or past the
 * header's count is composed and decoded by its pixels.
 */
const SHADE_CACHE_CURSOR_WORD = 0
export const SHADE_CACHE_ROWS_WORD = 1
export const SHADE_CACHE_CAPACITY_WORD = 2
const SHADE_CACHE_END_WORD = 3
export const SHADE_CACHE_HEADER_WORDS = SHADE_CACHE_END_WORD + 1
/** A row's frame as `storeRowFrame` writes it: the adjugate's nine words, its scale, whether it is
 *  regular, the side of the determinant. Its first slot follows, then its two prefix words. */
const ROW_FRAME_WORDS = 12
export const ROW_RECORD_WORDS = 16
export const ROW_MARK_WORDS = 16
export const TRIANGLE_WORDS = 42
/** Triangles a visibility identifier addresses in a row: its low byte. */
export const ROW_TRIANGLES = 256
/** The marks pass's tile side. */
export const MARK_TILE = 8

/** The cache's words as its WGSL names them, and where a row's marks and the triangles start. */
const LAYOUT_WGSL = wgslBlock(
  'LAYOUT_WGSL',
  [NO_INDEX],
  `${wgslConsts({
    SHADE_CACHE_CURSOR: SHADE_CACHE_CURSOR_WORD,
    SHADE_CACHE_ROWS: SHADE_CACHE_ROWS_WORD,
    SHADE_CACHE_CAPACITY: SHADE_CACHE_CAPACITY_WORD,
    SHADE_CACHE_END: SHADE_CACHE_END_WORD,
    ROW_RECORDS: SHADE_CACHE_HEADER_WORDS,
    ROW_RECORD_WORDS,
    ROW_BASE: ROW_FRAME_WORDS,
    ROW_PREFIX: ROW_FRAME_WORDS + 1,
    ROW_MARK_WORDS,
    PLANE_WORDS: ROW_MARK_WORDS / 2,
    TRIANGLE_WORDS,
  })}
/** Plane A of row \`row\`'s marks, of \`rows\` laid; plane B follows it. */
fn rowMarks(rows:u32,row:u32)->u32{return ROW_RECORDS+rows*ROW_RECORD_WORDS+row*ROW_MARK_WORDS;}
/** The first word of the triangles, of \`rows\` laid. */
fn cachedTriangles(rows:u32)->u32{return ROW_RECORDS+rows*(ROW_RECORD_WORDS+ROW_MARK_WORDS);}
/** The passes ran this frame: the pixels read what they stored. */
override SHADE_CACHE:bool=false;`,
)

/** A row's frame and its composition, the one text the passes and the resolve compile. */
export const ROW_FRAME_WGSL = wgslBlock(
  'ROW_FRAME_WGSL',
  [InvT3, invTranspose3Prep, worldMatrix3, windingKept, LAYOUT_WGSL],
  `/** The normal matrix of a row and the side of its world's determinant (\`matrixWindingCw\`). */
struct RowFrame{invT:InvT3,positive:bool,}
fn composeRowFrame(world:mat4x4f)->RowFrame{
 let world3=worldMatrix3(world);
 return RowFrame(invTranspose3Prep(world3),windingKept(world3));
}`,
)

/** Reads of the cache as plain words — the resolve's, and the triangles pass's. */
export const CACHE_READ_WGSL = wgslBlock(
  'CACHE_READ_WGSL',
  [ROW_FRAME_WGSL, bitWord, bitMask, byteOf],
  `
fn cacheVec2(at:u32)->vec2f{return bitcast<vec2f>(vec2u(shadeCache[at],shadeCache[at+1u]));}
fn cacheVec3(at:u32)->vec3f{return bitcast<vec3f>(vec3u(shadeCache[at],shadeCache[at+1u],shadeCache[at+2u]));}
fn cacheVec4(at:u32)->vec4f{return bitcast<vec4f>(vec4u(shadeCache[at],shadeCache[at+1u],shadeCache[at+2u],shadeCache[at+3u]));}
/** Row \`row\`'s frame: as the rows pass stored it, or composed here from \`world\`. */
fn rowFrame(row:u32,world:mat4x4f)->RowFrame{
 if(!SHADE_CACHE||row>=shadeCache[SHADE_CACHE_ROWS]){return composeRowFrame(world);}
 let at=ROW_RECORDS+row*ROW_RECORD_WORDS;
 let adj=mat3x3f(cacheVec3(at),cacheVec3(at+3u),cacheVec3(at+6u));
 return RowFrame(InvT3(adj,bitcast<f32>(shadeCache[at+9u]),shadeCache[at+10u]!=0u),shadeCache[at+11u]!=0u);
}
/** The slot of triangle \`tri\` of row \`row\`, \`NO_INDEX\` for one the cache does not hold. */
fn cachedSlot(row:u32,tri:u32)->u32{
 let rows=shadeCache[SHADE_CACHE_ROWS];
 if(!SHADE_CACHE||row>=rows){return NO_INDEX;}
 let word=shadeCache[rowMarks(rows,row)+PLANE_WORDS+bitWord(tri)];
 let bit=bitMask(tri);
 if((word&bit)==0u){return NO_INDEX;}
 let record=ROW_RECORDS+row*ROW_RECORD_WORDS;
 let before=byteOf(shadeCache[record+ROW_PREFIX+(tri>>7u)],bitWord(tri)&3u);
 return shadeCache[record+ROW_BASE]+before+countOneBits(word&(bit-1u));
}`,
)

/**
 * The resolve's read: its binding, read-only, the frames and `pixelTriangle`. The overrides are set
 * by the pipelines when the passes run this frame (`shadeCacheConstants`); left false, a pixel
 * composes and decodes its own.
 */
export const shadeCacheReadWgsl = (binding: number) =>
  wgslBlock(
    `shadeCacheReadWgsl(${binding})`,
    [CACHE_READ_WGSL, PIXEL_TRIANGLE_WGSL],
    `
@group(0) @binding(${binding}) var<storage, read> shadeCache:array<u32>;
/** The triangle a pixel of row \`row\` shades: as the triangles pass stored it, or decoded here. */
fn pixelTriangle(row:u32,page:PageInfo,tri:u32)->PixelTriangle{
 let slot=cachedSlot(row,tri);
 if(slot==NO_INDEX){return decodeTriangle(page,tri,rowFrame(row,page.world).invT);}
 let at=cachedTriangles(shadeCache[SHADE_CACHE_ROWS])+slot*TRIANGLE_WORDS;
 return PixelTriangle(cacheVec4(at),cacheVec4(at+4u),cacheVec4(at+8u),cacheVec4(at+12u),cacheVec4(at+16u),cacheVec4(at+20u),
  cacheVec3(at+24u),cacheVec3(at+27u),cacheVec3(at+30u),cacheVec2(at+33u),cacheVec2(at+35u),cacheVec2(at+37u),cacheVec3(at+39u));
}`,
  )
