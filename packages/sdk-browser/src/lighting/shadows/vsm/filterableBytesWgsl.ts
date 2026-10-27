/**
 * THE BYTES OF THE FILTERED POOLS (`filterableWgsl.ts`, and the projection that reads the merged pool,
 * `projection/projectionPrefilteredWgsl.ts`): a byte's place in a pool and the accessors of a pool
 * a module binds as words, an 8-bit unorm a byte.
 */
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { unorm8, unorm8Byte } from '../../../../../math/src/wgsl/color.ts'
import { byteIn } from '../../../../../math/src/wgsl/integer.ts'
import { bilinear1 } from '../../../../../math/src/wgsl/sampling.ts'
import { VSM_PREFILTERED_WGSL } from './prefilteredWgsl.ts'

/** A byte's place in a filtered pool: the byte of texel `p` (border included) of pool page `page`, and
 *  in the temporary pool of the separable passes, where a page's texels are its 128 x 128 inner ones. */
export const VSM_FILTER_BYTE_WGSL = wgslBlock(
  'VSM_FILTER_BYTE_WGSL',
  [VSM_PREFILTERED_WGSL],
  /* wgsl */ `
fn vsmFilterByte(page:u32,p:vec2u)->u32{
 return page*VSM_FILTERABLE_PAGE_BYTES+p.y*VSM_FILTERABLE_PAGE_SIZE+p.x;
}
fn vsmFilterTempByte(page:u32,p:vec2u)->u32{
 return page*VSM_FILTERABLE_PAGE_BYTES+p.y*VSM_PAGE_TEXELS+p.x;
}
`,
)

/** What a kernel does with the bytes of a pool. */
interface ByteUses {
  /** `<variable>At(byte)`: a byte read as a 255th. */
  at?: boolean
  /** `<variable>Put(byte, value)`: a byte stored rounded to a 255th, or-ed into a byte of a pool the
   *  frame cleared and the kernels write once. */
  put?: boolean
  /** `<variable>Bilinear(page, p)`: the read at `p`, in texels from the corner of the page's inner
   *  texels (the texel centres at half-integers), by hand over the four bytes around it, clamped to
   *  the page and its border. */
  bilinear?: boolean
}

/** The accessors of the pool bytes the module binds as `variable` (`<variable>Load(word)`, the bytes'
 *  words; atomic words for `put`). */
export function vsmFilterableBytesWgsl(variable: string, uses: ByteUses) {
  const at = /* wgsl */ `
fn ${variable}At(b:u32)->f32{return unorm8(${variable}Load(b>>2u),b&3u);}`
  const put = /* wgsl */ `
fn ${variable}Put(b:u32,x:f32){atomicOr(&${variable}[b>>2u],byteIn(unorm8Byte(saturate(x)),b&3u));}`
  const bilinear = /* wgsl */ `
fn ${variable}Pair(i:u32,j:u32)->vec2f{
 let first=${variable}Load(i>>2u);
 var second=first;
 if((j>>2u)!=(i>>2u)){second=${variable}Load(j>>2u);}
 return vec2f(unorm8(first,i&3u),unorm8(second,j&3u));
}
fn ${variable}Bilinear(page:u32,p:vec2f)->f32{
 let f=p+vec2f(f32(VSM_FILTERABLE_BORDER))-vec2f(0.5);
 let whole=floor(f);
 let last=vec2i(i32(VSM_FILTERABLE_PAGE_SIZE)-1);
 let a=vec2u(clamp(vec2i(whole),vec2i(0),last));
 let b=vec2u(clamp(vec2i(whole)+vec2i(1),vec2i(0),last));
 let top=${variable}Pair(vsmFilterByte(page,a),vsmFilterByte(page,vec2u(b.x,a.y)));
 let bottom=${variable}Pair(vsmFilterByte(page,vec2u(a.x,b.y)),vsmFilterByte(page,b));
 return bilinear1(top.x,top.y,bottom.x,bottom.y,f-whole);
}`
  const reads = uses.at || uses.bilinear
  return wgslBlock(
    `vsmFilterableBytes(${variable}, ${!!uses.at}, ${!!uses.put}, ${!!uses.bilinear})`,
    [
      VSM_FILTER_BYTE_WGSL,
      ...(reads ? [unorm8] : []),
      ...(uses.put ? [unorm8Byte, byteIn] : []),
      ...(uses.bilinear ? [bilinear1] : []),
    ],
    `${uses.at ? at : ''}${uses.put ? put : ''}${uses.bilinear ? bilinear : ''}`,
  )
}
