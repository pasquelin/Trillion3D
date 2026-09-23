import type { Texture, TextureFilter } from '../../../../sdk-core/src/index.ts';

/**
 * How a texture is sampled on WebGPU, carried in its header of the page table
 * (`pageTable.ts`): one filter word, then its UV transform — six floats, the 2 × 3 affine part
 * of `Texture.transform`, the very matrix the WebGL2 binder uploads (`../../webgl/cluster/materialBinding.ts`).
 *
 * The pools have no hardware sampler state to set per texture: a tile is read through one
 * linear sampler, the level is chosen and mixed by the shader (`wgsl.ts`). So the filter is a
 * rule of that shader, not a sampler: `nearest` reads the centre of the texel the coordinate
 * falls in — the linear sampler at a texel centre returns that texel alone —, a mip rule rounds
 * or pins the level, and anisotropy takes up to sixteen reads along the longer axis of the
 * footprint at the level of the shorter one. No sampler and no bind group is created per
 * texture; a texture's words live where its size already does, read once per sample.
 *
 * Bits of the filter word, zero for the default `linear` / `linear-mip-linear` / 1 × untransformed:
 */
export const SAMPLE_MAG_NEAREST = 1,
  SAMPLE_MIN_NEAREST = 2,
  SAMPLE_MIP_NEAREST = 4,
  /** No mip rule: level 0 whatever the footprint, as a filter without `mip` asks. */
  SAMPLE_MIP_NONE = 8,
  /** Anisotropy minus one, four bits. */
  SAMPLE_ANISOTROPY_SHIFT = 4,
  /** The transform is not the identity: only then does the shader read it. */
  SAMPLE_TRANSFORMED = 256;

/** The most reads anisotropic filtering takes, WebGPU's `maxAnisotropy` ceiling. */
export const MAX_ANISOTROPY = 16;

/** Word count of a texture's sampling in its header: the filter, then the transform. */
export const SAMPLING_WORDS = 7;

/** Base filter and mip rule of each filter name. */
const MIN_BITS: Record<TextureFilter, number> = {
  nearest: SAMPLE_MIN_NEAREST | SAMPLE_MIP_NONE,
  linear: SAMPLE_MIP_NONE,
  'nearest-mip-nearest': SAMPLE_MIN_NEAREST | SAMPLE_MIP_NEAREST,
  'nearest-mip-linear': SAMPLE_MIN_NEAREST,
  'linear-mip-nearest': SAMPLE_MIP_NEAREST,
  'linear-mip-linear': 0,
};

/** Entries of `Texture.transform` (three columns of three) the affine 2 × 3 part is made of. */
const AFFINE = [0, 1, 3, 4, 6, 7] as const;

/** Where `samplingWords` writes: one array, reused, read back by its caller before the next call. */
const scratch = new Uint32Array(SAMPLING_WORDS),
  scratchFloats = new Float32Array(scratch.buffer);

/**
 * A texture's sampling words, floats as their bits, in an array the next call overwrites.
 * Anisotropy counts only under linear filters throughout, as WebGPU's sampler rule has it, and
 * is clamped to its ceiling.
 */
export function samplingWords(texture: Texture): Uint32Array {
  const linear = texture.magFilter !== 'nearest' && texture.minFilter === 'linear-mip-linear';
  const anisotropy = linear
    ? Math.min(MAX_ANISOTROPY, Math.max(1, Math.round(texture.anisotropy)))
    : 1;
  const m = texture.transform;
  const transformed =
    m[0] !== 1 || m[1] !== 0 || m[3] !== 0 || m[4] !== 1 || m[6] !== 0 || m[7] !== 0;
  scratch[0] =
    (texture.magFilter === 'nearest' ? SAMPLE_MAG_NEAREST : 0) |
    MIN_BITS[texture.minFilter] |
    ((anisotropy - 1) << SAMPLE_ANISOTROPY_SHIFT) |
    (transformed ? SAMPLE_TRANSFORMED : 0);
  for (let i = 0; i < AFFINE.length; i++) scratchFloats[1 + i] = m[AFFINE[i]];
  return scratch;
}

