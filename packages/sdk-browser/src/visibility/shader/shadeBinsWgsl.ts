import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { MATERIAL_CLASS_KEYS, MATERIAL_CLASS_WGSL } from './materialClass.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'
import { recordTextureWgsl, type RecordBinding } from '../../gpu/core/recordTextureWgsl.ts'
import type { RecordLayout } from '../../gpu/core/recordLayout.ts'

/**
 * THE SHADING BINS: every pixel of the visibility buffer sorted by the material class that shades
 * it, then one indirect dispatch a class over its pixels alone (`shadeEntryWgsl.ts`) — no pixel is
 * visited by a class it is not of, whatever the classes' count or where their borders run. The
 * kernels that build them are `shadeBinKernelsWgsl.ts`; this is the layout they and the classes
 * share.
 *
 * A bin holds ELEMENTS, of one of the reference's two binning modes, as its class word says
 * (`SHADE_BIN_QUAD`): a pixel of a class whose shading reads no derivative of a neighbour is binned
 * alone, one of a class whose shading does, with its quad of 2 × 2. Every class of ours takes its
 * gradients from its own triangle (`uvGradients`), so its bin holds quads only where the
 * `shadeBinningMode` setting asks them (`../../materials/classes/shadeBins.ts`). A pixel element is
 * one word: `x` in the low `SHADE_BIN_PIXEL_BITS` bits, `y` above, its write mask above both — one,
 * the pixel itself. A quad element is two: its top-left pixel so, then a nibble a pixel of the quad
 * in the quad's order (top-left, top-right, bottom-left, bottom-right), one where that pixel is the
 * bin's.
 *
 * Two record tables hold them (`r32uint` words read by `textureLoad`, whatever the image's size):
 * the head (`SHADE_BINS_TABLE`) — the class word of each class key, then each bin's element count,
 * first word and mode, then the layers the classes store the surfaces in (`SHADE_BIN_LAYERS`) —,
 * and the elements (`SHADE_BIN_ELEMENTS_TABLE`), a run of words a bin.
 */
/** Lanes of a binning workgroup and of a class's shading workgroup: a group shades this many lanes. */
export const SHADE_BIN_GROUP = 64
/** Pixels a side of a binning workgroup's tile: 8 × 8 quads, one a lane (`shadeBinKernelsWgsl.ts`). */
export const SHADE_BIN_TILE = 16
/** Bits of each coordinate in an element's word: images up to 16384 pixels a side. */
const SHADE_BIN_PIXEL_BITS = 14
/** The first bit of a pixel element's write mask, above its two coordinates. */
const SHADE_BIN_MASK_SHIFT = 2 * SHADE_BIN_PIXEL_BITS
/** The flag of a class word whose bin holds quads; the word's other bits are its bin. */
export const SHADE_BIN_QUAD = 0x80000000
/** The class word of a key the image holds no pixel of, as the host writes it. */
export const SHADE_BIN_NONE = 0xffffffff
/** Word of the first bin's element count, past the class word of every class key. */
export const SHADE_BIN_META = MATERIAL_CLASS_KEYS
/** Words of a bin in the head: its element count, its first word among the elements, its mode —
 *  one for quads, which the host writes. */
export const SHADE_BIN_META_WORDS = 3
/** Word of the surfaces' layers (`SurfaceBuffer.layers`), past every bin's. */
export const SHADE_BIN_LAYERS = SHADE_BIN_META + SHADE_BIN_META_WORDS * MATERIAL_CLASS_KEYS
/** Words of the head. */
export const SHADE_BIN_HEAD_WORDS = SHADE_BIN_LAYERS + 1
/** Words of a bin's indirect dispatch: its workgroups in x, in y, in z. */
export const SHADE_BIN_ARGS = 3
/** Words of a quad element, and the lanes of a bin of quads a quad takes: a quad's four pixels. */
const SHADE_BIN_QUAD_WORDS = 2
const SHADE_BIN_QUAD_LANES = 4

/** A table of words: one word a record, 4096 a row, 8192 rows a layer. */
const wordTable = (label: string): RecordLayout => ({
  label,
  format: 'r32uint',
  fields: { Word: 1 },
  rowShift: 12,
  layerShift: 13,
})
/** The bins' head, made once. */
export const SHADE_BINS_TABLE = wordTable('Trillion3D shading bins')
/** The bins' elements, grown with the image: a word a pixel, two a quad. */
export const SHADE_BIN_ELEMENTS_TABLE = wordTable('Trillion3D shading bin elements')

