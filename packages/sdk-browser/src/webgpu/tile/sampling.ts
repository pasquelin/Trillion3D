import type { Texture, TextureFilter } from '../../../../sdk-core/src/index.ts';
import { uvTransformed } from '../../visibility/math.ts';

/**
 * How a texture is sampled on WebGPU, carried in its header of the page table
 * (`pageTable.ts`): a filter word, packed above the texture's last level in a word the shader
 * already reads, then its UV transform — six floats, the 2 × 3 affine part of
 * `Texture.transform`, the very matrix the WebGL2 binder uploads
 * (`../../webgl/cluster/materialBinding.ts`) — fetched only by a texture that has one.
 *
 * The pools have no hardware sampler state to set per texture: a tile is read through one
 * linear sampler, the level is chosen and mixed by the shader (`wgsl.ts`). So the filter is a
 * rule of that shader, not a sampler: `nearest` reads the centre of the texel the coordinate
 * falls in — the linear sampler at a texel centre returns that texel alone —, a mip rule rounds
 * or pins the level, and anisotropy takes up to sixteen reads along the longer axis of the
 * footprint at the level of the shorter one. No sampler and no bind group is created per
 * texture.
 *
 * Bits of the filter word, zero for the default `linear` / `linear-mip-linear` / 1 × untransformed:
 * the zero word takes the read the pools had before, and nothing else.
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

/** Header words of a texture's UV transform: the affine 2 × 3 part. */
export const TRANSFORM_WORDS = 6;

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
const scratch = new Uint32Array(1 + TRANSFORM_WORDS),
  scratchFloats = new Float32Array(scratch.buffer);

/**
 * A texture's filter word, then its transform's six floats as their bits, in an array the next
 * call overwrites. Anisotropy counts whatever the filters, as the WebGL2 binder sets it
 * (`../../webgl/cluster/textures.ts`), clamped to its ceiling.
 */
export function samplingWords(texture: Texture): Uint32Array {
  const anisotropy = Math.min(MAX_ANISOTROPY, Math.max(1, Math.round(texture.anisotropy)));
  const m = texture.transform;
  scratch[0] =
    (texture.magFilter === 'nearest' ? SAMPLE_MAG_NEAREST : 0) |
    MIN_BITS[texture.minFilter] |
    ((anisotropy - 1) << SAMPLE_ANISOTROPY_SHIFT) |
    (uvTransformed(m) ? SAMPLE_TRANSFORMED : 0);
  for (let i = 0; i < TRANSFORM_WORDS; i++) scratchFloats[1 + i] = m[AFFINE[i]];
  return scratch;
}

/**
 * The shader side of these words, inside `TILE_POOL_WGSL` (`wgsl.ts`). A texture whose filter
 * word is zero never reaches it: its read is the one it had before (`slotLod`). Otherwise the UV
 * transform maps the coordinate and its derivatives first, so level, seam and tile are those of
 * the transformed coordinate; the filter word then picks the level and whether a level is read at
 * the centre of its texel or mixed by the sampler. Anisotropy averages `taps` reads along the
 * longer axis of the footprint, each a full read — seam included — at the level of the shorter
 * axis.
 */
export const SAMPLING_WGSL = `/** How one sample reads: the coordinate after the texture's transform, the line anisotropy spreads
 *  its \`taps\` over, the level, and whether texels are picked rather than mixed. */
struct TileRead{uv:vec2f,axis:vec2f,lod:f32,taps:u32,nearest:bool,}
/**
 * How a footprint reads a texture with a filter word, its coordinate and derivatives already
 * transformed. The level is the GPU's — the log of the longer gradient —, lowered by the
 * anisotropic ratio the texture grants, clamped to its levels, then rounded (\`nearest\` mip) or
 * pinned to 0 (no mip). Magnification — a level at or under 0 — takes the magnification filter,
 * anything else the minification one.
 */
fn tileRead(s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f)->TileRead{
 let px=ddx*s.size;let py=ddy*s.size;
 let granted=((s.sampling>>${SAMPLE_ANISOTROPY_SHIFT}u)&15u)+1u;
 var raw=atlasLod(px,py);
 var taps=1u;var axis=vec2f(0.0);
 if(granted>1u){
  let lx=dot(px,px);let ly=dot(py,py);
  let ratio=clamp(sqrt(max(lx,ly)/max(min(lx,ly),1e-20)),1.0,f32(granted));
  raw-=log2(ratio);
  taps=u32(ceil(ratio));
  axis=select(ddy,ddx,lx>=ly);
 }
 var lod=clamp(raw,0.0,f32(s.last));
 if((s.sampling&${SAMPLE_MIP_NONE}u)!=0u){lod=0.0;}
 else if((s.sampling&${SAMPLE_MIP_NEAREST}u)!=0u){lod=floor(lod+0.5);}
 let nearest=(s.sampling&select(${SAMPLE_MIN_NEAREST}u,${SAMPLE_MAG_NEAREST}u,raw<=0.0))!=0u;
 return TileRead(uv,axis,lod,taps,nearest);
}
/** The centre of the texel a coordinate falls in, for a nearest read; the coordinate otherwise. */
fn pickTexel(texel:vec2f,nearest:bool)->vec2f{return select(texel,floor(texel)+0.5,nearest);}`;