/**
 * The shader side of these words, inside `TILE_POOL_WGSL` (`wgsl.ts`): the UV transform maps the
 * coordinate and its derivatives before anything else, so level, seam and tile are those of the
 * transformed coordinate; the filter word then picks the level and whether a level is read at the
 * centre of its texel or mixed by the sampler. Anisotropy averages `taps` reads along the longer
 * axis of the footprint, each a full read — seam included — at the level of the shorter axis.
 * The default word — linear, trilinear, 1 ×, untransformed — leaves the read as it was: one
 * read, the level of the longer gradient, the transform not even fetched.
 */
export const SAMPLING_WGSL = `/** How one sample reads: the coordinate after the texture's transform, the line anisotropy spreads
 *  its \`taps\` over, the level, and whether texels are picked rather than mixed. */
struct TileRead{uv:vec2f,axis:vec2f,lod:f32,taps:u32,nearest:bool,}
/**
 * How a footprint reads a texture, its coordinate and derivatives already transformed: the single
 * rule for choosing a level, for the read as for the request. The level is the GPU's — the log of
 * the longer gradient —, lowered by the anisotropic ratio the texture grants, clamped to its
 * levels, then rounded (\`nearest\` mip) or pinned to 0 (no mip). Magnification — a level at or
 * under 0 — takes the magnification filter, anything else the minification one.
 */
fn tileRead(s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f)->TileRead{
 let px=ddx*s.size;let py=ddy*s.size;
 let lx=dot(px,px);let ly=dot(py,py);
 let granted=f32(((s.sampling>>${SAMPLE_ANISOTROPY_SHIFT}u)&15u)+1u);
 let ratio=clamp(sqrt(max(lx,ly)/max(min(lx,ly),1e-20)),1.0,granted);
 let raw=atlasLod(px,py)-log2(ratio);
 var lod=clamp(raw,0.0,f32(s.last));
 if((s.sampling&${SAMPLE_MIP_NONE}u)!=0u){lod=0.0;}
 else if((s.sampling&${SAMPLE_MIP_NEAREST}u)!=0u){lod=floor(lod+0.5);}
 let nearest=(s.sampling&select(${SAMPLE_MIN_NEAREST}u,${SAMPLE_MAG_NEAREST}u,raw<=0.0))!=0u;
 return TileRead(uv,select(ddy,ddx,lx>=ly),lod,u32(ceil(ratio)),nearest);
}
/** The centre of the texel a coordinate falls in, for a nearest read; the coordinate otherwise. */
fn pickTexel(texel:vec2f,nearest:bool)->vec2f{return select(texel,floor(texel)+0.5,nearest);}`;

/** The read of a footprint in atlas `k`, through the texture's UV transform: the header words
 *  after the filter word, which only a transformed texture fetches. */
export const samplingReadWgsl = (
  k: string,
) => `/** The read of a footprint, through the texture's UV transform when it has one: the affine
 *  2 × 3 matrix the WebGL2 path applies, on the coordinate and on its derivatives. */
fn ${k}Read(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f)->TileRead{
 if((s.sampling&${SAMPLE_TRANSFORMED}u)==0u){return tileRead(s,uv,ddx,ddy);}
 let h=PAGE_HEADER+slot*PAGE_SLOT+PAGE_SAMPLING+1u;
 let m=mat2x2f(bitcast<f32>(${k}Pages[h]),bitcast<f32>(${k}Pages[h+1u]),bitcast<f32>(${k}Pages[h+2u]),bitcast<f32>(${k}Pages[h+3u]));
 let t=vec2f(bitcast<f32>(${k}Pages[h+4u]),bitcast<f32>(${k}Pages[h+5u]));
 return tileRead(s,m*uv+t,m*ddx,m*ddy);
}`;
