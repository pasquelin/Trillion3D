import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TWO_PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { octCellsDecode } from '../../../../math/src/wgsl/octahedral.ts'
import {
  bitLength,
  bitWord,
  ceilDivWgsl,
  lowBits,
  pow2FromExponent,
} from '../../../../math/src/wgsl/integer.ts'
import {
  BLOCK_CORNERS,
  CENTIMETRES_PER_METRE,
  CLUSTER_HEADER_WORDS,
  COLOR_LEVELS,
  FLAG_COLOR,
  FLAG_NORMAL,
  FLAG_SKIN,
  FLAG_TANGENT,
  FLAG_UV,
  FLAG_UV2,
  FLAG_UV_EXTENDED,
  HEADER_UV_SETS,
  MAX_MORPH_TARGETS,
  MAX_UV_SETS,
  MORPH_WORDS,
  RESIDENT_TABLE_WORDS,
  TRIANGLE_BLOCK,
  UV_EXPONENT_BITS,
  UV_EXTENSION_WORDS,
  UV_MANTISSA_BITS,
  WIDTH_BITS,
} from '../../../../sdk-core/src/page/format.ts'
import { CLUSTER_HEADER_WGSL } from './headerWgsl.ts'

/** The table's words (\`Layout::table\`) the streams are read at: the block table, the three
 *  positions with the links and the normals fill words 0 to 3, then a word each texture set,
 *  two words the colours, the tangents and the skin last. */
const TABLE_UV = 4
const TABLE_COLOR = TABLE_UV + MAX_UV_SETS
const TABLE_TAIL = TABLE_COLOR + 2

/** The bits of a texture code's exponent and mantissa, below its sign: its mask. */
const UV_MAGNITUDE_BITS = UV_EXPONENT_BITS + UV_MANTISSA_BITS

/** The bit field, the position record, the unit, the texture-set flags and the streams. */
const fieldsWgsl = (
  buffer: string,
) => `// The \`bits\`-bit field at bit \`at\` of the page at word \`base\`.
fn clusterField(base:u32,at:u32,bits:u32)->u32{
 if(bits==0u){return 0u;}
 let shift=at&31u;let index=base+bitWord(at);
 var value=${buffer}[index]>>shift;
 if(shift+bits>32u){value|=${buffer}[index+1u]<<(32u-shift);}
 return value&lowBits(bits);
}
// The position record: six bits per width from bit 0, the precision as a signed byte on top.
fn clusterWidths(word:u32)->vec3u{return vec3u(word&63u,(word>>6u)&63u,(word>>12u)&63u);}
// The metres of a cell on that grid: 2^-precision centimetre, a hundredth of it in the one rounding
// of the unit, the power of two exact.
fn clusterUnit(word:u32)->f32{return pow2FromExponent(-(i32(word)>>24u))*${wgslF32(1 / CENTIMETRES_PER_METRE)};}
// The texture sets a page of flags \`flags\` carries, one bit a set by rank: the flags of sets 0 and 1
// are bits 1 and 2, those of sets 2 to 7 bits 9 to 14.
fn clusterUvSets(flags:u32)->u32{return ((flags>>${Math.log2(FLAG_UV)}u)&3u)|(((flags>>${Math.log2(FLAG_UV2)}u)&63u)<<2u);}
// Whether a page of flags \`flags\` carries texture set \`uvSet\`.
fn clusterHasUv(flags:u32,uvSet:u32)->bool{return ((clusterUvSets(flags)>>uvSet)&1u)!=0u;}
`

