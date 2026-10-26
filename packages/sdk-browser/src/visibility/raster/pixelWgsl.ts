import { DEPTH_NEAR } from '../../camera/depthConvention.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { maskKeepWgsl } from '../shader/pageWgsl.ts'
import {
  NO_MASKS,
  maskKnowsPixel,
  maskMovesDepth,
  masksKey,
  type MaskSet,
} from '../../materials/graph/maskProgram.ts'
import { maskAlphaWgsl } from '../../materials/virtual/wgsl.ts'
import { RASTER_TRI_WGSL } from './triWgsl.ts'
import { VIS_UNIFORMS_WGSL } from '../shader/pageWgsl.ts'
import { FLAG_DEPTH_OFFSET, FLAG_MASK } from '../types.ts'
import { visTriangle } from '../visWords.ts'
import { MODE_ID } from './contract.ts'
import { WIDE_ATOMIC_WGSL } from '../../gpu/core/wideAtomics.ts'

/** The pixels of the frame the raster writes: the work buffer holds their depths, then their
 *  identifiers one frame further — or, with the 64-bit word, their pairs. */
export const pixelCount = wgslFn(
  'pixelCount',
  [VIS_UNIFORMS_WGSL],
  'fn pixelCount()->u32{return u32(uni.viewport.x)*u32(uni.viewport.y);}',
)

/** Pixel `p`'s row-major rank in either half of the work buffer. */
export const pixelOffset = wgslFn(
  'pixelOffset',
  [VIS_UNIFORMS_WGSL],
  'fn pixelOffset(p:vec2u)->u32{return p.y*u32(uni.viewport.x)+p.x;}',
)

/**
 * The depth key of a fragment: the depth saturated to [0, 1], as the write clamps it, then raised
 * by the row's coplanar layer units (`page.depthBias`): ADDING units in reversed depth brings it
 * closer by exactly that many last bits, capped at the near plane's bits. Zero on layer 0. For a
 * depth in [0, 1] the IEEE-754 bits grow with the value, and the engine's depth is reversed (1 at
 * the near plane, 0 at infinity), so the greatest key is the nearest.
 */
export const VIS_KEY_WGSL = wgslBlock(
  'VIS_KEY_WGSL',
  [],
  `
/** The depth key of a fragment at device depth \`depth\` of a row raised by \`bias\` units. */
fn visKey(depth:f32,bias:u32)->u32{return min(bitcast<u32>(${wgslF32(DEPTH_NEAR)}),bitcast<u32>(saturate(depth))+bias);}`,
)

/**
 * The device depth of a pixel the surface's `pixelDepthOffset` moves (`maskGraphWgsl.ts`,
 * `depthOffsetValue`), the reference's way along the camera vector: \`depth\` is the plane's at the
 * pixel, \`w\` its clip w, \`offset\` the output (in the world's units, only a push away counts), and
 * \`pixel\` the pixel's centre. The offset is counted along the view axis — the output times the
 * cosine of the pixel's ray with it — and added to the view depth, the depth of the reversed
 * projection (\`z / w\` over the new w) staying what it was where that would bring it nearer. An
 * orthographic view's depth is affine in the distance: the offset over the span the depth runs over
 * (\`depthSpan\`) is taken off.
 */
export const OFFSET_DEPTH_WGSL = wgslBlock(
  'OFFSET_DEPTH_WGSL',
  [VIS_UNIFORMS_WGSL],
  `
fn offsetDepth(depth:f32,w:f32,offset:f32,pixel:vec2f)->f32{
 if(uni.depthSpan>0.0){return min(depth-max(offset,0.0)/uni.depthSpan,depth);}
 let ray=(pixel/uni.viewport*2.0-vec2f(1.0))/max(abs(uni.focal),vec2f(1.0e-6));
 let along=max(offset,0.0)*inverseSqrt(1.0+dot(ray,ray));
 return min(depth*w/(w+along),depth);
}`,
)

