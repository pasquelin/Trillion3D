import {
  SAMPLE_ANISOTROPY_SHIFT,
  SAMPLE_ONE_READ,
  SAMPLE_MAG_NEAREST,
  SAMPLE_MIN_NEAREST,
  SAMPLE_MIP_NEAREST,
} from './sampling.ts'
import { type WgslDecl, wgslBlock, wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { ENTRY_LEVEL_MASK, ENTRY_LEVEL_SHIFT } from './tiles.ts'
import { DIVISOR_FLOOR } from '../../../../math/src/wgsl/constants.ts'

const ANISOTROPY_SLACK = 0.01

/** A texture header of the pools (`materials/virtual/wgsl.ts`): size, first tail level, last level, the
 *  word where its level addresses begin, the tail's placement, the tap of its pool, its filter
 *  word and its addressing nibble (`sampling.ts`). */
export const TILE_SLOT_WGSL = wgslStruct(
  'TileSlot',
  [],
  'struct TileSlot{size:vec2f,tail:u32,last:u32,levels:u32,tailWord:u32,tap:u32,sampling:u32,wrap:u32,bias:f32,}',
)

/** The level of detail of a footprint `px`, `py` in texels — the log of the longer gradient —,
 *  plus `mipBias`, the WGSL expression of the pool's level offset (`tilePoolWgsl`). Its variants
 *  share one name: a program holding two biases is refused when it is written. */
export const atlasLodWgsl = (mipBias: string) =>
  wgslFn(
    'atlasLod',
    [DIVISOR_FLOOR],
    `fn atlasLod(px:vec2f,py:vec2f)->f32{return 0.5*log2(max(max(dot(px,px),dot(py,py)),DIVISOR_FLOOR))+${mipBias};}`,
  )

/** How one sample reads (`TileRead`): the coordinate after the texture's transform, the line
 *  anisotropy spreads its `taps` over, the level, and whether texels are picked rather than mixed;
 *  `tapOffset` places tap `i` of `n` on that line, for the read and for the request alike. */
export const TILE_READ_WGSL = wgslBlock(
  'TILE_READ_WGSL',
  [],
  `struct TileRead{uv:vec2f,axis:vec2f,lod:f32,taps:u32,nearest:bool,}
fn tapOffset(i:u32,n:u32)->f32{return (f32(i)+0.5)/f32(n)-0.5;}
/** The level a table word's tile carries (entryLevel, tiles.ts). */
fn tileEntryLevel(word:u32)->u32{return (word>>${ENTRY_LEVEL_SHIFT}u)&${ENTRY_LEVEL_MASK}u;}
`,
)

/** The noise that moves a pixel's level between the two it straddles when a texture is read with one
 *  read (`SAMPLE_ONE_READ`): the pass that has the pixel sets it (`shadeSurface`); 0.5, the nearest
 *  level, where none does (a raster pass's cutout, a compute that has no pixel). */
export const TILE_NOISE_WGSL = wgslBlock('TILE_NOISE_WGSL', [], 'var<private> tileNoise:f32=0.5;')

/**
 * The footprint, mip selection and bounded anisotropic tap rule of the texture pools. `tileRead`:
 * how a footprint reads a texture with a filter word, its coordinate and derivatives already
 * transformed. The level is the GPU's — the log of the longer gradient —; with `aniso`, the
 * hardware's anisotropic rule: N taps, the elongation rounded up within the grant, at
 * log2(Pmax / N). The residency bias (`TileSlot.bias`) raises that level. It is clamped to the
 * texture's levels, then rounded under a `nearest` mip rule.
 * A texture with `SAMPLE_ONE_READ` (`virtualTextureAnisotropicFiltering` off, the default) is read
 * once: the level of the longer axis, moved toward the shorter by the elongation up to the logarithm
 * of the grant, plus `tileNoise`, floored — one read at one whole level, which the request names too.
 * Magnification — a level at or under 0, the WebGPU switch — reads level 0 with the magnification
 * filter, anything else the minification one. The level comes from `lod`, the pool's
 * `atlasLod` (`atlasLodWgsl`), whose variants share one name.
 */
export const samplingFootprintWgsl = (lod: WgslDecl) =>
  wgslBlock(
    'samplingFootprintWgsl',
    [TILE_SLOT_WGSL, TILE_READ_WGSL, TILE_NOISE_WGSL, DIVISOR_FLOOR, lod],
    `fn tileRead(s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,aniso:bool)->TileRead{
 let px=ddx*s.size;let py=ddy*s.size;
 let granted=((s.sampling>>${SAMPLE_ANISOTROPY_SHIFT}u)&15u)+1u;
 var raw=atlasLod(px,py)+s.bias;
 var taps=1u;var axis=vec2f(0.0);
 var single=false;
 if(aniso){
  let lx=dot(px,px);let ly=dot(py,py);
  if((s.sampling&${SAMPLE_ONE_READ}u)==0u){
   if(granted>1u){
    let ratio=min(sqrt(max(lx,ly)/max(min(lx,ly),DIVISOR_FLOOR)),f32(granted));
    taps=select(1u,u32(ceil(ratio-${ANISOTROPY_SLACK})),ratio>${1 + ANISOTROPY_SLACK});
    raw-=log2(f32(taps));
    axis=select(vec2f(0.0),select(ddy,ddx,lx>=ly),taps>1u);
   }
  }else{
   // One read: the level of the longer axis moved toward the shorter by the elongation, up to
   // the logarithm of the grant, then the noise picks the level it straddles.
   let elongation=0.5*log2(max(max(lx,ly)/max(min(lx,ly),DIVISOR_FLOOR),1.0));
   raw-=min(elongation,f32(firstLeadingBit(granted)));
   single=true;
  }
 }
 let mag=raw<=0.0;
 var lod=clamp(raw,0.0,f32(s.last));
 if(single){lod=clamp(floor(raw+tileNoise),0.0,f32(s.last));}
 if((s.sampling&${SAMPLE_MIP_NEAREST}u)!=0u){lod=floor(lod+0.5);}
 let nearest=(s.sampling&select(${SAMPLE_MIN_NEAREST}u,${SAMPLE_MAG_NEAREST}u,mag))!=0u;
 return TileRead(uv,axis,lod,taps,nearest);
}
`,
  )
