import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { REFLECTED_WGSL } from './weight.ts'

/**
 * THE HALF-RESOLUTION TRACE'S TEXELS, one a 2×2 block of the view's pixels (`traceHalf.ts`): the
 * radiance a surface's lobes reflect, the base lobe's and the coat's, as six halves
 * (`pack2x16float`, the precision of the reflection target the resolve reads), and in `w` which
 * pixel of the block was traced (its rank in the block plus one, zero where none reflects), the
 * pixel whose depth and normal the upsample weighs it by (`upsampleWgsl.ts`). Written whole every
 * image by the trace, read by the upsample: no texel of an earlier image is ever read.
 */
export const HALF_FORMAT: GPUTextureFormat = 'rgba32uint'

/** The half grid over a view of `width × height`: a texel a 2×2 block, the last row and column
 *  covering the odd pixel. */
export const halfExtent = (width: number, height: number): [number, number] => [
  ceilDiv(width, 2),
  ceilDiv(height, 2),
]

/** Bytes of the half grid of a view of `width × height`. */
export const halfBytes = (width: number, height: number) => {
  const [w, h] = halfExtent(width, height)
  return w * h * texelBytesOf(HALF_FORMAT)
}

/** A half grid of `size` texels, written by the trace and read by the upsample. */
export const createHalfTexture = (device: GPUDevice, label: string, size: GPUExtent3D) =>
  device.createTexture({
    label,
    size,
    format: HALF_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

/** The largest finite half float: a brighter radiance is held at it, as the reflection target's
 *  `rgba16float` store holds it. */
const HALF_MAX = 65504

/**
 * A half texel as the trace writes it and the upsample reads it: `halfPack`, the radiance of both
 * lobes and the pixel picked (`HALF_FORMAT`); `halfReflected`, the radiance back; `halfPixel`, the
 * view's pixel of the half texel `at` that its `pick` names.
 */
export const HALF_TEXEL_WGSL = wgslBlock(
  'HALF_TEXEL_WGSL',
  [REFLECTED_WGSL],
  `const HALF_MAX:f32=${wgslF32(HALF_MAX)};
fn halfPack(traced:Reflected,pick:u32)->vec4u{
 let b=min(traced.base,vec3f(HALF_MAX));
 let c=min(traced.coat,vec3f(HALF_MAX));
 return vec4u(pack2x16float(b.xy),pack2x16float(vec2f(b.z,c.x)),pack2x16float(c.yz),pick);
}
fn halfReflected(t:vec4u)->Reflected{
 let a=unpack2x16float(t.x);
 let b=unpack2x16float(t.y);
 return Reflected(vec3f(a,b.x),vec3f(b.y,unpack2x16float(t.z)));
}
fn halfPixel(at:vec2i,pick:u32)->vec2i{
 return at*2+vec2i(i32((pick-1u)&1u),i32((pick-1u)>>1u));
}`,
)