const SHADE_BINS_CONSTANTS_WGSL = wgslBlock(
  'SHADE_BINS_CONSTANTS_WGSL',
  [],
  wgslConsts({
    SHADE_BIN_GROUP,
    SHADE_BIN_TILE,
    SHADE_BIN_PIXEL_BITS,
    SHADE_BIN_MASK_SHIFT,
    SHADE_BIN_QUAD,
    SHADE_BIN_NONE,
    SHADE_BIN_META,
    SHADE_BIN_META_WORDS,
    SHADE_BIN_LAYERS,
    SHADE_BIN_ARGS,
    SHADE_BIN_QUAD_WORDS,
    SHADE_BIN_QUAD_LANES,
  }),
)

/**
 * The bins' head bound at `at` (`binsWord`, `binsWordStore` where it writes it), and its reads: the
 * class word of a class key (`binOfClass`), a bin's element count and first word (`binRange`). The
 * one layout of the head, for the kernels that write it and the classes that read it.
 */
export const shadeBinsWgsl = (at: Omit<RecordBinding, 'name'>) =>
  wgslBlock(
    `shadeBinsWgsl(${at.group}, ${at.binding}, ${at.access})`,
    [SHADE_BINS_CONSTANTS_WGSL, recordTextureWgsl(SHADE_BINS_TABLE, { name: 'bins', ...at })],
    `fn binOfClass(key:u32)->u32{return binsWord(key,0u).x;}
/** Bin \`bin\`'s element count, then the place of its first word among the elements. */
fn binRange(bin:u32)->vec2u{let m=SHADE_BIN_META+SHADE_BIN_META_WORDS*bin;return vec2u(binsWord(m,0u).x,binsWord(m+1u,0u).x);}`,
  )

/** The bins' elements bound at `at` (`elementsWord`, `elementsWordStore` where it writes them), and
 *  an element's first word packed — a pixel, its write mask — and unpacked. */
export const shadeBinElementsWgsl = (at: Omit<RecordBinding, 'name'>) =>
  wgslBlock(
    `shadeBinElementsWgsl(${at.group}, ${at.binding}, ${at.access})`,
    [
      SHADE_BINS_CONSTANTS_WGSL,
      recordTextureWgsl(SHADE_BIN_ELEMENTS_TABLE, { name: 'elements', ...at }),
    ],
    `fn packBinPixel(at:vec2u,mask:u32)->u32{return at.x|(at.y<<SHADE_BIN_PIXEL_BITS)|(mask<<SHADE_BIN_MASK_SHIFT);}
fn unpackBinPixel(word:u32)->vec2u{let side=(1u<<SHADE_BIN_PIXEL_BITS)-1u;return vec2u(word&side,(word>>SHADE_BIN_PIXEL_BITS)&side);}`,
  )

/**
 * A class's elements, as its shading reads them (`shadeEntryWgsl.ts`): the head at group 1, binding
 * `binding`, the elements at the next, read by load. `binnedPixel` is the pixel lane `lane` of
 * workgroup `group` of the class's dispatch shades, and its write mask: a pixel element is a lane —
 * `group · SHADE_BIN_GROUP + lane`, the workgroups in rows —, a quad four lanes in a row, one a pixel
 * of the quad with its own nibble of the mask; `SHADE_BIN_NONE` in every lane past the bin's last.
 * `shadesPixel` is whether a lane has a pixel to shade: none past the end, none where its quad's
 * pixel is another class's — no lane reads a neighbour's derivatives, so a lane that writes nothing
 * has nothing to give its quad.
 */
export const shadeBinReadWgsl = (binding: number) =>
  wgslBlock(
    `shadeBinReadWgsl(${binding})`,
    [
      shadeBinsWgsl({ group: 1, binding, access: 'read' }),
      shadeBinElementsWgsl({ group: 1, binding: binding + 1, access: 'read' }),
      MATERIAL_CLASS_WGSL,
      FLAT_INDEX_WGSL,
    ],
    `fn binnedPixel(group:vec3u,n:vec3u,lane:u32)->vec3u{
 let word=binOfClass(CLASS_KEY);
 let quad=(word&SHADE_BIN_QUAD)!=0u;
 let range=binRange(word&~SHADE_BIN_QUAD);
 let index=flatIndex(group,n,1u)*SHADE_BIN_GROUP+lane;
 let element=select(index,index/SHADE_BIN_QUAD_LANES,quad);
 if(element>=range.x){return vec3u(SHADE_BIN_NONE);}
 if(quad){
  let at=range.y+SHADE_BIN_QUAD_WORDS*element;
  let corner=index&3u;
  let mask=(elementsWord(at+1u,0u).x>>(4u*corner))&15u;
  return vec3u(unpackBinPixel(elementsWord(at,0u).x)+vec2u(corner&1u,corner>>1u),mask);
 }
 let pixel=elementsWord(range.y+element,0u).x;
 return vec3u(unpackBinPixel(pixel),pixel>>SHADE_BIN_MASK_SHIFT);
}
fn shadesPixel(at:vec3u)->bool{return at.x!=SHADE_BIN_NONE&&at.z!=0u;}`,
  )