/** The header's corners and positions: what a raster reads of a row that draws no surface attribute. */
const pointHeaderWgsl = (
  buffer: string,
) => `// The offsets of a resident page's streams, two to a word: word \`k\` of its table, which closes
// the header, the morph records and the extension (\`RESIDENT_TABLE_WORDS\`, \`Layout::table\`).
fn clusterOffsets(base:u32,table:u32,k:u32)->vec2u{let w=${buffer}[base+table+k];return vec2u(w&0xffffu,w>>16u);}
// The header's corners and positions: what a raster reads of a row that draws no surface
// attribute, ten of the twenty-three words a whole header reads and three words of the table.
// \`links\` is where the link stream starts, present or not; \`clusterSurfaceHeader\` does the rest.
fn clusterPointHeader(base:u32)->ClusterHeader{
 var h:ClusterHeader;
 h.vertexCount=${buffer}[base+2u];h.indexCount=${buffer}[base+3u];h.flags=${buffer}[base+4u];
 let p=${buffer}[base+5u];h.posBits=clusterWidths(p);h.posUnit=clusterUnit(p);
 h.posStart=vec3i(i32(${buffer}[base+6u]),i32(${buffer}[base+7u]),i32(${buffer}[base+8u]));
 h.indexBits=bitLength(h.vertexCount-1u);
 h.prefixBits=bitLength(${buffer}[base+19u]/${BLOCK_CORNERS}u);
 h.recordBits=h.indexBits+${WIDTH_BITS}u+h.prefixBits;
 h.positionCount=${buffer}[base+20u];h.linkBits=bitLength(h.positionCount-1u);
 // Word 21: the joint width in bits 0 to 5, the target count in 6 to 13, the smallest joint above.
 let dw=${buffer}[base+21u];h.skinBits=dw&63u;h.morphCount=(dw>>6u)&${MAX_MORPH_TARGETS}u;h.skinBase=(dw>>14u)&0xffffu;
 h.table=${CLUSTER_HEADER_WORDS}u+${MORPH_WORDS}u*h.morphCount+${UV_EXTENSION_WORDS}u*countOneBits(h.flags&${FLAG_UV_EXTENDED}u);
 h.streams=h.table+${RESIDENT_TABLE_WORDS}u;
 let blocks=clusterOffsets(base,h.table,0u);let x=clusterOffsets(base,h.table,1u);let z=clusterOffsets(base,h.table,2u);
 h.blocks=blocks.x;h.corners=blocks.y;h.pos=vec3u(x.x,x.y,z.x);h.links=z.y;
 return h;
}
`

