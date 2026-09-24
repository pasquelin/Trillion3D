import type { Texture, TextureFilter } from '../../../../sdk-core/src/index.ts';
import {
  AFFINE,
  grantedAnisotropy,
  uvTransformed,
} from '../../../../sdk-core/src/texture/contract.ts';

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
 * or pins the level, and anisotropy reads along the longer axis of the footprint at the level of
 * the shorter one, as many taps as the footprint is elongated, up to the texture's grant: one on
 * a surface seen face-on. No sampler and no bind group is created per texture.
 *
 * A filter without `mip` depends on who owns the chain. A texture of the compiled cache carries
 * the engine's own levels, streamed by tile: its filter picks the read inside a level — nearest
 * or linear — and never the level, so level selection and tile requests stay those of the
 * default read. A texture created in the page is uploaded as a single picture, the case WebGL2
 * reads at level 0 whatever the footprint: there the rule is WebGL2's, level 0.
 *
 * Bits of the filter word, zero for the default `linear` / `linear-mip-linear` / 1 × untransformed:
 * the zero word takes the read the pools had before, and nothing else.
 */
export const SAMPLE_MAG_NEAREST = 1,
  SAMPLE_MIN_NEAREST = 2,
  SAMPLE_MIP_NEAREST = 4,
  /** No mip rule: level 0 whatever the footprint, a filter without `mip` on a page texture. */
  SAMPLE_MIP_NONE = 8,
  /** Anisotropy minus one, four bits. */
  SAMPLE_ANISOTROPY_SHIFT = 4,
  /** The transform is not the identity: only then does the shader read it. */
  SAMPLE_TRANSFORMED = 256,
  /** Minification starts at level 0.5, not 0: GL's rule for a linear magnification over a
   *  `nearest-mip-*` minification (OpenGL ES 3.0 § 3.8.11, `c`). */
  SAMPLE_MAG_HALF = 512;

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

/** Where `samplingWords` writes: one array, reused, read back by its caller before the next call. */
const scratch = new Uint32Array(1 + TRANSFORM_WORDS),
  scratchFloats = new Float32Array(scratch.buffer);

/**
 * A texture's filter word, then its transform's six floats as their bits, in an array the next
 * call overwrites. `compiled` says the texture's levels are the cache's (see above). Anisotropy
 * follows the rule both GPU paths share (`grantedAnisotropy`), clamped to its ceiling.
 */
export function samplingWords(texture: Texture, compiled: boolean): Uint32Array {
  const anisotropy = Math.round(grantedAnisotropy(texture, MAX_ANISOTROPY));
  const m = texture.transform;
  scratch[0] =
    (texture.magFilter === 'nearest' ? SAMPLE_MAG_NEAREST : 0) |
    (MIN_BITS[texture.minFilter] & (compiled ? ~SAMPLE_MIP_NONE : ~0)) |
    ((anisotropy - 1) << SAMPLE_ANISOTROPY_SHIFT) |
    (uvTransformed(m) ? SAMPLE_TRANSFORMED : 0) |
    (texture.magFilter !== 'nearest' && texture.minFilter.startsWith('nearest-mip')
      ? SAMPLE_MAG_HALF
      : 0);
  for (let i = 0; i < TRANSFORM_WORDS; i++) scratchFloats[1 + i] = m[AFFINE[i]];
  return scratch;
}

/** Elongation a footprint may have and still be read once, at the isotropic level, like a
 *  texture granted no anisotropy: a surface seen face-on, up to rounding. */
const ANISOTROPY_SLACK = 0.01;

/**
 * The shader side of these words, inside `TILE_POOL_WGSL` (`wgsl.ts`). A texture whose filter
 * word is zero never reaches it: its read is the one it had before (`slotLod`). Otherwise the UV
 * transform maps the coordinate and its derivatives first, so level, seam and tile are those of
 * the transformed coordinate; the filter word then picks the level and whether a level is read at
 * the centre of its texel or mixed by the sampler. Anisotropy averages `taps` reads along the
 * longer axis of the footprint, each a full read — seam included — at the level of the shorter
 * axis — once when it is hardly elongated (`ANISOTROPY_SLACK`).
 */
