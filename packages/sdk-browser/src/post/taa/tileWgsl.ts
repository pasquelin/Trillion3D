import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { GUARANTEED_WORKGROUP_BYTES } from '../../gpu/core/textureLimits.ts'

/**
 * The convolution networks of the render-resolution analysis (`flickerWgsl.ts`,
 * `rejectionWgsl.ts`) run in workgroup memory, one workgroup per `width × height` render texels
 * and the `border` texels around them its chain of 3×3 operators reads: a value at the tile's edge
 * after `n` operators depends on the texels `n` away. Each stage runs over the span of texels still
 * within `ring` of the tile — one fewer per operator —, so every texel written is exact, with no
 * seam between tiles. A texel of the span outside the image is a texel of its own whose inputs are
 * read at the image's nearest texel: its own neighbourhood continues past the edge, the edge texel
 * repeated.
 *
 * A network's values live in one array of words (`tileWords`), cut into regions (`tileRegion`):
 * a region holds the texels within its ring — the farthest any later stage reads it —, one plane
 * of words per value pair (two half floats, `pack2x16float`) or single float, and a region whose
 * values are dead lends its words to a later one.
 */
export interface TilePlan {
  /** Texels a row of the written tile. */
  readonly width: number
  /** Texels a column of it. */
  readonly height: number
  /** Texels of span read past each side of it. */
  readonly border: number
}

/** Texels a row of the span within `ring` of the tile. */
const ringSide = (plan: TilePlan, ring: number) => plan.width + 2 * ring
/** Texels of the span within `ring` of the tile. */
export const ringTexels = (plan: TilePlan, ring: number) =>
  ringSide(plan, ring) * (plan.height + 2 * ring)
/** Invocations of a workgroup: one per written texel. */
const tileLanes = ({ width, height }: TilePlan) => width * height

/** The program's entry header: `corner`, the image texel of the tile's first, `origin`, the span's
 *  first, `lane`, and `clampTexel` holding a texel on the drawn image (`view.render`). */
export const tileEntry = (plan: TilePlan, name: string) =>
  `@compute @workgroup_size(${tileLanes(plan)})
fn ${name}(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let corner=vec2i(wg.xy*vec2u(${plan.width}u,${plan.height}u));
 let origin=corner-vec2i(${plan.border});`

/** A texel held on the drawn image (`view.render`), the nearest one for a texel past its edge. */
export const TILE_CLAMP_WGSL = wgslBlock(
  'TILE_CLAMP_WGSL',
  [clampToExtent],
  `
fn clampTexel(p:vec2i)->vec2i{return clampToExtent(p,vec2i(view.render.xy));}`,
)

/**
 * One stage over the span texels within `ring` of the tile, then a barrier — none after the
 * `last`: `body` sees `l`, the texel's place in the span, `g` its image texel (past the edge for a
 * border texel), `c` the nearest drawn texel to it. Under `when`, a condition the whole workgroup
 * shares (a uniform), the stage runs only where it holds — the barrier stays outside it — and the
 * words it would write keep their zero.
 */
export const tileStage = (plan: TilePlan, ring: number, body: string, last = false, when = '') => {
  const side = ringSide(plan, ring)
  const loop = ` for(var ringSlot=lane;ringSlot<${ringTexels(plan, ring)}u;ringSlot+=${tileLanes(plan)}u){
  let l=vec2i(i32(ringSlot%${side}u),i32(ringSlot/${side}u))+vec2i(${plan.border - ring});
  let g=origin+l;let c=clampTexel(g);
${body}
 }`
  return `${when ? ` if(${when}){\n${loop}\n }` : loop}
${last ? '' : ' workgroupBarrier();'}`
}

/** A region of `tileWords`: `planes` words for each span texel within `ring` of the tile, from
 *  word `base`. */
export interface TileRegion {
  /** The WGSL word of the stage's texel `l` in the region's first plane. */
  readonly index: string
  /** Texels a row of the region: the step to the next row. */
  readonly side: number
  /** Words of a plane: the step to the next plane. */
  readonly stride: number
  /** The first word after the region. */
  readonly end: number
}

export const tileRegion = (plan: TilePlan, ring: number, planes: number, base = 0): TileRegion => {
  const side = ringSide(plan, ring),
    stride = ringTexels(plan, ring),
    offset = plan.border - ring
  return {
    index: `${base}u+u32((l.y-${offset})*${side}+l.x-${offset})`,
    side,
    stride,
    end: base + planes * stride,
  }
}

/** Whether the stage's texel `l` lies within `ring` of the tile: a texel a region at `ring` holds. */
export const tileWithin = (plan: TilePlan, ring: number) => {
  const offset = plan.border - ring
  return `(all(l>=vec2i(${offset}))&&all(l<vec2i(${offset + ringSide(plan, ring)},${offset + plan.height + 2 * ring})))`
}