/** The rest of the header, the texture sets, and the whole header once per cluster. */
const surfaceHeaderWgsl = (
  buffer: string,
) => `// Range words of set \`s\`: header words 9 to 16 for sets 0 to 3, then a pair for each stored set past them, after the morph records.
fn clusterUvRange(base:u32,h:ClusterHeader,s:u32)->vec2u{
 if(s<${HEADER_UV_SETS}u){return vec2u(${buffer}[base+9u+2u*s],${buffer}[base+10u+2u*s]);}
 let below=(clusterUvSets(h.flags)>>${HEADER_UV_SETS}u)&((1u<<(s-${HEADER_UV_SETS}u))-1u);
 let at=base+${CLUSTER_HEADER_WORDS}u+${MORPH_WORDS}u*h.morphCount+${UV_EXTENSION_WORDS}u*countOneBits(below);
 return vec2u(${buffer}[at],${buffer}[at+1u]);
}
// The widths of a set's fields and their least codes from its range words: the least code above five bits of width.
fn clusterUvFields(r:vec2u)->ClusterUvSet{
 var o:ClusterUvSet;
 o.bitsX=r.x&31u;o.minX=r.x>>5u;o.bitsY=r.y&31u;o.minY=r.y>>5u;
 return o;
}
// Texture set \`s\` of the resident page at word \`base\`: its ranges and the word its two streams start
// at, read from the page when the set is read. A set the page does not store is zero.
fn clusterUvSet(h:ClusterHeader,base:u32,s:u32)->ClusterUvSet{
 var o:ClusterUvSet;
 if(!clusterHasUv(h.flags,s)){return o;}
 o=clusterUvFields(clusterUvRange(base,h,s));
 let at=clusterOffsets(base,h.table,${TABLE_UV}u+s);o.offX=at.x;o.offY=at.y;
 return o;
}
// The rest of the header after \`clusterPointHeader\`: flags, attribute grids and the streams after
// the links, each stream's offset loaded from the table, only for the attributes the page stores.
fn clusterSurfaceHeader(point:ClusterHeader,base:u32)->ClusterHeader{
 var h=point;
 // Word 17: the four least colour bytes, red lowest; word 18: their four widths of four bits, then
 // the precision of the normals and of the tangents in four bits each.
 let cm=${buffer}[base+17u];let cb=${buffer}[base+18u];
 h.colorMin=vec4u(cm&255u,(cm>>8u)&255u,(cm>>16u)&255u,cm>>24u);
 h.colorBits=vec4u(cb&15u,(cb>>4u)&15u,(cb>>8u)&15u,(cb>>12u)&15u);
 h.normalBits=(cb>>16u)&15u;h.tangentBits=(cb>>20u)&15u;
 h.influences=${buffer}[base+22u];
 if((h.flags&${FLAG_NORMAL}u)!=0u){h.normal=clusterOffsets(base,h.table,3u);}
 if((h.flags&${FLAG_COLOR}u)!=0u){
  let rg=clusterOffsets(base,h.table,${TABLE_COLOR}u);let ba=clusterOffsets(base,h.table,${TABLE_COLOR + 1}u);
  h.color=vec4u(rg.x,rg.y,ba.x,ba.y);
 }
 if((h.flags&${FLAG_TANGENT | FLAG_SKIN}u)!=0u){let tail=clusterOffsets(base,h.table,${TABLE_TAIL}u);h.tangent=tail.x;h.skin=tail.y;}
 return h;
}
// The whole header, once per cluster.
fn clusterHeader(base:u32)->ClusterHeader{return clusterSurfaceHeader(clusterPointHeader(base),base);}
`

/** The header of a page on disk, whose offsets follow from its counts and widths: what the install
 *  pass reads to lay the resident page out and to write its table (\`clusterTableWord\`). */