export const SAMPLING_WGSL = `/** How one sample reads: the coordinate after the texture's transform, the line anisotropy spreads
 *  its \`taps\` over, the level, and whether texels are picked rather than mixed. */
struct TileRead{uv:vec2f,axis:vec2f,lod:f32,taps:u32,nearest:bool,}
/**
 * How a footprint reads a texture with a filter word, its coordinate and derivatives already
 * transformed. The level is the GPU's — the log of the longer gradient —, lowered by the
 * anisotropic ratio when \`aniso\` lets the texture's grant apply, clamped to its levels, then
 * rounded (\`nearest\` mip) or pinned to 0 (no mip). Magnification — a level at or under GL's
 * threshold, 0.5 with \`SAMPLE_MAG_HALF\`, 0 otherwise — reads level 0 with the magnification
 * filter, anything else the minification one. The taps are the
 * footprint's elongation, rounded up, capped by the grant.
 */
fn tileRead(s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,aniso:bool)->TileRead{
 let px=ddx*s.size;let py=ddy*s.size;
 let granted=((s.sampling>>${SAMPLE_ANISOTROPY_SHIFT}u)&15u)+1u;
 var raw=atlasLod(px,py);
 var taps=1u;var axis=vec2f(0.0);
 if(aniso&&granted>1u){
  let lx=dot(px,px);let ly=dot(py,py);
  let ratio=min(sqrt(max(lx,ly)/max(min(lx,ly),1e-20)),f32(granted));
  if(ratio>${1 + ANISOTROPY_SLACK}){
   raw-=log2(ratio);
   taps=u32(ceil(ratio-${ANISOTROPY_SLACK}));
   axis=select(ddy,ddx,lx>=ly);
  }
 }
 let mag=raw<=select(0.0,0.5,(s.sampling&${SAMPLE_MAG_HALF}u)!=0u);
 var lod=clamp(raw,0.0,f32(s.last));
 if(mag||(s.sampling&${SAMPLE_MIP_NONE}u)!=0u){lod=0.0;}
 else if((s.sampling&${SAMPLE_MIP_NEAREST}u)!=0u){lod=floor(lod+0.5);}
 let nearest=(s.sampling&select(${SAMPLE_MIN_NEAREST}u,${SAMPLE_MAG_NEAREST}u,mag))!=0u;
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
fn ${k}Read(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,aniso:bool)->TileRead{
 if((s.sampling&${SAMPLE_TRANSFORMED}u)==0u){return tileRead(s,uv,ddx,ddy,aniso);}
 let h=PAGE_HEADER+slot*PAGE_SLOT+PAGE_TRANSFORM;
 let m=mat2x2f(bitcast<f32>(${k}Pages[h]),bitcast<f32>(${k}Pages[h+1u]),bitcast<f32>(${k}Pages[h+2u]),bitcast<f32>(${k}Pages[h+3u]));
 let t=vec2f(bitcast<f32>(${k}Pages[h+4u]),bitcast<f32>(${k}Pages[h+5u]));
 return tileRead(s,m*uv+t,m*ddx,m*ddy,aniso);
}`;

/**
 * Public atlas read: `wrap` is the addressing nibble of the map being sampled. The header is read
 * once, then a single read off a seam, four mixed on the seam of a repeating period, where the
 * sampler's rule would mix the last texel and the first: it is the read that wraps, not the
 * coordinate. `name + 'At'` is the read that `name` dispatches, `name + 'Tap'` one read of it.
 *
 * A texture at the default filters — its filter word zero — takes that read and nothing more.
 * Any other goes through its transform and filter rule (`${k}Read`, `sampling.ts`): a nearest read
 * takes the texel the fold named, seam or not, and anisotropy, when `anisotropic`, averages its
 * taps. A read that is not — the alpha cutout of the visibility and shadow passes, which only
 * compares a threshold — takes one tap at the isotropic level.
 */
export const atlasReadWgsl = (name: string, k: string, out: string, anisotropic: boolean) => {
  const at = `${name}At`,
    tap = `${name}Tap`;
  const taps = anisotropic
    ? ` if(r.taps==1u){return ${tap}(s,r.uv,wrap,r.lod,r.nearest);}
 var sum=${out}();
 let n=f32(r.taps);
 for(var i=0u;i<r.taps;i++){sum+=${tap}(s,r.uv+r.axis*((f32(i)+0.5)/n-0.5),wrap,r.lod,r.nearest);}
 return sum/n;`
    : ` return ${tap}(s,r.uv,wrap,r.lod,r.nearest);`;
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
 let r=${k}Read(slot,s,uv,ddx,ddy,${anisotropic});
${taps}
}`;
};