/** The network's words, `words` of them, and `extraBytes` of workgroup memory beside: within what
 *  every device holds (`GUARANTEED_WORKGROUP_BYTES`), or `limit`, the bytes a device holds, for a
 *  plan made for it. */
export const tileWords = (words: number, extraBytes = 0, limit = GUARANTEED_WORKGROUP_BYTES) => {
  if (words * 4 + extraBytes > limit)
    throw new Error(`TAA_TILE_WORKGROUP_BYTES ${words * 4 + extraBytes}`)
  return `var<workgroup> tileWords:array<u32,${words}>;`
}

/**
 * The words' readers and writers, a word `k` of a plane, `stride` words a plane:
 * - `nearWord`, the word of the `n`-th texel of the 3×3 around `k` (row-major from the upper left),
 *   `side` words a row;
 * - `pairAt`, `putPair`: a word as two half floats;
 * - `tripleAt`, `putTriple`: two colours over three planes, `(u.rg)`, `(u.b, v.r)`, `(v.gb)`.
 */
export const TILE_WORDS_WGSL = wgslBlock(
  'TILE_WORDS_WGSL',
  [],
  `
fn nearWord(k:u32,n:i32,side:i32)->u32{return u32(i32(k)+(n/3-1)*side+n%3-1);}
fn pairAt(k:u32)->vec2f{return unpack2x16float(tileWords[k]);}
fn putPair(k:u32,a:f32,b:f32){tileWords[k]=pack2x16float(vec2f(a,b));}
fn tripleAt(k:u32,stride:u32)->array<vec3f,2>{
 let a=pairAt(k);let b=pairAt(k+stride);let d=pairAt(k+2u*stride);
 return array<vec3f,2>(vec3f(a,b.x),vec3f(b.y,d));
}
fn putTriple(k:u32,stride:u32,u:vec3f,v:vec3f){
 tileWords[k]=pack2x16float(u.xy);tileWords[k+stride]=pack2x16float(vec2f(u.z,v.x));tileWords[k+2u*stride]=pack2x16float(v.yz);
}`,
)

/** The operators of one value type, `suffix` naming them. */
const nineOperators = (type: string, suffix: string) => `
fn min9${suffix}(n:array<${type},9>)->${type}{var t=n;var v=t[0];for(var k=1;k<9;k++){v=min(v,t[k]);}return v;}
fn max9${suffix}(n:array<${type},9>)->${type}{var t=n;var v=t[0];for(var k=1;k<9;k++){v=max(v,t[k]);}return v;}
fn blur9${suffix}(n:array<${type},9>)->${type}{
 var t=n;
 let up=t[0]*0.5+t[1]+t[2]*0.5;let mid=t[3]*0.5+t[4]+t[5]*0.5;let down=t[6]*0.5+t[7]+t[8]*0.5;
 return (up*0.5+mid+down*0.5)*0.25;
}
fn variation9${suffix}(n:array<${type},9>)->${type}{
 var t=n;var s=t[0];for(var k=1;k<9;k++){s+=t[k];}
 return 1.125*t[4]-0.125*s;
}
fn median3${suffix}(a:${type},b:${type},c:${type})->${type}{return max(min(a,b),min(max(a,b),c));}
fn median9${suffix}(n:array<${type},9>)->${type}{
 var t=n;
 var l:array<${type},3>;var m:array<${type},3>;var h:array<${type},3>;
 for(var x=0;x<3;x++){
  let a=t[x];let b=t[3+x];let c=t[6+x];
  l[x]=min(a,min(b,c));m[x]=median3${suffix}(a,b,c);h[x]=max(a,max(b,c));
 }
 return median3${suffix}(max(l[0],max(l[1],l[2])),median3${suffix}(m[0],m[1],m[2]),min(h[0],min(h[1],h[2])));
}`

/**
 * The 3×3 operators on nine values, row-major from the upper left, for one value (`min9`), two
 * (`min9p`), a colour (`min9c`) and four (`min9q`), each channel alone:
 * - `min9`, `max9`;
 * - `blur9`, the binomial blur, `(1, 2, 1) ⊗ (1, 2, 1) / 16`;
 * - `variation9`, the total variation: the centre less the mean of the nine, scaled by 9/8;
 * - `median9`, the median of the three columns' medians bounded by the greatest of their minima and
 *   the least of their maxima: each column ordered first, then across.
 */
export const NINE_OPERATORS_WGSL = wgslBlock(
  'NINE_OPERATORS_WGSL',
  [],
  [
    ['f32', ''],
    ['vec2f', 'p'],
    ['vec3f', 'c'],
    ['vec4f', 'q'],
  ]
    .map(([type, suffix]) => nineOperators(type, suffix))
    .join(''),
)