const diskHeaderWgsl = (
  buffer: string,
) => `// The word a stream of \`count\` fields of \`bits\` bits starts at; \`at\` moves past it when present.
fn clusterStream(present:bool,count:u32,bits:u32,at:ptr<function,u32>)->u32{
 let start=*at;
 if(present){*at+=ceilDiv(count*bits,32u);}
 return start;
}
// The word the streams of texture set \`s\` start at in a page on disk: behind the normals and the
// streams of the stored sets below it.
fn clusterDiskUvAt(h:ClusterHeader,base:u32,s:u32)->u32{
 var at=h.normal.y+select(0u,ceilDiv(h.vertexCount*h.normalBits,32u),(h.flags&${FLAG_NORMAL}u)!=0u);
 for(var t=0u;t<s;t++){
  if(clusterHasUv(h.flags,t)){let r=clusterUvRange(base,h,t);at+=ceilDiv(h.vertexCount*(r.x&31u),32u)+ceilDiv(h.vertexCount*(r.y&31u),32u);}
 }
 return at;
}
// Texture set \`s\` of a page on disk: its streams one after the other from \`clusterDiskUvAt\`, a set
// the page does not carry empty where the next one would start.
fn clusterDiskUvSet(h:ClusterHeader,base:u32,s:u32)->ClusterUvSet{
 var o:ClusterUvSet;
 if(clusterHasUv(h.flags,s)){o=clusterUvFields(clusterUvRange(base,h,s));}
 o.offX=clusterDiskUvAt(h,base,s);
 o.offY=o.offX+ceilDiv(h.vertexCount*o.bitsX,32u);
 return o;
}
// The header of a page on disk, every stream's offset the chain of the counts and widths in the
// format's order — a stream the page does not carry starts where the next one would —, the same
// words and the same arithmetic as \`Layout::of\`.
fn clusterDiskHeader(base:u32)->ClusterHeader{
 var h:ClusterHeader;
 h.vertexCount=${buffer}[base+2u];h.indexCount=${buffer}[base+3u];h.flags=${buffer}[base+4u];
 let p=${buffer}[base+5u];h.posBits=clusterWidths(p);h.posUnit=clusterUnit(p);
 h.posStart=vec3i(i32(${buffer}[base+6u]),i32(${buffer}[base+7u]),i32(${buffer}[base+8u]));
 h.indexBits=bitLength(h.vertexCount-1u);
 let cornerBits=${buffer}[base+19u];
 h.prefixBits=bitLength(cornerBits/${BLOCK_CORNERS}u);
 h.recordBits=h.indexBits+${WIDTH_BITS}u+h.prefixBits;
 h.positionCount=${buffer}[base+20u];h.linkBits=bitLength(h.positionCount-1u);
 let dw=${buffer}[base+21u];h.skinBits=dw&63u;h.morphCount=(dw>>6u)&${MAX_MORPH_TARGETS}u;h.skinBase=(dw>>14u)&0xffffu;
 let cm=${buffer}[base+17u];let cb=${buffer}[base+18u];
 h.colorMin=vec4u(cm&255u,(cm>>8u)&255u,(cm>>16u)&255u,cm>>24u);
 h.colorBits=vec4u(cb&15u,(cb>>4u)&15u,(cb>>8u)&15u,(cb>>12u)&15u);
 h.normalBits=(cb>>16u)&15u;h.tangentBits=(cb>>20u)&15u;
 h.influences=${buffer}[base+22u];
 let stored=h.positionCount;
 var at=${CLUSTER_HEADER_WORDS}u+${MORPH_WORDS}u*h.morphCount+${UV_EXTENSION_WORDS}u*countOneBits(h.flags&${FLAG_UV_EXTENDED}u);h.streams=at;
 h.blocks=clusterStream(true,ceilDiv(h.indexCount/3u,${TRIANGLE_BLOCK}u),h.recordBits,&at);
 h.corners=clusterStream(true,cornerBits,1u,&at);
 h.pos.x=clusterStream(true,stored,h.posBits.x,&at);h.pos.y=clusterStream(true,stored,h.posBits.y,&at);h.pos.z=clusterStream(true,stored,h.posBits.z,&at);
 h.links=at;
 let n=h.vertexCount;
 clusterStream(h.positionCount<n,n,h.linkBits,&at);
 let hasNormal=(h.flags&${FLAG_NORMAL}u)!=0u;
 h.normal.x=clusterStream(hasNormal,n,h.normalBits,&at);h.normal.y=clusterStream(hasNormal,n,h.normalBits,&at);
 at=clusterDiskUvAt(h,base,${MAX_UV_SETS}u);
 let hasColor=(h.flags&${FLAG_COLOR}u)!=0u;h.color.x=clusterStream(hasColor,n,h.colorBits.x,&at);h.color.y=clusterStream(hasColor,n,h.colorBits.y,&at);
 h.color.z=clusterStream(hasColor,n,h.colorBits.z,&at);h.color.w=clusterStream(hasColor,n,h.colorBits.w,&at);
 h.tangent=clusterStream((h.flags&${FLAG_TANGENT}u)!=0u,n,h.tangentBits+1u,&at);
 h.skin=at;
 return h;
}
// Offset \`k\` of the table (the order of \`Layout::table\`) of a page whose disk header is \`h\`, in the
// resident page: the table sits behind the header, so every stream moves by its words. A page of the format's
// bounds never passes the 16 bits it is held in (\`MAX_TABLE_OFFSET\`); the install pass refuses one that would.
fn clusterTableOffset(h:ClusterHeader,base:u32,k:u32)->u32{
 var at:u32;
 if(k<2u){at=select(h.blocks,h.corners,k==1u);}
 else if(k<5u){at=h.pos[k-2u];}
 else if(k==5u){at=h.links;}
 else if(k<8u){at=h.normal[k-6u];}
 else if(k<${TABLE_COLOR * 2}u){let o=clusterDiskUvSet(h,base,(k-8u)>>1u);at=select(o.offX,o.offY,((k-8u)&1u)!=0u);}
 else if(k<${TABLE_TAIL * 2}u){at=h.color[k-${TABLE_COLOR * 2}u];}
 else{at=select(h.tangent,h.skin,k==${TABLE_TAIL * 2 + 1}u);}
 return at+${RESIDENT_TABLE_WORDS}u;
}
// Word \`i\` of the resident page's table, written by the install pass: offsets \`2i\` and \`2i+1\`.
fn clusterTableWord(h:ClusterHeader,base:u32,i:u32)->u32{return clusterTableOffset(h,base,2u*i)|(clusterTableOffset(h,base,2u*i+1u)<<16u);}
`

