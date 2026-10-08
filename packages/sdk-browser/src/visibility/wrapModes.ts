import type { Texture, WrapMode } from '../../../sdk-core/src/index.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { floorMod2 } from '../../../math/src/wgsl/reals.ts'

/**
 * Addressing mode of a texture, a nibble of bits carried in its header of the page table
 * (`../texture/sampling.ts`), and the rule that brings a coordinate back into the texture. The
 * nibble and the rule it commands live together: nobody has to open two files to read an
 * addressing. Bits of a nibble: 1 = S repeats, 2 = S repeats mirrored, 4 and 8 the same on T. The
 * two bits of an axis exclude each other, so `wrapAxis` never has to arbitrate between them, and
 * no bit says "clamp": that is the zero nibble.
 */
export const WRAP_S_REPEAT = 1,
  WRAP_S_MIRROR = 2,
  WRAP_T_REPEAT = 4,
  WRAP_T_MIRROR = 8

/** The two repeat bits: without them, no period wraps, so no seam. */
const WRAP_REPEATS = WRAP_S_REPEAT | WRAP_T_REPEAT

/** Rank of each map a pixel can name in its tile request (`../webgpu/tile/requestWgsl.ts`). */
export const WRAP_MAP = {
  base: 0,
  rough: 1,
  metal: 2,
  normal: 3,
  ao: 4,
  emissive: 5,
} as const

/** Nibble of a map: no bit when clamping, one bit per axis otherwise, never both of the same axis. */
export function wrapNibble(map: Texture | undefined) {
  if (!map) return 0
  const axis = (wrap: WrapMode, repeat: number, mirror: number) =>
    wrap === 'clamp' ? 0 : wrap === 'mirror' ? mirror : repeat
  return (
    axis(map.wrapS, WRAP_S_REPEAT, WRAP_S_MIRROR) | axis(map.wrapT, WRAP_T_REPEAT, WRAP_T_MIRROR)
  )
}

/**
 * Texture coordinate brought back into [0, 1] according to each axis's mode, for a clamp sampler.
 * Mirror reads odd periods backwards: `p` walks [0, 2) and `2 - p` is exact, so linear filtering
 * yields the colour of the hardware `mirror-repeat` sampler.
 *
 * `wrapUv` receives the nibble of the texture being read, not the material flags: a page's colour
 * may repeat where its normals clamp.
 *
 * Folding the coordinate is enough for nearest and mirror, never for repeat under linear
 * filtering: in the half-texel of both edges of a period, the sampler's rule mixes the last texel
 * and the first, which the fold separates. `wrapUv` therefore yields both taps and their weight —
 * `proche` alone off a seam, then `loin` and `poids` on the seam, where the caller mixes the four
 * reads itself. `proche` remains the texel the fold named, so a nearest read does not move; both
 * taps land at the exact centre of an edge texel, so the read no longer depends on the GPU's
 * interpolation but on the mix the caller writes.
 *
 * With no repeat bit, no period wraps and the seam cannot be true: `wrapReplie` then yields the
 * coordinate alone, and the caller is spared counting texels.
 */
export const WRAP_COORD_WGSL = wgslBlock(
  'WRAP_COORD_WGSL',
  [floorMod2],
  `fn wrapCoord(t:f32,repeat:bool,mirror:bool)->f32{
 let p=floorMod2(t);
 return select(select(clamp(t,0.0,1.0),fract(t),repeat),select(p,2.0-p,p>1.0),mirror);
}
struct WrapTaps{proche:vec2f,loin:vec2f,poids:vec2f,couture:bool,}
fn wrapRepete(wrap:u32)->bool{return (wrap&${WRAP_REPEATS}u)!=0u;}
fn wrapReplie(uv:vec2f,wrap:u32)->vec2f{
 return vec2f(wrapCoord(uv.x,false,(wrap&${WRAP_S_MIRROR}u)!=0u),wrapCoord(uv.y,false,(wrap&${WRAP_T_MIRROR}u)!=0u));
}
// texels is the size of the level being read: a mip level's seam is half of ITS texel wide, so the
// atlas reads fold each level on its own size (../webgpu/tile/wgsl.ts, the Level read), and the seam
// under minification mixes the last texel and the first as the hardware sampler does at that level.
fn wrapAxis(t:f32,repeat:bool,mirror:bool,texels:f32)->vec4f{
 let c=wrapCoord(t,repeat,mirror);
 let demi=0.5/texels;
 if(!repeat||(c>=demi&&c<=1.0-demi)){return vec4f(c,c,0.0,0.0);}
 let g=fract(c*texels+0.5);
 return vec4f(select(1.0-demi,demi,c<demi),select(demi,1.0-demi,c<demi),min(g,1.0-g),1.0);
}
fn wrapUv(uv:vec2f,wrap:u32,texels:vec2f)->WrapTaps{
 let x=wrapAxis(uv.x,(wrap&${WRAP_S_REPEAT}u)!=0u,(wrap&${WRAP_S_MIRROR}u)!=0u,texels.x);
 let y=wrapAxis(uv.y,(wrap&${WRAP_T_REPEAT}u)!=0u,(wrap&${WRAP_T_MIRROR}u)!=0u,texels.y);
 return WrapTaps(vec2f(x.x,y.x),vec2f(x.y,y.y),vec2f(x.z,y.z),x.w+y.w>0.0);
}`,
)
