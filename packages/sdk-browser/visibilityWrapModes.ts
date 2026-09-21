import type { HostTexture } from './hostResources.ts';
import * as THREE from 'three';
import type { VisMaterial } from './visibilityTypes.ts';

/**
 * Addressing mode of a map, a nibble of bits per map, six maps in a single word, and the rule that
 * brings a coordinate back into the texture. The word and the rule it commands live together:
 * nobody has to open two files to read an addressing.
 *
 * A material does not set its maps together: colour may repeat where normals clamp, and the
 * mirror may only apply to occlusion. A per-material mode therefore addressed five maps out of
 * six in another map's mode — that is what this word corrects. Bits of a nibble: 1 = S repeats,
 * 2 = S repeats mirrored, 4 and 8 the same on T. The two bits of an axis exclude each other, so
 * `wrapAxis` never has to arbitrate between them, and no bit says "clamp": that is the zero nibble.
 */
export const WRAP_S_REPEAT = 1,
  WRAP_S_MIRROR = 2,
  WRAP_T_REPEAT = 4,
  WRAP_T_MIRROR = 8;

/** The two repeat bits: without them, no period wraps, so no seam. */
const WRAP_REPEATS = WRAP_S_REPEAT | WRAP_T_REPEAT;

/** Rank of each map in the word: four bits each, twenty-four bits used out of thirty-two. */
export const WRAP_MAP = {
  base: 0,
  rough: 1,
  metal: 2,
  normal: 3,
  ao: 4,
  emissive: 5,
} as const;

/**
 * The `VisMaterial` map each rank of the word describes. A rank added to `WRAP_MAP` without its
 * source does not compile: otherwise the new map would address in clamp without anything saying so.
 */
const WRAP_SOURCE = {
  base: 'map',
  rough: 'roughnessMap',
  metal: 'metalnessMap',
  normal: 'normalMap',
  ao: 'aoMap',
  emissive: 'emissiveMap',
} as const satisfies Record<keyof typeof WRAP_MAP, keyof VisMaterial>;

/** Nibble of a map: no bit when clamping, one bit per axis otherwise, never both of the same axis. */
export function wrapNibble(map: HostTexture | undefined) {
  if (!map) return 0;
  const axis = (wrap: number, repeat: number, mirror: number) =>
    wrap === THREE.ClampToEdgeWrapping
      ? 0
      : wrap === THREE.MirroredRepeatWrapping
        ? mirror
        : repeat;
  return (
    axis(map.wrapS, WRAP_S_REPEAT, WRAP_S_MIRROR) | axis(map.wrapT, WRAP_T_REPEAT, WRAP_T_MIRROR)
  );
}

/** Name/rank pairs of `WRAP_MAP`, read once: a material's word is written per page row, and
 *  `Object.entries` used to yield a fresh array at each. */
const WRAP_ENTRIES = Object.entries(WRAP_MAP) as [keyof typeof WRAP_MAP, number][];

/**
 * Addressing word of a material: the nibble of each of its maps at its rank. Written by
 * `webgpuPageRow.ts` into the page record and by `webgpuBlendPrepare.ts` into a transparent batch
 * uniform — a page and a transparent batch carrying different words would address the same
 * textures two ways. Ranks come from `WRAP_MAP` itself, never from a second list written by hand,
 * which would let an extra map through in silence.
 */
export function wrapModes(mat: VisMaterial) {
  let mot = 0;
  for (const [nom, rang] of WRAP_ENTRIES) mot |= wrapNibble(mat[WRAP_SOURCE[nom]]) << (4 * rang);
  return mot;
}

/** CPU mirror of `wrapOf` (WGSL): the nibble of map `map` in the word. */
export const wrapOf = (modes: number, map: number) => (modes >>> (4 * map)) & 15;

/** `wrapOf` as the shader reads it, declared once with the addressing rule that uses it. */
const WRAP_OF_WGSL = `fn wrapOf(modes:u32,map:u32)->u32{return (modes>>(map*4u))&15u;}`;

/**
 * Texture coordinate brought back into [0, 1] according to each axis's mode, for a clamp sampler.
 * Mirror reads odd periods backwards: `p` walks [0, 2) and `2 - p` is exact, so linear filtering
 * yields the colour of Three's `mirror-repeat` sampler.
 *
 * `wrapUv` receives the nibble of the map being read, not the material flags: a page's colour may
 * repeat where its normals clamp.
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
export const WRAP_COORD_WGSL = `${WRAP_OF_WGSL}
fn wrapCoord(t:f32,repeat:bool,mirror:bool)->f32{
 let p=t-2.0*floor(t*0.5);
 return select(select(clamp(t,0.0,1.0),fract(t),repeat),select(p,2.0-p,p>1.0),mirror);
}
struct WrapTaps{proche:vec2f,loin:vec2f,poids:vec2f,couture:bool,}
fn wrapRepete(wrap:u32)->bool{return (wrap&${WRAP_REPEATS}u)!=0u;}
fn wrapReplie(uv:vec2f,wrap:u32)->vec2f{
 return vec2f(wrapCoord(uv.x,false,(wrap&${WRAP_S_MIRROR}u)!=0u),wrapCoord(uv.y,false,(wrap&${WRAP_T_MIRROR}u)!=0u));
}
// Known, uncorrected limit: the half-texel is taken on textureDimensions(maps_i,0), the period
// of level 0, while textureSampleGrad reads the level the gradient chooses. Under minification,
// a mip level's seam therefore still reads the clamped edge; only magnification is corrected.
// Lifting it is not done here: the atlas compiler must lay, per level, a gutter of replicated
// edge texels, so the sampler itself yields the seam colour at every level.
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
}`;

/**
 * CPU mirror of `wrapAxis`, just above: the two texels a linear filter mixes on an axis of `size`
 * texels, the nearest first, and the weight of the second. Off a period's seam, they are the
 * neighbours the clamp sampler already gives, bounded as it bounds them; on a repeating seam, the
 * sampler's rule mixes the last texel and the first, which folding the coordinate separates —
 * the taps then wrap the period. Two languages, one rule: the shader text is not shared with
 * TypeScript.
 */
export function wrapLinear(t: number, size: number, wrap: number): [number, number, number] {
  const repeat = wrap === THREE.RepeatWrapping;
  const p = wrap === THREE.MirroredRepeatWrapping ? t - 2 * Math.floor(t / 2) : 0;
  const c = repeat
    ? t - Math.floor(t)
    : wrap === THREE.ClampToEdgeWrapping
      ? Math.min(1, Math.max(0, t))
      : p > 1
        ? 2 - p
        : p;
  const demi = 0.5 / size;
  if (repeat && (c < demi || c > 1 - demi)) {
    const u = c * size + 0.5,
      g = u - Math.floor(u);
    return c < demi ? [0, size - 1, 1 - g] : [size - 1, 0, g];
  }
  const centre = c * size - 0.5,
    bas = Math.floor(centre);
  const borne = (i: number) => Math.min(size - 1, Math.max(0, i));
  return [borne(bas), borne(bas + 1), centre - bas];
}