/** The window of two words, the block of a triangle, its corners and its indices. */
const triangleWgsl = (
  buffer: string,
) => `// Bits \`at\` to \`at+bits\` of the two words \`lo\`, \`hi\` read as one 64-bit window, \`bits\` at most 24.
fn clusterWindow(lo:u32,hi:u32,at:u32,bits:u32)->u32{
 if(bits==0u){return 0u;}
 var value=hi>>(at&31u);
 if(at<32u){value=lo>>at;if(at+bits>32u){value|=hi<<(32u-at);}}
 return value&lowBits(bits);
}
// The record of triangle \`tri\`'s block, from the two words it starts in: the block's base, its
// width, and the bit of the corner stream its first corner lies at. Only a prefix that leaves
// the window — a record past 33 bits, a page far beyond a meshlet — reads a third word.
fn clusterBlock(h:ClusterHeader,base:u32,tri:u32)->vec3u{
 let at=(tri/${TRIANGLE_BLOCK}u)*h.recordBits;let word=base+h.blocks+bitWord(at);let s=at&31u;
 let lo=${buffer}[word];let hi=${buffer}[word+1u];
 let p=s+h.indexBits+${WIDTH_BITS}u;
 var prefix=clusterWindow(lo,hi,p,h.prefixBits);
 if(p+h.prefixBits>64u){prefix=clusterField(base+h.blocks,at+h.indexBits+${WIDTH_BITS}u,h.prefixBits);}
 return vec3u(clusterWindow(lo,hi,s,h.indexBits),clusterWindow(lo,hi,s+h.indexBits,${WIDTH_BITS}u),prefix*${BLOCK_CORNERS}u);
}
// Local vertex indices of triangle \`tri\`: its block's base plus each corner's distance to it,
// the record read once for the three.
fn clusterTriangle(h:ClusterHeader,base:u32,tri:u32)->vec3u{
 let b=clusterBlock(h,base,tri);let at=b.z+(tri%${TRIANGLE_BLOCK}u)*3u*b.y;let stream=base+h.corners;
 return b.x+vec3u(clusterField(stream,at,b.y),clusterField(stream,at+b.y,b.y),clusterField(stream,at+2u*b.y,b.y));
}
// Local vertex index of corner \`corner\` (three per triangle).
fn clusterIndex(h:ClusterHeader,base:u32,corner:u32)->u32{
 let b=clusterBlock(h,base,corner/3u);
 return b.x+clusterField(base+h.corners,b.z+(corner%${BLOCK_CORNERS}u)*b.y,b.y);
}
`