/**
 * THE VISIBILITY WRITE, the one rule the software raster's threads (`RASTER_PIXEL_WGSL`), the
 * tessellation's micro-triangles and the hardware raster's fragments (`../shader/visWgsl.ts`)
 * write a pixel by into the one `work` buffer, zero the background: the identifier
 * `(row+1)<<8 | triangle` of the nearest depth key (`VIS_KEY_WGSL`), and between fragments at
 * exactly that depth the greatest identifier — a sixty-four-bit maximum of `(depth, identifier)`,
 * the depth in the high word.
 *
 * **With the 64-bit atomic maximum** (`wide`, the device feature `atomic-vec2u-min-max`,
 * `../../gpu/core/wideAtomics.ts`) the pixel is one `atomic<vec2<u32>>`, the identifier its first
 * component and the depth key its second, and a fragment is written once, by `atomicStoreMax`: the
 * maximum of the pairs, whatever the thread, dispatch, raster or pass order. The word cannot be
 * read before it is written (the type has no load), so no fragment leaves early (`visPasses`).
 *
 * **Without it** the same maximum is taken in two phases, each with one 32-bit atomic over two
 * planes — the depth keys, then one image further the identifiers —, the mode of the software raster
 * that runs it (`MODE_DEPTH`, `MODE_ID`):
 *
 * 1. the depth phase keeps the greatest key by `atomicMax`, the first word of the maximum;
 * 2. once every fragment's depth is down, the identifier phase writes, for each fragment whose key
 *    is EXACTLY the pixel's, its identifier by `atomicMax`: the greatest among the nearest, the
 *    second word of the same maximum.
 *
 * Each phase first reads the pixel (`visPasses`) and skips a fragment that cannot change it — a
 * key not nearer than the one held, or not the final one — before its cutout is read: an
 * early-out, the maximum unchanged. The hardware raster does not write these planes there: it
 * draws once, with the hardware depth test, and the export merges both (`exportWgsl.ts`).
 */
const VIS_WRITE_WIDE = wgslBlock(
  'VIS_WRITE_WGSL(wide)',
  [VIS_KEY_WGSL, WIDE_ATOMIC_WGSL],
  `
/** A word is written whole and cannot be read: no fragment can leave before its cutout. */
fn visPasses(offset:u32,key:u32,ids:bool)->bool{return true;}
/** The fragment's pair, taken into the pixel's word by the 64-bit maximum. */
fn visWrite(offset:u32,key:u32,id:u32,ids:bool){atomicStoreMax(&work[offset],vec2u(id,key));}`,
)
const VIS_WRITE_SPLIT = wgslBlock(
  'VIS_WRITE_WGSL(split)',
  [VIS_KEY_WGSL, pixelCount],
  `
/** Whether a fragment of key \`key\` at pixel \`offset\` can still change it: nearer than the key
 *  held in the depth phase, the final key itself in the identifier phase (\`ids\`). */
fn visPasses(offset:u32,key:u32,ids:bool)->bool{
 let held=atomicLoad(&work[offset]);
 if(ids){return held==key;}
 return held<key;
}
/** The fragment's word of the phase: its key, or its identifier \`id\` (\`ids\`). */
fn visWrite(offset:u32,key:u32,id:u32,ids:bool){
 if(ids){atomicMax(&work[pixelCount()+offset],id);}
 else{atomicMax(&work[offset],key);}
}`,
)
/** The visibility write of a device with the 64-bit word (`wide`) or without it (above). Its
 *  host declares `work` as `array<atomic<vec2<u32>>>` or `array<atomic<u32>>` accordingly. */
export const visWriteWgsl = (wide: boolean) => (wide ? VIS_WRITE_WIDE : VIS_WRITE_SPLIT)

/** The declaration of the visibility buffer `work` a host of `visWriteWgsl(wide)` writes, bound at
 *  `binding` of group `group`. */
export const visWorkDeclaration = (wide: boolean, binding: number, group = 0) =>
  `@group(${group}) @binding(${binding}) var<storage,read_write> work:array<atomic<${
    wide ? 'vec2<u32>' : 'u32'
  }>>;`

