import { wgslBlock, wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import {
  BARYCENTRIC_MAX,
  PATTERN_FLIP,
  TABLE_DATA_WORD,
  TABLE_PO2_SIZE,
  TABLE_SIZE,
} from './contract.ts'

/**
 * A triangle's patches, as the shaders read them: a patch is a sub-triangle of a source triangle,
 * the barycentrics of its three corners each a fraction of `BARYCENTRIC_MAX` in 15 bits, two to a
 * word — the third is what is left —, and the pattern that cuts it is read from the table
 * (`table/build.ts`) at the binding `tess`, an `array<u32>` the host declares.
 */

/** A barycentric triple as the two 16-bit halves of a word: each rounded to the grid, the largest
 *  recomputed from the other two so that the three sum to the whole. */
export const encodeBarycentrics = wgslFn(
  'encodeBarycentrics',
  [],
  `fn encodeBarycentrics(b:vec3f)->u32{
 var r=round(b*${BARYCENTRIC_MAX}.0);
 if(r.x>max(r.y,r.z)){r.x=${BARYCENTRIC_MAX}.0-r.y-r.z;}
 else if(r.y>r.z){r.y=${BARYCENTRIC_MAX}.0-r.x-r.z;}
 else{r.z=${BARYCENTRIC_MAX}.0-r.x-r.y;}
 return u32(r.x)|(u32(r.y)<<16u);
}`,
)

/** The triple `encodeBarycentrics` wrote. */
export const decodeBarycentrics = wgslFn(
  'decodeBarycentrics',
  [],
  `fn decodeBarycentrics(e:u32)->vec3f{
 let x=f32(e&0xffffu)/${BARYCENTRIC_MAX}.0;let y=f32(e>>16u)/${BARYCENTRIC_MAX}.0;
 return vec3f(x,y,1.0-x-y);
}`,
)

/** A point of a patch (`local`, its barycentrics on the patch) on the source triangle: the corners
 *  `b0`, `b1`, `b2` of the patch weighed by it. */
export const patchBarycentrics = wgslFn(
  'patchBarycentrics',
  [],
  'fn patchBarycentrics(b0:vec3f,b1:vec3f,b2:vec3f,local:vec3f)->vec3f{return b0*local.x+b1*local.y+b2*local.z;}',
)

/**
 * How many pieces each edge of a patch is cut in, before they are rounded to a pattern: the edge's
 * length in the world over the depth of its nearer end — at least the near plane, one in an
 * orthographic view — times `lodScale`, the pixels a unit subtends at depth one per pixel an edge
 * is allowed (the cut's), times `invDiceRate`, the pixels an edge is allowed over the dicing rate;
 * a quarter of that where the edge lies farther than `lowDistance` (above 0), past which the
 * displacement has faded. `world` holds the three corners in the world, `depth` their depths.
 */
export const edgeFactors = wgslFn(
  'edgeFactors',
  [],
  `fn edgeFactors(world:mat3x3f,depth:vec3f,near:f32,perspective:bool,lodScale:f32,invDiceRate:f32,lowDistance:f32)->vec3f{
 var f=vec3f(0.0);var far=vec3f(1.0);
 for(var i=0u;i<3u;i++){
  let next=(i+1u)%3u;
  let scale=select(1.0,max(min(depth[i],depth[next]),near),perspective);
  f[i]=length(world[i]-world[next])/scale;
  if(perspective&&lowDistance>0.0&&scale>lowDistance){far[i]=0.25;}
 }
 return f*lodScale*invDiceRate*far;
}`,
)

/** The depth beyond which an edge is cut a quarter as finely: where the largest displacement
 *  (`absMax`, at the object's `scale`) subtends `fadeOut` pixels; zero without a fade. */
export const lowTessDistance = wgslFn(
  'lowTessDistance',
  [],
  `fn lowTessDistance(absMax:f32,scale:f32,lodScale:f32,fadeOut:f32)->f32{
 if(fadeOut==0.0){return 0.0;}
 return (absMax*scale*lodScale)/fadeOut;
}`,
)

/** The factors a triangle that is too large is first cut by: a fourteenth, which one pattern of the
 *  table then holds. */
export const splitFactors = wgslFn(
  'splitFactors',
  [],
  `fn splitFactors(f:vec3f)->vec3f{return f/${TABLE_SIZE}.0;}`,
)

/** A patch's edge factors turned for the table (`sortedFactors`): the factors, which corner of the
 *  patch each corner of the pattern is, whether the winding was reversed by the sort. */
const SORTED_FACTORS = wgslStruct(
  'SortedFactors',
  [],
  'struct SortedFactors{factors:vec3f,corners:vec3u,flip:bool,}',
)
/** A patch's edge factors rounded up into the table's range, turned so that the largest comes
 *  first and the other two follow in descending order. */
export const sortedFactors = wgslFn(
  'sortedFactors',
  [SORTED_FACTORS],
  `fn sortedFactors(requested:vec3f)->SortedFactors{
 var t=clamp(ceil(requested),vec3f(1.0),vec3f(${TABLE_SIZE}.0));
 let most=max(t.x,max(t.y,t.z));
 var c=vec3u(0u,1u,2u);
 if(t.y==most){c=c.yzx;t=t.yzx;}
 else if(t.z==most){c=c.zxy;t=t.zxy;}
 var flip=false;
 if(t.y<t.z){c=vec3u(c.y,c.x,c.z);t=vec3f(t.x,t.z,t.y);flip=true;}
 return SortedFactors(t,c,flip);
}`,
)

/** The pattern of sorted factors `f` (at least 1 each), as the table indexes it, and bit 12 when
 *  the sort flipped the winding. */
export const patternOf = wgslFn(
  'patternOf',
  [],
  `fn patternOf(f:vec3f,flip:bool)->u32{
 let index=u32(f.x+f.y*${TABLE_PO2_SIZE}.0+f.z*${TABLE_PO2_SIZE * TABLE_PO2_SIZE}.0-${1 + TABLE_PO2_SIZE + TABLE_PO2_SIZE * TABLE_PO2_SIZE}.0);
 return index|select(0u,${PATTERN_FLIP}u,flip);
}`,
)

/** A word of the `tess` buffer, the table's, the queue's, the lists': the program declares it as an
 *  `array<atomic<u32>>`, which a kernel that counts into it must, and every read goes by `atomicLoad`. */
export const tessWord = wgslFn('tw', [], 'fn tw(i:u32)->u32{return atomicLoad(&tess[i]);}')

/** A pattern as the table holds it: where its words start, and its pattern number with the counts
 *  of its vertices and triangles above it (`vertices << 13 | triangles << 22`). */
export const PATTERN_WGSL = wgslBlock(
  'PATTERN_WGSL',
  [decodeBarycentrics, tessWord],
  `struct Pattern{offset:u32,packed:u32,}
/** The pattern \`bits\` (\`patternOf\`) of the table. */
fn patternAt(bits:u32)->Pattern{
 let at=2u*(bits&0xfffu);
 return Pattern(tw(at),bits|tw(at+1u));
}
fn patternBits(p:Pattern)->u32{return p.packed&0x1fffu;}
fn patternVertices(p:Pattern)->u32{return (p.packed>>13u)&0x1ffu;}
fn patternTriangles(p:Pattern)->u32{return p.packed>>22u;}
/** Vertex \`i\` of the pattern: its barycentrics on the patch. */
fn patternVertex(p:Pattern,i:u32)->vec3f{return decodeBarycentrics(tw(${TABLE_DATA_WORD}u+p.offset+i));}
/** The three vertices of triangle \`t\` of the pattern, in the winding the patch has. */
fn patternCorners(p:Pattern,t:u32)->vec3u{
 let w=tw(${TABLE_DATA_WORD}u+p.offset+patternVertices(p)+t);
 let v=vec3u(w&1023u,(w>>10u)&1023u,(w>>20u)&1023u);
 return select(v,vec3u(v.x,v.z,v.y),(p.packed&${PATTERN_FLIP}u)!=0u);
}`,
)

/** A box by its low and high corners. */
export const BOX3 = wgslStruct('Box3', [], 'struct Box3{lo:vec3f,hi:vec3f,}')
/**
 * The box a patch's corners span, grown by what a displacement of `[dMin, dMax]` along normals in
 * the cone of axis `center` and half-angle cosine `coneCos` can move them: per axis, the extreme
 * of the displacement times the cone's cap over that axis, both ends and both signs.
 */
export const displaceBounds = wgslFn(
  'displaceBounds',
  [BOX3],
  `fn displaceBounds(center:vec3f,coneCos:f32,dMin:f32,dMax:f32,box:Box3)->Box3{
 let a=coneCos*abs(center);
 let b=sqrt(saturate(1.0-coneCos*coneCos)*saturate(1.0-center*center));
 let capMin=a-b;
 let capMax=select(a+b,vec3f(1.0),abs(center)>=vec3f(coneCos));
 let low=select(capMax,capMin,dMin>0.0)*dMin;
 let high=select(capMin,capMax,dMax>0.0)*dMax;
 let up=center>=vec3f(0.0);
 return Box3(box.lo+select(-high,low,up),box.hi+select(-low,high,up));
}`,
)