/** A vertex's position, texture coordinates and normal. */
const attributesWgsl =
  () => `// A vertex's position: its own, or the one its link names when the page stores each once. Each cell
// is the page's start plus the stored offset, converted to a float and multiplied by the unit.
fn clusterPosition(h:ClusterHeader,base:u32,vertex:u32)->vec3f{
 var at=vertex;
 if(h.positionCount<h.vertexCount){at=clusterField(base+h.links,vertex*h.linkBits,h.linkBits);}
 let offset=vec3i(i32(clusterField(base+h.pos.x,at*h.posBits.x,h.posBits.x)),
  i32(clusterField(base+h.pos.y,at*h.posBits.y,h.posBits.y)),
  i32(clusterField(base+h.pos.z,at*h.posBits.z,h.posBits.z)));
 return vec3f(h.posStart+offset)*h.posUnit;
}
// The coordinate a texture code stands for: its exponent and mantissa, below the sign, set the float
// from one half up, stretched so that the first binade [0.5, 1] covers [0, 1]; a negative code
// holds the inverted bits.
fn clusterUvValue(code:u32)->f32{
 let mask=${(1 << UV_MAGNITUDE_BITS) - 1}u;
 let negative=code<=mask;
 let magnitude=select(code,~code,negative)&mask;
 let halfUp=bitcast<f32>(0x3f000000u+(magnitude<<${23 - UV_MANTISSA_BITS}u));
 let value=min(halfUp*2.0-1.0,halfUp);
 return select(value,-value,negative);
}
// A vertex's coordinate in texture set \`t\` (\`clusterUvSet\`) of the page at \`base\`.
fn clusterUvAt(t:ClusterUvSet,base:u32,vertex:u32)->vec2f{
 return vec2f(clusterUvValue(t.minX+clusterField(base+t.offX,vertex*t.bitsX,t.bitsX)),
  clusterUvValue(t.minY+clusterField(base+t.offY,vertex*t.bitsY,t.bitsY)));
}
// Texture set \`uvSet\` of a vertex.
fn clusterUv(h:ClusterHeader,base:u32,vertex:u32,uvSet:u32)->vec2f{return clusterUvAt(clusterUvSet(h,base,uvSet),base,vertex);}
fn clusterNormal(h:ClusterHeader,base:u32,vertex:u32)->vec3f{
 let b=h.normalBits;
 return octCellsDecode(vec2u(clusterField(base+h.normal.x,vertex*b,b),clusterField(base+h.normal.y,vertex*b,b)),b);
}
`

/** The stored tangent, the skin, the morph targets and the colour. */
const skinMorphColorWgsl = (
  buffer: string,
) => `// The stored tangent of a page that carries it (\`FLAG_TANGENT\`): its angle around the vertex's
// decoded normal, a turn in 2^\`tangentBits\` steps, in a plane whose axes the normal fixes — x and z
// traded when |z| > |x|, the axis (−y, x, 0) and the normal crossed with it, both left of their
// length, which scales the cosine and the sine instead —, and its bitangent's sign on the bit above.
fn clusterTangent(h:ClusterHeader,base:u32,vertex:u32)->vec4f{
 let bits=h.tangentBits;
 let q=clusterField(base+h.tangent,vertex*(bits+1u),bits+1u);
 let n=clusterNormal(h,base,vertex);
 let swap=abs(n.z)>abs(n.x);
 let z=select(n,n.zyx,swap);
 let axisX=vec3f(-z.y,z.x,0.0);let axisY=cross(z,axisX);
 let inverse=1.0/sqrt(axisX.x*axisX.x+axisX.y*axisX.y);
 let angle=f32(q&lowBits(bits))*(TWO_PI/f32(1u<<bits));
 let t=axisX*(cos(angle)*inverse)+axisY*(sin(angle)*inverse);
 return vec4f(select(t,t.zyx,swap),select(1.0,-1.0,((q>>bits)&1u)!=0u));
}
// Every influence is retained; weight words are exact source float32 bits.
fn clusterJoint(h:ClusterHeader,base:u32,vertex:u32,influence:u32)->u32{
 let w=ceilDiv(h.vertexCount*h.skinBits,32u);
 return h.skinBase+clusterField(base+h.skin+influence*w,vertex*h.skinBits,h.skinBits);
}
fn clusterWeight(h:ClusterHeader,base:u32,vertex:u32,influence:u32)->f32{
 let w=ceilDiv(h.vertexCount*h.skinBits,32u);
 return bitcast<f32>(${buffer}[base+h.skin+h.influences*w+influence*h.vertexCount+vertex]);
}
// Morph target \`t\`'s position displacement (\`normal\` false) or normal displacement of a vertex:
// its record after the header names the word its six streams start at.
fn clusterMorph(h:ClusterHeader,base:u32,t:u32,vertex:u32,normal:bool)->vec3f{
 let r=base+${CLUSTER_HEADER_WORDS}u+t*${MORPH_WORDS}u;let n=h.vertexCount;
 let at=base+h.streams+${buffer}[r]+select(0u,3u*n,normal)+vertex;
 return vec3f(bitcast<f32>(${buffer}[at]),bitcast<f32>(${buffer}[at+n]),bitcast<f32>(${buffer}[at+2u*n]));
}
// A vertex's colour: each channel's byte, its least plus the stored offset, over 255.
fn clusterColor(h:ClusterHeader,base:u32,vertex:u32)->vec4f{
 let b=h.colorBits;
 let bytes=vec4u(h.colorMin.x+clusterField(base+h.color.x,vertex*b.x,b.x),
  h.colorMin.y+clusterField(base+h.color.y,vertex*b.y,b.y),
  h.colorMin.z+clusterField(base+h.color.z,vertex*b.z,b.z),
  h.colorMin.w+clusterField(base+h.color.w,vertex*b.w,b.w));
 return vec4f(bytes)*${wgslF32(1 / COLOR_LEVELS)};
}`

