import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'

/** The words of a hit's record (`PtHit`): six `vec4u`. */
export const PT_HIT_WORDS = 24

/** The bytes of a hit's record. */
export const PT_HIT_BYTES = PT_HIT_WORDS * 4

/** What a path's bounce found, in the first bits of the record's last words (`PtHit.kind`). */
export const PT_HIT_KIND = {
  /** The ray met nothing: it escaped. */
  escaped: 0,
  /** The ray met a surface, whose material the shade of the hits gives. */
  surface: 1,
  /** The bounce traced nothing: the path ends here (the last bounce, with emissive surfaces off). */
  ended: 2,
} as const

/** The bit of the record's last words that says the ray met the front of the surface, then the one that says the triangle carries corner attributes, and the shift of the surface's class. */
const FRONT_BIT = 4
const ATTRIBUTED_BIT = 8
const CLASS_SHIFT = 8

/**
 * WHAT A BOUNCE FINDS OF A PATH'S RAY (`PtHit`, a record a path of the tile in `ptHits`, 96 bytes), written by the trace of the bounce and read by the shade of the hits and by the rest of the
 * bounce: the point (eye-relative, metres) and the distance, the geometric and the shading normals (octahedral, `snorm16`; the shading normal is the geometric one where the triangle
 * carries none), the texture coordinate, the triangle's two edges in the world and its two texture-coordinate edges (which the weights of the point
 * recover the corners from), the vertex colour, the weights of the second and third corners (whole floats: they rebuild the corners the material reads), the surface's record in the material table (`material`, the word a page row carries), its row flags, its
 * class key (`CLASS_KEY`, `materialClass.ts`) (`classKey`), whether the ray met the front and whether the triangle carries attributes (`attributed`).
 *
 * `ptPackHit` writes the six `vec4u`, `ptUnpackHit` reads them back; `ptHitKind` reads the kind alone, the one word the bounce's finish and the class passes test first.
 */
export const PT_HIT_WGSL = wgslBlock(
  'PT_HIT_WGSL',
  [octEncode, octDecode],
  `struct PtHit{kind:u32,position:vec3f,distance:f32,geoNormal:vec3f,normal:vec3f,uv:vec2f,edge1:vec3f,edge2:vec3f,colour:vec4f,uvEdge1:vec2f,uvEdge2:vec2f,bary:vec2f,material:u32,flags:u32,classKey:u32,front:bool,attributed:bool,}
fn ptPackHit(h:PtHit)->array<vec4u,6>{
 let word=h.kind|select(0u,${FRONT_BIT}u,h.front)|select(0u,${ATTRIBUTED_BIT}u,h.attributed)|(h.classKey<<${CLASS_SHIFT}u);
 return array<vec4u,6>(
  vec4u(bitcast<vec3u>(h.position),bitcast<u32>(h.distance)),
  vec4u(pack2x16snorm(octEncode(h.geoNormal)),pack2x16snorm(octEncode(h.normal)),bitcast<u32>(h.uv.x),bitcast<u32>(h.uv.y)),
  vec4u(bitcast<vec3u>(h.edge1),bitcast<u32>(h.bary.x)),
  vec4u(bitcast<vec3u>(h.edge2),pack4x8unorm(h.colour)),
  vec4u(bitcast<vec2u>(h.uvEdge1),bitcast<vec2u>(h.uvEdge2)),
  vec4u(h.material,h.flags,word,bitcast<u32>(h.bary.y)));
}
fn ptHitKind(a:vec4u)->u32{return a.z&3u;}
fn ptHitClass(a:vec4u)->u32{return a.z>>${CLASS_SHIFT}u;}
fn ptUnpackHit(a:array<vec4u,6>)->PtHit{
 var h:PtHit;
 h.kind=a[5].z&3u;
 h.front=(a[5].z&${FRONT_BIT}u)!=0u;
 h.attributed=(a[5].z&${ATTRIBUTED_BIT}u)!=0u;
 h.classKey=a[5].z>>${CLASS_SHIFT}u;
 h.position=bitcast<vec3f>(a[0].xyz);
 h.distance=bitcast<f32>(a[0].w);
 h.geoNormal=octDecode(unpack2x16snorm(a[1].x));
 h.normal=octDecode(unpack2x16snorm(a[1].y));
 h.uv=vec2f(bitcast<f32>(a[1].z),bitcast<f32>(a[1].w));
 h.edge1=bitcast<vec3f>(a[2].xyz);
 h.edge2=bitcast<vec3f>(a[3].xyz);
 h.colour=unpack4x8unorm(a[3].w);
 h.uvEdge1=bitcast<vec2f>(a[4].xy);
 h.uvEdge2=bitcast<vec2f>(a[4].zw);
 h.material=a[5].x;
 h.flags=a[5].y;
 h.bary=vec2f(bitcast<f32>(a[2].w),bitcast<f32>(a[5].w));
 return h;
}`,
)
