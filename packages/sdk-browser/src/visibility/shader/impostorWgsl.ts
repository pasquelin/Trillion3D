import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { octDecodeHemi, octEncodeHemi } from '../../../../math/src/wgsl/octahedral.ts'
import { ndcToUvUnflipped } from '../../../../math/src/wgsl/projection.ts'
import { unitToSigned3 } from '../../../../math/src/wgsl/reals.ts'

/**
 * The octahedral mapping and the three-frame blend, object space, pivot at the bounding-sphere
 * centre, +Y up: the WGSL of the compiler's `octahedron.rs`, held to its places and folds by
 * `impostorWgsl.test.ts`. `hemi` is 1 for the upper hemi-octahedron; the map is the library's
 * (`octEncodeHemi`, `octDecodeHemi`). Every function here is a declaration or a single return, so
 * the software shader harness reads the shipped text and not a copy of its formula.
 */
const IMPOSTOR_MATH_WGSL = wgslBlock(
  'IMPOSTOR_MATH_WGSL',
  [],
  `
/** The three frame weights at grid position \`f\`: they sum to one on both triangles of a cell. */
fn impWeights(f:vec2f)->vec3f{
 return vec3f(min(1.0-f.x,1.0-f.y),abs(f.x-f.y),min(f.x,f.y));
}`,
)

/**
 * The card's view, once per card (the vertex stage): the three frames the eye's direction blends,
 * their weights, and each frame's capture plane's normal `n`; its `x` axis is the library's
 * `tangentImpostor` (`basis` of `octahedron.rs`; `y = n × x`).
 */
const IMPOSTOR_VIEW_WGSL = wgslBlock(
  'IMPOSTOR_VIEW_WGSL',
  [octEncodeHemi, octDecodeHemi, ndcToUvUnflipped, IMPOSTOR_MATH_WGSL],
  `
struct ImpView{a:vec2f,b:vec2f,c:vec2f,w:vec3f}
/** The three frames and weights seen from \`eye\` (object space, pivot-relative). */
fn impView(eye:vec3f,frames:f32,hemi:f32)->ImpView{
 let last=frames-1.0;
 let g=clamp(ndcToUvUnflipped(octEncodeHemi(normalize(eye),hemi))*last,vec2f(0.0),vec2f(last));
 let g0=min(floor(g),vec2f(last-1.0));
 let f=g-g0;
 return ImpView(g0,select(g0+vec2f(0.0,1.0),g0+vec2f(1.0,0.0),f.x>f.y),g0+vec2f(1.0),impWeights(f));
}
/** The normal of frame \`frame\`'s capture plane. */
fn impFrameNormal(frame:vec2f,frames:f32,hemi:f32)->vec3f{return octDecodeHemi(frame/(frames-1.0),hemi);}`,
)

/**
 * Per pixel: the ray on each frame's plane, one-step parallax, and the blend of the three frames.
 * It reads the card's three maps (`CardMaps`) in the one tile pool — colour and coverage in the
 * colour atlas, normal and depth and the packed ORM in the data atlas —, each at the mip level `lod`
 * the card's texel footprint asks, through the pool's level blend at an explicit level
 * (`colorBlend`, `dataBlend` and `TileSlot`, which `reads` declares), the level clamped to the map's
 * chain as a sampler clamps it. `cell` is one frame's side in the atlas, `1 / frames`.
 */
