import { DEPTH_NEAR } from '../../camera/depthConvention.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { maskKeepWgsl } from '../shader/pageWgsl.ts'
import { maskAlphaWgsl } from '../../materials/virtual/wgsl.ts'
import { RASTER_TRI_WGSL } from './triWgsl.ts'
import { VIS_UNIFORMS_WGSL } from '../shader/pageWgsl.ts'
import { FLAG_MASK } from '../types.ts'
import { visTriangle } from '../visWords.ts'
import { MODE_ID } from './contract.ts'

/** The pixels of the frame the raster writes: the work buffer holds their depths, then their
 *  identifiers one frame further. */
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
 * THE VISIBILITY WRITE, the one rule both rasters write a pixel by — the software raster's
 * threads (`RASTER_PIXEL_WGSL`) and the hardware raster's fragments (`../shader/visWgsl.ts`) —
 * into the one `work` buffer: per pixel a depth key, then one image further an identifier
 * `(row+1)<<8 | triangle`, zero the background.
 *
 * **The rule** is a sixty-four-bit maximum of `(depth, identifier)`: the nearest depth wins, and
 * between fragments at exactly that depth, the greatest identifier. WebGPU has no sixty-four-bit
 * atomic, so the same maximum is taken in two phases, each with one 32-bit atomic:
 *
 * 1. the depth phase keeps the greatest key by `atomicMax` — for a depth in [0, 1] the IEEE-754
 *    bits grow with the value, and the engine's depth is reversed (1 at the near plane, 0 at
 *    infinity), so the greatest key is the nearest. That is the first word of the maximum;
 * 2. once every fragment's depth is down, the identifier phase writes, for each fragment whose key
 *    is EXACTLY the pixel's, its identifier by `atomicMax`: the greatest among the nearest, the
 *    second word of the same maximum.
 *
 * `max` is commutative and associative: the pixel holds the maximum of the pairs, whatever the
 * thread, dispatch, raster or pass order — the very word a sixty-four-bit maximum would hold.
 * Each phase first reads the pixel (`visPasses`) and skips a fragment that cannot change it — a
 * key not nearer than the one held, or not the final one — before its cutout is read: an
 * early-out, the maximum unchanged.
 *
 * The key is the depth saturated to [0, 1], as the write clamps it, then raised by the row's
 * coplanar layer units (`page.depthBias`): ADDING units in reversed depth brings it closer by
 * exactly that many last bits, capped at the near plane's bits. Zero on layer 0.
 */
export const VIS_WRITE_WGSL = wgslBlock(
  'VIS_WRITE_WGSL',
  [pixelCount],
  `
/** The depth key of a fragment at device depth \`depth\` of a row raised by \`bias\` units. */
fn visKey(depth:f32,bias:u32)->u32{return min(bitcast<u32>(${wgslF32(DEPTH_NEAR)}),bitcast<u32>(saturate(depth))+bias);}
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

/**
 * What a software-rastered pixel receives (`RASTER_TRI_WGSL`'s setup): covered when none of its
 * three edge constants is negative, at the depth of the triangle's plane there; a masked row's
 * cutout read at the perspective-correct weights — the edge constants by the corners' `1/w`,
 * normalised —, its footprint the weights' screen steps. The pixel then takes the visibility write
 * of the mode (`VIS_WRITE_WGSL`).
 */
export const RASTER_PIXEL_WGSL = wgslBlock(
  'RASTER_PIXEL_WGSL',
  [RASTER_TRI_WGSL, maskKeepWgsl(maskAlphaWgsl(false)), VIS_WRITE_WGSL, pixelOffset, visTriangle],
  `
fn rasterPixel(t:Tri,pixel:vec2i,mode:u32){
 // The only frame bound of the whole raster: thread tiles overshoot the triangle box as soon as
 // it is not a round count, and the box is already clamped to the last pixel of the frame.
 // Without this bound, a triangle at the right or bottom edge wraps its writes onto the next
 // row, even out of the identifier plane, where they overwrite the triangle-list header.
 if(pixel.x>t.maxPixel.x||pixel.y>t.maxPixel.y){return;}
 let c=edgesAt(t,pixel);
 if(min(c.x,min(c.y,c.z))<0.0){return;}
 let page=pages[t.row];
 let key=visKey(t.depth.x+t.depth.y*c.y+t.depth.z*c.z,page.depthBias);
 let offset=pixelOffset(vec2u(pixel));
 let ids=mode==${MODE_ID}u;
 if(!visPasses(offset,key,ids)){return;}
 if((page.flags&${FLAG_MASK}u)!=0u){
  let w=c*t.invW;let uvw=w*(1.0/(w.x+w.y+w.z));
  let tc=t.ua*uvw.x+t.ub*uvw.y+t.uc*uvw.z;
  let ddx=(t.ua*t.dx.x+t.ub*t.dx.y+t.uc*t.dx.z).xy;
  let ddy=(t.ua*t.dy.x+t.ub*t.dy.y+t.uc*t.dy.z).xy;
  if(!maskKeep(page,tc.xy,tc.z,ddx,ddy)){return;}
 }
 visWrite(offset,key,page.packedBase|visTriangle(t.triangle),ids);
}
`,
)