/**
 * WGSL decode of a `WGP3` quantized cluster page read in place from a storage buffer of words
 * (`docs/FORMAT.md`): the header once per cluster, then any vertex or corner by rank, in O(1)
 * — a field never spans more than two words, and a triangle is its block's record, read once, and
 * three fields. The arithmetic is the format's, operation for operation — a position is its cell,
 * converted to a float, times the grid's unit, a colour its byte times 1/255, a texture
 * coordinate its float code's exponent and mantissa set in a float's bits —, so a decoded value is
 * the 32-bit float the shared Rust codec and `../codec/geometryPage.ts` decode (the cell's
 * conversion exact up to 2^24 cells, and rounded by the device past them); a normal, which goes
 * through `normalize`, agrees to the ULP tolerance WGSL grants that builtin, and a stored tangent,
 * through `cos`, `sin` and `normalize`, to theirs.
 *
 * The host declares the buffer and names it: `clusterDecodeWgsl('pageWords')` binds every routine
 * to `pageWords:array<u32>`.
 */
export function clusterDecodeWgsl(buffer: string) {
  return wgslBlock(
    `clusterDecodeWgsl(${buffer})`,
    [
      TWO_PI,
      octCellsDecode,
      CLUSTER_HEADER_WGSL,
      bitLength,
      ceilDivWgsl,
      pow2FromExponent,
      lowBits,
      bitWord,
    ],
    [
      fieldsWgsl,
      pointHeaderWgsl,
      surfaceHeaderWgsl,
      triangleWgsl,
      attributesWgsl,
      skinMorphColorWgsl,
    ]
      .map((part) => part(buffer))
      .join(''),
  )
}

/** The header of a page on disk and the table of the resident page's offsets that follows from it
 *  (`clusterDiskHeader`, `clusterTableWord`), beside the decode of the same buffer: only the install
 *  pass that transcodes a page reads a page on disk, so no other shader carries them. */
export function clusterDiskDecodeWgsl(buffer: string) {
  return wgslBlock(
    `clusterDiskDecodeWgsl(${buffer})`,
    [clusterDecodeWgsl(buffer), bitLength, ceilDivWgsl],
    diskHeaderWgsl(buffer),
  )
}