/**
 * What a software-rastered pixel receives (`RASTER_TRI_WGSL`'s setup, `clusterWgsl.ts`'s loops):
 * covered when none of its three edge constants `c` is negative, at the depth of the triangle's
 * plane there; a masked row's cutout read at the perspective-correct weights — the edge constants
 * by the corners' `1/w`, normalised —, its footprint the weights' screen steps. The pixel then
 * takes the visibility write of the mode (`visWriteWgsl`). With `masks`, a surface that wears a
 * graph is cut by the graph's mask at the pixel's centre (`maskKeepAt`,
 * `../shader/maskGraphWgsl.ts`), dithered where the surface asks; a row whose surface wires a
 * `pixelDepthOffset` (`FLAG_DEPTH_OFFSET`) writes the depth that output moves its pixel to
 * (`offsetDepth`), its early-out taken once the output is read.
 */
export const rasterPixelWgsl = (masks: MaskSet = NO_MASKS, wide = false) => {
  const pixel = maskKnowsPixel(masks)
  const moves = maskMovesDepth(masks)
  const key = [wide ? 'wide' : 'split', pixel ? masksKey(masks) : '', moves ? 'depth' : '']
    .filter(Boolean)
    .join(', ')
  return wgslBlock(
    `RASTER_PIXEL_WGSL(${key})`,
    [
      RASTER_TRI_WGSL,
      maskKeepWgsl(maskAlphaWgsl(false), masks),
      visWriteWgsl(wide),
      pixelOffset,
      visTriangle,
      ...(moves ? [OFFSET_DEPTH_WGSL] : []),
    ],
    rasterPixelText(
      pixel
        ? 'maskKeepAt(page,tc.xy,tc.z,ddx,ddy,vec2f(pixel)+vec2f(0.5))'
        : 'maskKeep(page,tc.xy,tc.z,ddx,ddy)',
      moves,
    ),
  )
}

/** The pixel stage with the test `keep` of a masked row; with `moves`, the depth a row's
 *  `pixelDepthOffset` moves the pixel to, in place of the plane's. */
const rasterPixelText = (keep: string, moves: boolean) => `
fn writePixel(t:Tri,pixel:vec2i,c:vec3f,mode:u32){
 // The only frame bound of the whole raster: the box is already clamped to the last pixel of the
 // frame, and a scanline's last pixel is held to it. Without this bound, a triangle at the right
 // or bottom edge would wrap its writes onto the next row.
 if(pixel.x>t.maxPixel.x||pixel.y>t.maxPixel.y){return;}
 let page=pages[t.row];
 let plane=t.depth.x+t.depth.y*c.y+t.depth.z*c.z;
 var key=visKey(plane,page.depthBias);
 let offset=pixelOffset(vec2u(pixel));
 let ids=mode==${MODE_ID}u;
${moves ? ` let moved=(page.flags&${FLAG_DEPTH_OFFSET}u)!=0u;\n` : ''} if(${moves ? '!moved&&' : ''}!visPasses(offset,key,ids)){return;}
 if((page.flags&${FLAG_MASK}u)!=0u){
  let cut=triCutout(t,c);
  let tc=cut.at;let ddx=cut.ddx;let ddy=cut.ddy;
  if(!${keep}){return;}
${
  moves
    ? `  if(moved){
   // Its clip w at the pixel: \`1/w\` is linear on the screen, at the corners' weights.
   let w=(c.x+c.y+c.z)/dot(c,t.invW);
   let push=depthOffsetValue(materialAt(page.material),tc.xy,ddx,ddy);
   key=visKey(offsetDepth(plane,w,push,vec2f(pixel)+vec2f(0.5)),page.depthBias);
  }
`
    : ''
} }
${moves ? ' if(moved&&!visPasses(offset,key,ids)){return;}\n' : ''} visWrite(offset,key,page.packedBase|visTriangle(t.triangle),ids);
}
`
