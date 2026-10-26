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
 * Two record tables and a buffer hold them (`r32uint` words read by `textureLoad`, whatever the
 * image's size): the head (`SHADE_BINS_TABLE`) — the class word of each class key, then the layers
 * the classes store the surfaces in (`SHADE_BIN_LAYERS`) —, the elements
 * (`SHADE_BIN_ELEMENTS_TABLE`), a run of words a bin, and each bin's meta (`SHADE_BIN_META_WORDS`),
 * one `vec4u` of a read-only storage buffer: a shading dispatch reads its bin in one load.
 *
 * The export of the visibility buffer (`../raster/exportWgsl.ts`) writes each pixel's shading mask
 * once (`packShadingMask`): its bin and the bin's mode, which the bins' kernels read in place of the
 * identifier, the page table and the head.
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
/** Word of the surfaces' layers (`SurfaceBuffer.layers`), past the class word of every class key. */
export const SHADE_BIN_LAYERS = MATERIAL_CLASS_KEYS
/** Words of the head: a class word a class key, then the surfaces' layers. */
export const SHADE_BIN_HEAD_WORDS = SHADE_BIN_LAYERS + 1
/** Words of a bin's meta, one `vec4u`: its element count, its first word among the elements, its
 *  flags (`SHADE_BIN_META_QUADS`), a spare. */
export const SHADE_BIN_META_WORDS = 4
/** The flag of a bin's meta whose elements are quads, which the host writes. */
export const SHADE_BIN_META_QUADS = 1
/** Bits of the bin in a shading mask (`packShadingMask`), at `SHADING_MASK_BIN_SHIFT`: the most
 *  bins an image holds. */
export const SHADING_MASK_BIN_BITS = 14
const SHADING_MASK_BIN_SHIFT = 4
/** A shading mask's bit 0 is set where a pixel has a bin, its bit `SHADING_MASK_QUADS_SHIFT` where
 *  the bin holds quads. */
const SHADING_MASK_QUADS_SHIFT = 18
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
    SHADE_BIN_META_QUADS,
    SHADING_MASK_BIN_BITS,
    SHADING_MASK_BIN_SHIFT,
    SHADING_MASK_QUADS_SHIFT,
    SHADE_BIN_LAYERS,
    SHADE_BIN_ARGS,
    SHADE_BIN_QUAD_WORDS,
    SHADE_BIN_QUAD_LANES,
  }),
)

/**
 * The bins' head bound at `at` (`binsWord`, `binsWordStore` where it writes it), and its read: the
 * class word of a class key (`binOfClass`). The one layout of the head, for the export that packs
 * the shading masks and the classes that read the layers.
 */
export const shadeBinsWgsl = (at: Omit<RecordBinding, 'name'>) =>
  wgslBlock(
    `shadeBinsWgsl(${at.group}, ${at.binding}, ${at.access})`,
    [SHADE_BINS_CONSTANTS_WGSL, recordTextureWgsl(SHADE_BINS_TABLE, { name: 'bins', ...at })],
    `fn binOfClass(key:u32)->u32{return binsWord(key,0u).x;}`,
  )

/**
 * The bins' meta bound at `at` (`binMeta`, one `vec4u` a bin) and `binRange`: bin `bin`'s element
 * count, then the place of its first word among the elements.
 */
export const shadeBinMetaWgsl = (at: {
  group: number
  binding: number
  access: 'read' | 'read_write'
}) =>
  wgslBlock(
    `shadeBinMetaWgsl(${at.group}, ${at.binding}, ${at.access})`,
    [SHADE_BINS_CONSTANTS_WGSL],
    `@group(${at.group}) @binding(${at.binding}) var<storage,${at.access}> binMeta:array<vec4u>;
fn binRange(bin:u32)->vec2u{return binMeta[bin].xy;}`,
  )

/**
 * A pixel's shading mask, the export's word per pixel (`r32uint`): bit 0 set where the pixel
 * has a bin, the bin above it, then the bin's mode. Zero is a pixel with none: the background, a
 * pixel past the image, a class without a bin this image.
 */
export const SHADING_MASK_WGSL = wgslBlock(
  'SHADING_MASK_WGSL',
  [SHADE_BINS_CONSTANTS_WGSL],
  `/** The mask of a pixel of class word \`word\` (\`binOfClass\`, \`SHADE_BIN_NONE\` for none). */
fn packShadingMask(word:u32)->u32{
 if(word==SHADE_BIN_NONE){return 0u;}
 return 1u|((word&~SHADE_BIN_QUAD)<<SHADING_MASK_BIN_SHIFT)|select(0u,1u<<SHADING_MASK_QUADS_SHIFT,(word&SHADE_BIN_QUAD)!=0u);
}
/** The four pixels' masks: which have a bin, which bin, and whether the bin holds quads. */
fn maskPixels(masks:vec4u)->vec4<bool>{return (masks&vec4u(1u))!=vec4u(0u);}
fn maskBinsOf(masks:vec4u)->vec4i{return vec4i((masks>>vec4u(SHADING_MASK_BIN_SHIFT))&vec4u((1u<<SHADING_MASK_BIN_BITS)-1u));}
fn maskQuads(masks:vec4u)->vec4<bool>{return (masks&vec4u(1u<<SHADING_MASK_QUADS_SHIFT))!=vec4u(0u);}`,
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
 * `binding`, the elements at the next, read by load, the meta at the one after. `binnedPixel` is the pixel lane `lane` of
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
      shadeBinMetaWgsl({ group: 1, binding: binding + 2, access: 'read' }),
      MATERIAL_CLASS_WGSL,
      FLAT_INDEX_WGSL,
    ],
    `fn binnedPixel(group:vec3u,n:vec3u,lane:u32)->vec3u{
 let word=binOfClass(CLASS_BIN);
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