/** The read of a footprint in atlas `k` for a texture with a filter word, through its UV
 *  transform when it has one: the header words the transform flag alone fetches. */
export const samplingReadWgsl = (
  k: string,
) => `/** The read of a footprint, through the texture's UV transform when it has one: the affine
 *  2 × 3 matrix the WebGL2 path applies, on the coordinate and on its derivatives. */
fn ${k}Read(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f)->TileRead{
 if((s.sampling&${SAMPLE_TRANSFORMED}u)==0u){return tileRead(s,uv,ddx,ddy);}
 let h=PAGE_HEADER+slot*PAGE_SLOT+PAGE_TRANSFORM;
 let m=mat2x2f(bitcast<f32>(${k}Pages[h]),bitcast<f32>(${k}Pages[h+1u]),bitcast<f32>(${k}Pages[h+2u]),bitcast<f32>(${k}Pages[h+3u]));
 let t=vec2f(bitcast<f32>(${k}Pages[h+4u]),bitcast<f32>(${k}Pages[h+5u]));
 return tileRead(s,m*uv+t,m*ddx,m*ddy);
}`;

/**
 * Public atlas read: `wrap` is the addressing nibble of the map being sampled. The header is read
 * once, then a single read off a seam, four mixed on the seam of a repeating period, where the
 * sampler's rule would mix the last texel and the first: it is the read that wraps, not the
 * coordinate. `name + 'At'` is the read that `name` dispatches, `name + 'Tap'` one read of it.
 *
 * A texture at the default filters — its filter word zero — takes that read and nothing more.
 * Any other goes through its transform and filter rule (`${k}Read`, `sampling.ts`): a nearest read
 * takes the texel the fold named, seam or not, and anisotropy averages its taps.
 */
export const atlasReadWgsl = (name: string, k: string, out: string) => {
  const at = `${name}At`,
    tap = `${name}Tap`;
  return `fn ${tap}(s:TileSlot,uv:vec2f,wrap:u32,lod:f32,nearest:bool)->${out}{
 if(!wrapRepete(wrap)){return ${at}(s,wrapReplie(uv,wrap),lod,nearest);}
 let t=wrapUv(uv,wrap,s.size);
 if(!t.couture||nearest){return ${at}(s,t.proche,lod,nearest);}
 let s00=${at}(s,t.proche,lod,nearest);
 let s10=${at}(s,vec2f(t.loin.x,t.proche.y),lod,nearest);
 let s01=${at}(s,vec2f(t.proche.x,t.loin.y),lod,nearest);
 let s11=${at}(s,t.loin,lod,nearest);
 return mix(mix(s00,s10,t.poids.x),mix(s01,s11,t.poids.x),t.poids.y);
}
fn ${name}(slot:u32,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f)->${out}{
 let s=${k}Slot(slot);
 if(s.sampling==0u){return ${tap}(s,uv,wrap,slotLod(s,ddx,ddy),false);}
 let r=${k}Read(slot,s,uv,ddx,ddy);
 if(r.taps==1u){return ${tap}(s,r.uv,wrap,r.lod,r.nearest);}
 var sum=${out}();
 let n=f32(r.taps);
 for(var i=0u;i<r.taps;i++){sum+=${tap}(s,r.uv+r.axis*((f32(i)+0.5)/n-0.5),wrap,r.lod,r.nearest);}
 return sum/n;
}`;
};