const impostorTapWgsl = (reads: WgslDecl) =>
  wgslBlock(
    'impostorTapWgsl',
    [unitToSigned3, reads],
    `
struct CardMaps{colour:TileSlot,normalDepth:TileSlot,orm:TileSlot}
/** The level a map is read at: \`lod\` within its chain. */
fn impLod(s:TileSlot,lod:f32)->f32{return clamp(lod,0.0,f32(s.last));}
fn impColour(m:CardMaps,uv:vec2f,lod:f32)->vec4f{return colorBlend(m.colour,uv,impLod(m.colour,lod),false,false);}
fn impNormalDepth(m:CardMaps,uv:vec2f,lod:f32)->vec4f{return dataBlend(m.normalDepth,uv,impLod(m.normalDepth,lod),false,false);}
fn impOrm(m:CardMaps,uv:vec2f,lod:f32)->vec4f{return dataBlend(m.orm,uv,impLod(m.orm,lod),false,false);}
struct ImpTap{uv:vec2f,point:vec3f}
/** The view ray (origin \`eye\`, direction \`ray\`, object space) on the plane of frame \`frame\`
 *  (normal \`n\`, axis \`x\`): its atlas uv and the true surface point \`s_k = h + η·v/v_n\` the depth
 *  offset writes. */
fn impTap(m:CardMaps,frame:vec2f,x:vec3f,n:vec3f,eye:vec3f,ray:vec3f,radius:f32,cell:f32,lod:f32)->ImpTap{
 let y=cross(n,x);
 let t=-dot(n,eye)/dot(n,ray);
 let h=eye+t*ray;
 var uv=vec2f(dot(x,h),dot(y,h))/(2.0*radius)+0.5;
 let v=-ray;
 let vn=max(dot(n,v),0.001);
 let d=impNormalDepth(m,(frame+clamp(uv,vec2f(0.0),vec2f(1.0)))*cell,lod).w;
 uv+=(d-0.5)*vec2f(dot(x,v),dot(y,v))/vn;
 return ImpTap((frame+clamp(uv,vec2f(0.0),vec2f(1.0)))*cell,h+(d-0.5)*2.0*radius*v/vn);
}
/** The colour and coverage blended at the three taps \`a\`, \`b\`, \`c\` of weights \`w\`: what the
 *  visibility stage reads alone, and the surface stage within \`impBlend\` — one expression, so both
 *  keep the same pixels. */
fn impColours(m:CardMaps,a:ImpTap,b:ImpTap,c:ImpTap,w:vec3f,lod:f32)->vec4f{
 return w.x*impColour(m,a.uv,lod)+w.y*impColour(m,b.uv,lod)+w.z*impColour(m,c.uv,lod);
}
/** The blended surface point, whose projection is the fragment depth, so other objects intersect
 *  the card where the mesh would. */
fn impPoint(a:ImpTap,b:ImpTap,c:ImpTap,w:vec3f)->vec3f{return w.x*a.point+w.y*b.point+w.z*c.point;}
struct ImpBlend{colour:vec4f,normal:vec3f,orm:vec3f,point:vec3f}
/** The blended card at the three taps \`a\`, \`b\`, \`c\` of weights \`w\`: colour, normal, ORM and the
 *  surface point. */
fn impBlend(m:CardMaps,a:ImpTap,b:ImpTap,c:ImpTap,w:vec3f,lod:f32)->ImpBlend{
 let colour=impColours(m,a,b,c,w,lod);
 let packed=w.x*impNormalDepth(m,a.uv,lod).xyz+w.y*impNormalDepth(m,b.uv,lod).xyz+w.z*impNormalDepth(m,c.uv,lod).xyz;
 let orm=w.x*impOrm(m,a.uv,lod).xyz+w.y*impOrm(m,b.uv,lod).xyz+w.z*impOrm(m,c.uv,lod).xyz;
 return ImpBlend(colour,normalize(unitToSigned3(packed)),orm,impPoint(a,b,c,w));
}`,
  )

/** The whole octahedral read of a card: the mapping, the card's view and the per-pixel tap, on the
 *  tile pool's reads `reads` (`../../webgpu/tile/cardReads.ts`). */
export const impostorCardWgsl = (reads: WgslDecl) =>
  wgslBlock(
    'IMPOSTOR_CARD_WGSL',
    [IMPOSTOR_MATH_WGSL, IMPOSTOR_VIEW_WGSL, impostorTapWgsl(reads)],
    '',
  )
