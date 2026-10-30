import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { ceilDivWgsl, lowBits } from '../../../../../math/src/wgsl/integer.ts'
import {
  BLOCK_CORNERS,
  DISK_HEADER_WORDS,
  FLAG_COLOR,
  FLAG_NORMAL,
  FLAG_SKIN,
  FLAG_TANGENT,
  GEOMETRY_PAGE_RESIDENT_VERSION,
  MAX_PAGE_CORNERS,
  MAX_PAGE_TRIANGLES,
  MAX_PAGE_VERTICES,
  MAX_UV_SETS,
  NO_UNIT,
  REF_PLACE_BITS,
  RESIDENT_TABLE_WORDS,
  SELF_PLACE,
  STRIP_REF_BITS,
  TRIANGLE_BLOCK,
  WIDTH_BITS,
} from '../../../../../sdk-core/src/page/format.ts'
import { clusterDecodeWgsl, clusterDiskDecodeWgsl } from '../../cluster/decodeWgsl.ts'

/** The lanes of a workgroup: one workgroup transcodes one page, a lane a field at a time. */
const PAGE_TRANSCODE_WORKGROUP = 64

/** The words of one job in the job table: the page's first word in the staging buffer, the word it
 *  is written at in the pool, the words it may take there, the words it takes on disk — read by no
 *  pass, only by the test kit's replay of them —, the word of the pool its streaming page starts
 *  at, and where in the dependencies table the starts of the streaming pages its streaming page
 *  depends on are, and how many. */
export const PAGE_JOB_WORDS = 7

/** The levels the passes of one submit take at most: a page installs a level after the last of the
 *  staged streaming pages it names vertices of (`installer.ts`, a longer chain goes in turns). */
export const PAGE_INSTALL_LEVELS = 16

/** The words that open the job table: the first job of each level, and the end of the last. */
export const PAGE_JOBS_HEADER_WORDS = PAGE_INSTALL_LEVELS + 1

/** The most blocks of triangles a page holds, `TRIANGLE_BLOCK` triangles each, and the most values a
 *  stream of a page holds: the corners, or the vertices. */
const MAX_BLOCKS = ceilDiv(MAX_PAGE_TRIANGLES, TRIANGLE_BLOCK)
const MAX_VALUES = Math.max(MAX_PAGE_CORNERS, MAX_PAGE_VERTICES)

/**
 * What both passes of the install share: the bindings, the job table, the lanes' scan of the
 * running sums of a stream's zig-zag deltas, and the vertices a page names.
 *
 * The bindings: `src`, the staging buffer of the pages on disk; `jobs`, the job table — the first
 * job of each level, then the jobs sorted by level, `PAGE_JOB_WORDS` words each —; `dst`, the pool;
 * `deps`, the start in the pool of each streaming page a job's page depends on, by rank in its
 * list; `level`, the level a dispatch of the second pass installs (a dynamic offset).
 *
 * A page is read from the staging buffer, at the word its job names, and written into the pool at
 * the word the job gives. The values that decide how often a workgroup reaches a barrier are read
 * from the read-only buffers at words the whole workgroup shares, or held by its first lane and read
 * back uniform (`workgroupUniformLoad`) — never taken from a read of the pool, which the passes write.
 */
const PAGE_INSTALL_COMMON = wgslBlock(
  'PAGE_INSTALL_COMMON',
  [ceilDivWgsl, lowBits],
  `const RESIDENT_VERSION=${GEOMETRY_PAGE_RESIDENT_VERSION}u;
const JOB_WORDS=${PAGE_JOB_WORDS}u;
const JOBS_HEADER=${PAGE_JOBS_HEADER_WORDS}u;
const NO_UNIT=${NO_UNIT}u;
struct Job{src:u32,dst:u32,room:u32,length:u32,unit:u32,depsAt:u32,depsCount:u32,}
struct Level{value:u32,}
@group(0) @binding(0) var<storage,read> src:array<u32>;
@group(0) @binding(1) var<storage,read> jobs:array<u32>;
@group(0) @binding(2) var<storage,read_write> dst:array<u32>;
@group(0) @binding(3) var<storage,read> deps:array<u32>;
@group(0) @binding(4) var<uniform> level:Level;
var<workgroup> vals:array<u32,${MAX_VALUES}>;
var<workgroup> sums:array<u32,${PAGE_TRANSCODE_WORKGROUP}>;
var<workgroup> carry:u32;
// Job \`i\` of the table: sorted by level, so the jobs of one level lie together.
fn readJob(i:u32)->Job{
 let at=JOBS_HEADER+i*JOB_WORDS;
 return Job(jobs[at],jobs[at+1u],jobs[at+2u],jobs[at+3u],jobs[at+4u],jobs[at+5u],jobs[at+6u]);
}
// One stream of a page on disk: \`count\` fields of \`comps\` components of \`bits\` bits each, \`bytes\`
// bytes a value in the planes from \`cursor\` (bytes from the page's first), the first delta counted
// from \`start\`, each component's stream written at the word \`at\` of the page \`out\` in the pool.
// A \`sparse\` stream holds the fields of the vertices the page stores, \`n\` its vertices in all.
struct PageRun{count:u32,comps:u32,bytes:u32,page:u32,out:u32,n:u32,sparse:u32,cursor:vec3u,bits:vec4u,start:vec4u,at:vec4u,}
// Byte \`byte\` of the staging buffer.
fn planeByte(byte:u32)->u32{return (src[byte>>2u]>>((byte&3u)*8u))&255u;}
// The part of the \`bits\`-bit \`value\`, set at bit \`at\` of a word, that falls in the word whose
// first bit is bit 0: \`at\` is negative for a value begun in the word before.
fn placed(at:i32,value:u32,bits:u32)->u32{
 if(bits==0u||at>=32){return 0u;}
 if(at>=0){return value<<u32(at);}
 if(at+i32(bits)<=0){return 0u;}
 return value>>u32(-at);
}
// Component \`c\` of the stream into \`vals\`: its fields' running sums of zig-zag deltas, \`bits\` wide.
// The lanes read a chunk of fields a time and scan it, \`carry\` the sum of the chunks before.
fn decodeComponent(run:PageRun,c:u32,lid:u32){
 if(lid==0u){carry=run.start[c];}
 workgroupBarrier();
 let mask=lowBits(run.bits[c]);
 for(var chunk=0u;chunk<ceilDiv(run.count,${PAGE_TRANSCODE_WORKGROUP}u);chunk++){
  let i=chunk*${PAGE_TRANSCODE_WORKGROUP}u+lid;
  var delta=0u;
  if(i<run.count&&run.bytes>0u){
   let at=i*run.comps+c;
   var code=planeByte(run.page+run.cursor.x+at);
   if(run.bytes>1u){code|=planeByte(run.page+run.cursor.y+at)<<8u;}
   if(run.bytes>2u){code|=planeByte(run.page+run.cursor.z+at)<<16u;}
   delta=(code>>1u)^(0u-(code&1u));
  }
  sums[lid]=delta;
  workgroupBarrier();
  for(var stride=1u;stride<${PAGE_TRANSCODE_WORKGROUP}u;stride=stride<<1u){
   var before=0u;
   if(lid>=stride){before=sums[lid-stride];}
   workgroupBarrier();
   sums[lid]=sums[lid]+before;
   workgroupBarrier();
  }
  if(i<run.count){vals[i]=(carry+sums[lid])&mask;}
  workgroupBarrier();
  if(lid==${PAGE_TRANSCODE_WORKGROUP - 1}u){carry=carry+sums[lid];}
  workgroupBarrier();
 }
}
// Whether vertex \`v\` is one the page names, in the bits that say so, from the word \`flags\` of the
// staging buffer; and how many of the vertices before it are.
fn vertexNamed(flags:u32,v:u32)->bool{return ((src[flags+(v>>5u)]>>(v&31u))&1u)!=0u;}
fn namedRank(flags:u32,v:u32)->u32{
 var count=0u;
 for(var k=0u;k<(v>>5u);k++){count+=countOneBits(src[flags+k]);}
 return count+countOneBits(src[flags+(v>>5u)]&((1u<<(v&31u))-1u));
}`,
)

/**
 * THE FIRST INSTALL PASS: one workgroup a page, which writes the resident page the shaders read in
 * place (`../../cluster/decodeWgsl.ts`) from the page on disk (`docs/FORMAT.md`, Pages; its CPU
 * twin is `resident::expand_in`, `page-codec-wasm/src/resident.rs`, which the tests compare it
 * to), but for the vertices the page names, which the second pass copies (`PAGE_LINK_WGSL`).
 *
 * The header and the morph records are copied, their version word the resident layout's; the
 * layout of every stream follows from the header's counts and widths, read once by the decoding's
 * own `clusterDiskHeader`, never from the page's words; the table of their offsets (`clusterTableWord`) closes the header and records, and every stream lies behind it. The triangles are the strips' (the code is
 * read as `unpack_triangle` reads it, triangle by triangle: its masks, the counts of the words
 * before, the distances of the vertices it names). The corners then give each eight triangles
 * their least corner and the width of their distances to it, and the block table and the corner
 * stream are written from them. Every other stream is read as it was written (`disk.rs`): a
 * component at a time, its fields' zig-zag deltas read from the byte planes by the lanes — one
 * field each, a chunk of the workgroup's width at a time —, summed by a scan with the sum of the
 * chunks before it, each running sum masked to the field's width. The values lie in workgroup
 * memory, from which each lane then writes whole words of the stream, each vertex the page stores
 * at its own place: no word is shared between lanes, so no atomic and no clearing of the slot, and
 * the bits of a vertex the page names, and past a stream's last field, are zero. The skin's and the
 * morph targets' words are copied as they are. A page whose resident words would pass the room its
 * job gives is skipped, left unwritten but for its version word, zeroed when the room holds it: the
 * second pass installs the pages whose version word it finds written.
 */
export const PAGE_TRANSCODE_WGSL = wgslProgram(
  `struct Uni{n:u32,nc:u32,positions:u32,flags:u32,named:u32,fits:u32,}
var<workgroup> uni:Uni;
var<workgroup> storedRank:array<u32,${MAX_PAGE_VERTICES}>;
var<workgroup> blockBase:array<u32,${MAX_BLOCKS}>;
var<workgroup> blockWidth:array<u32,${MAX_BLOCKS}>;
var<workgroup> blockPrefix:array<u32,${MAX_BLOCKS}>;
// The planes' cursor past a stream of \`size\` values of \`bytes\` bytes.
fn advance(cursor:vec3u,size:u32,bytes:u32)->vec3u{
 return vec3u(cursor.x+select(0u,size,bytes>0u),cursor.y+select(0u,size,bytes>1u),cursor.z+select(0u,size,bytes>2u));
}
// The words of the \`count\` values of \`vals\`, \`bits\` wide, at the word \`at\` of the pool.
fn packValues(at:u32,count:u32,bits:u32,lid:u32){
 if(bits==0u){return;}
 for(var w=lid;w<ceilDiv(count*bits,32u);w+=${PAGE_TRANSCODE_WORKGROUP}u){
  var word=0u;
  let last=min(count-1u,(w*32u+31u)/bits);
  for(var j=(w*32u)/bits;j<=last;j++){word|=placed(i32(j*bits)-i32(w*32u),vals[j],bits);}
  dst[at+w]=word;
 }
}
// The words of a stream of \`n\` fields, one a vertex, \`bits\` wide: the vertices the page stores take
// the values of \`vals\` in their order, the vertices it names none.
fn packVertices(at:u32,n:u32,bits:u32,flags:u32,lid:u32){
 if(bits==0u){return;}
 for(var w=lid;w<ceilDiv(n*bits,32u);w+=${PAGE_TRANSCODE_WORKGROUP}u){
  var word=0u;
  let last=min(n-1u,(w*32u+31u)/bits);
  for(var j=(w*32u)/bits;j<=last;j++){
   if(!vertexNamed(flags,j)){word|=placed(i32(j*bits)-i32(w*32u),vals[storedRank[j]],bits);}
  }
  dst[at+w]=word;
 }
}
// Every component of the stream, read and written; one of no bits has no field to write.
fn installRun(run:PageRun,lid:u32,flags:u32){
 for(var c=0u;c<run.comps;c++){
  if(run.bits[c]==0u){continue;}
  decodeComponent(run,c,lid);
  if(run.sparse!=0u){packVertices(run.out+run.at[c],run.n,run.bits[c],flags,lid);}
  else{packValues(run.out+run.at[c],run.count,run.bits[c],lid);}
 }
}
// The stream of \`count\` fields of \`comps\` components, as \`runOf\` reads it from the planes at \`cursor\`.
fn runOf(count:u32,comps:u32,bits:vec4u,start:vec4u,at:vec4u,cursor:vec3u,page:u32,out:u32,n:u32,sparse:u32)->PageRun{
 var run:PageRun;
 run.count=count;run.comps=comps;run.page=page;run.out=out;run.n=n;run.sparse=sparse;
 run.bytes=ceilDiv(max(max(bits.x,bits.y),max(bits.z,bits.w)),8u);
 run.cursor=cursor;run.bits=bits;run.start=start;run.at=at;
 return run;
}
// Bit \`at\` of a word of masks.
fn stripBit(mask:u32,at:u32)->u32{return (mask>>(at&31u))&1u;}
// The vertices named and laid by the triangles of a word of masks before the one at bit \`at\`.
fn stripCounts(s:u32,sl:u32,w:u32,at:u32)->vec2u{
 let below=(1u<<(at&31u))-1u;
 let named=2u*countOneBits(sl&below)+countOneBits(w&below);
 return vec2u(named,2u*countOneBits(s&below)+(at&31u)-named);
}
// Field \`at\` of the strips' distances, which start at the word \`distAt\` of the staging buffer: zero
// before the first.
fn stripField(distAt:u32,at:i32)->u32{
 if(at<0){return 0u;}
 let bit=u32(at)*${STRIP_REF_BITS}u;let word=distAt+(bit>>5u);let shift=bit&31u;
 var value=src[word]>>shift;
 if(shift+${STRIP_REF_BITS}u>32u){value|=src[word+1u]<<(32u-shift);}
 return value&${(1 << STRIP_REF_BITS) - 1}u;
}
// The laid indices of the three corners of triangle \`t\`, read as \`unpack_triangle\`
// (\`page-codec-wasm/src/clusters/strip.rs\`) reads them: the masks of its word of 32 triangles at
// the word \`masksAt\`, the vertices named and laid before each word (\`namedWords\`, \`laidWords\`, ten
// bits each) and the distances. A bit mask is all bits or none where it says yes.
fn stripTriangle(t:u32,masksAt:u32,namedWords:u32,laidWords:u32,distAt:u32)->vec3u{
 let word=t>>5u;let bit=t&31u;
 let s=src[masksAt+word*3u];let l=src[masksAt+word*3u+1u];let w=src[masksAt+word*3u+2u];
 let sl=s&l;
 let headNamed=(sl|~s)&w;
 var namedBefore=0u;var laidBefore=0u;
 if(word>0u){namedBefore=(namedWords>>(word*10u-10u))&1023u;laidBefore=(laidWords>>(word*10u-10u))&1023u;}
 let here=stripCounts(s,sl,w,bit);
 let namedTo=namedBefore+here.x;let laidTo=laidBefore+here.y;
 let isStart=0u-stripBit(s,bit);let isLeft=0u-stripBit(l,bit);let isNamed=0u-stripBit(w,bit);
 let base=laidTo-1u;
 let first=i32(namedTo)+select(-1,0,isStart!=0u);
 if(isStart!=0u){
  let named=2u*(isLeft&1u)+(isNamed&1u);
  var nextLaid=laidTo;var out=vec3u(0u);
  for(var k=0u;k<3u;k++){
   if(k<named){out[k]=base-stripField(distAt,first+i32(k));}
   else{out[k]=nextLaid;nextLaid++;}
  }
  return out;
 }
 // A growth: its first two vertices are the edge it grew across, its third is laid anew or named.
 let previous=bit-1u;
 let previousStart=0u-stripBit(s,previous);
 let previousHead=0u-stripBit(headNamed,previous);
 let laidByPrevious=previousStart&(3u-((stripBit(l,previous)<<1u)|stripBit(w,previous)));
 let v1=base+(previousHead&(laidByPrevious-stripField(distAt,first)));
 let v2=laidTo+(isNamed&(0xffffffffu-stripField(distAt,first+1)));
 // The third is found at the nearest triangle before this one laid right of it, for a left growth,
 // or left of it, for a right one — or a start.
 let masked=(s|(l^isLeft))&((1u<<bit)-1u);
 var found=0u;
 if(masked!=0u){found=31u-countLeadingZeros(masked);}
 let foundStart=0u-stripBit(s,found);
 let there=stripCounts(s,sl,w,found);
 let foundLaid=laidBefore+there.y;let foundNamed=namedBefore+there.x;
 let foundCount=(stripBit(l,found)<<1u)+stripBit(w,found);
 var headBefore=0u;
 if(found!=0u){headBefore=stripBit(headNamed,found-1u);}
 let leftI=select(0,-1,isLeft!=0u);
 let readOffset=select(1,leftI,foundStart!=0u);
 let foundIndex=foundLaid-1u-stripField(distAt,i32(foundNamed)-readOffset);
 let condition=select(headBefore!=0u,i32(foundCount)>=1-leftI,foundStart!=0u);
 let foundNew=select(foundLaid-1u,foundLaid+(isLeft&select(0u,1u,foundCount==0u)),foundStart!=0u);
 let v0=select(foundNew,foundIndex,condition);
 if(isLeft!=0u){return vec3u(v0,v2,v1);}
 return vec3u(v0,v1,v2);
}
@compute @workgroup_size(${PAGE_TRANSCODE_WORKGROUP}) fn transcode(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lid:u32){
 let job=readJob(group.x);
 let base=job.src;let out=job.dst;
 let h=clusterDiskHeader(base);
 // The resident page's words: its header and records, its streams, then the raw skin and morph words.
 let skinWords=select(0u,h.influences*(ceilDiv(h.vertexCount*h.skinBits,32u)+h.vertexCount),(h.flags&${FLAG_SKIN}u)!=0u);
 let rawWords=skinWords+h.morphCount*6u*h.vertexCount;
 // The disk header after the records: the vertices the page names, then where each section starts.
 let diskAt=base+h.streams;
 if(lid==0u){
  uni.n=h.vertexCount;uni.nc=h.indexCount;uni.positions=h.positionCount;uni.flags=h.flags;
  uni.named=src[diskAt];
  uni.fits=select(0u,1u,${RESIDENT_TABLE_WORDS}u+h.skin+rawWords<=job.room&&${RESIDENT_TABLE_WORDS}u+h.skin<=0xffffu);
 }
 let u=workgroupUniformLoad(&uni);
 if(u.fits==0u){
  if(lid==0u&&job.room>1u){dst[out+1u]=0u;}
  return;
 }
 let stored=u.n-u.named;
 let page=base*4u;
 var cursor=vec3u(src[diskAt+8u],src[diskAt+9u],src[diskAt+10u]);
 let rawAt=src[diskAt+${DISK_HEADER_WORDS - 1}u]>>2u;
 let masksAt=diskAt+${DISK_HEADER_WORDS}u;
 let distAt=base+(src[diskAt+4u]>>2u);
 let flags=base+(src[diskAt+6u]>>2u);
 for(var i=lid;i<h.streams;i+=${PAGE_TRANSCODE_WORKGROUP}u){
  var word=src[base+i];
  if(i==1u){word=RESIDENT_VERSION;}
  dst[out+i]=word;
 }
 // The table of the streams' offsets closes the header and the records; the streams follow it.
 for(var i=lid;i<${RESIDENT_TABLE_WORDS}u;i+=${PAGE_TRANSCODE_WORKGROUP}u){dst[out+h.streams+i]=clusterTableWord(h,base,i);}
 let streamsAt=out+${RESIDENT_TABLE_WORDS}u;
 for(var i=lid;i<rawWords;i+=${PAGE_TRANSCODE_WORKGROUP}u){dst[streamsAt+h.skin+i]=src[base+rawAt+i];}
 // The rank of each vertex among those the page stores.
 for(var v=lid;v<u.n;v+=${PAGE_TRANSCODE_WORKGROUP}u){storedRank[v]=v-namedRank(flags,v);}
 // The corners: the strips' triangles, three laid indices each.
 let triangles=u.nc/3u;
 for(var t=lid;t<triangles;t+=${PAGE_TRANSCODE_WORKGROUP}u){
  let k=stripTriangle(t,masksAt,src[diskAt+2u],src[diskAt+3u],distAt);
  vals[3u*t]=k.x;vals[3u*t+1u]=k.y;vals[3u*t+2u]=k.z;
 }
 workgroupBarrier();
 // The block of each eight triangles: its least corner, the width of its distances to it, and the
 // widths of the blocks before it.
 let blocks=ceilDiv(triangles,${TRIANGLE_BLOCK}u);
 if(lid<blocks){
  let first=lid*${BLOCK_CORNERS}u;
  var low=0xffffffffu;var high=0u;
  for(var k=first;k<min(first+${BLOCK_CORNERS}u,u.nc);k++){low=min(low,vals[k]);high=max(high,vals[k]);}
  blockBase[lid]=low;blockWidth[lid]=bitLength(high-low);
 }
 workgroupBarrier();
 if(lid==0u){
  var prefix=0u;
  for(var b=0u;b<blocks;b++){blockPrefix[b]=prefix;prefix+=blockWidth[b];}
 }
 workgroupBarrier();
 // The block table: base, width and prefix of each block, one after the other.
 let widthBits=${WIDTH_BITS}u;
 for(var w=lid;w<ceilDiv(blocks*h.recordBits,32u);w+=${PAGE_TRANSCODE_WORKGROUP}u){
  var word=0u;
  for(var j=(w*32u)/h.recordBits;j<=min(blocks-1u,(w*32u+31u)/h.recordBits);j++){
   let at=i32(j*h.recordBits)-i32(w*32u);
   word|=placed(at,blockBase[j],h.indexBits)|placed(at+i32(h.indexBits),blockWidth[j],widthBits)|placed(at+i32(h.indexBits+widthBits),blockPrefix[j],h.prefixBits);
  }
  dst[streamsAt+h.blocks+w]=word;
 }
 // The corner stream: each block's corners at its width, the blocks end to end; the words it holds
 // are those between its start and the first position stream's (the header's own).
 for(var w=lid;w<h.pos.x-h.corners;w+=${PAGE_TRANSCODE_WORKGROUP}u){
  var word=0u;
  let lo=w*32u;
  for(var b=0u;b<blocks;b++){
   let width=blockWidth[b];
   let start=blockPrefix[b]*${BLOCK_CORNERS}u;
   let corners=min(${BLOCK_CORNERS}u,u.nc-b*${BLOCK_CORNERS}u);
   if(width==0u||start>=lo+32u||start+corners*width<=lo){continue;}
   var k=0u;
   if(lo>start){k=(lo-start)/width;}
   for(;k<corners&&start+k*width<lo+32u;k++){
    word|=placed(i32(start+k*width)-i32(lo),vals[b*${BLOCK_CORNERS}u+k]-blockBase[b],width);
   }
  }
  dst[streamsAt+h.corners+w]=word;
 }
 workgroupBarrier();
 // The links of a page that stores each position once, then the positions: the whole table of
 // that page, else those of the vertices it stores.
 let links=u.positions<u.n;
 if(links){
  let run=runOf(u.n,1u,vec4u(h.linkBits,0u,0u,0u),vec4u(0u),vec4u(h.links,0u,0u,0u),cursor,page,streamsAt,u.n,0u);
  installRun(run,lid,flags);
  cursor=advance(cursor,u.n,run.bytes);
 }
 let positionCount=select(stored,u.positions,links);
 let positions=runOf(positionCount,3u,vec4u(h.posBits,0u),vec4u((1u<<h.posBits.x)>>1u,(1u<<h.posBits.y)>>1u,(1u<<h.posBits.z)>>1u,0u),vec4u(h.pos,0u),cursor,page,streamsAt,u.n,select(1u,0u,links));
 installRun(positions,lid,flags);
 cursor=advance(cursor,positionCount*3u,positions.bytes);
 // The normals, the stored tangents and the colours.
 if((u.flags&${FLAG_NORMAL}u)!=0u){
  let normals=runOf(stored,2u,vec4u(h.normalBits,h.normalBits,0u,0u),vec4u(0u),vec4u(h.normal,0u,0u),cursor,page,streamsAt,u.n,1u);
  installRun(normals,lid,flags);
  cursor=advance(cursor,stored*2u,normals.bytes);
 }
 if((u.flags&${FLAG_TANGENT}u)!=0u){
  let tangents=runOf(stored,1u,vec4u(h.tangentBits+1u,0u,0u,0u),vec4u(0u),vec4u(h.tangent,0u,0u,0u),cursor,page,streamsAt,u.n,1u);
  installRun(tangents,lid,flags);
  cursor=advance(cursor,stored,tangents.bytes);
 }
 if((u.flags&${FLAG_COLOR}u)!=0u){
  let colours=runOf(stored,4u,h.colorBits,vec4u(0u),h.color,cursor,page,streamsAt,u.n,1u);
  installRun(colours,lid,flags);
  cursor=advance(cursor,stored*4u,colours.bytes);
 }
 // The texture sets, in set order.
 for(var s=0u;s<${MAX_UV_SETS}u;s++){
  if(clusterHasUv(u.flags,s)){
   let fields=clusterDiskUvSet(h,base,s);
   let uvs=runOf(stored,2u,vec4u(fields.bitsX,fields.bitsY,0u,0u),vec4u(0u),vec4u(fields.offX,fields.offY,0u,0u),cursor,page,streamsAt,u.n,1u);
   installRun(uvs,lid,flags);
   cursor=advance(cursor,stored*2u,uvs.bytes);
  }
 }
}`,
  [PAGE_INSTALL_COMMON, clusterDecodeWgsl('src'), clusterDiskDecodeWgsl('src')],
)

/** The streams the second pass writes, in the order it takes them: the three components of the
 *  positions, the two of the normals, the tangents, the four of the colours, the two of each of
 *  the texture sets. */
const LINKED_STREAMS = 3 + 2 + 1 + 4 + 2 * MAX_UV_SETS

/**
 * THE SECOND INSTALL PASS: one workgroup a page that names vertices, which copies them into the
 * resident page the first pass wrote — a page that pass left unwritten, its version word not
 * there, is left alone. A level of pages a dispatch (`level`, a dynamic offset): each page runs
 * after the clusters it names vertices of — those of the streaming pages its pairs name, installed
 * in an earlier level or earlier still, and the earlier clusters of its own streaming page, whose
 * vertices the first pass wrote — are complete.
 *
 * The vertices a page names, in order, each a cluster of a pair and the index of a vertex there
 * (`refs.rs`): the lanes read the cluster's rank in the pair list and scan the index, a delta to
 * the one before, as the first pass scans a field. A cluster is found in the pool at the start of
 * its streaming page — this page's own (`unit`), or the one of the rank its pair names in the page's
 * list of dependencies (`deps`) — and the words its pair gives from there; the pair that names the
 * page itself names its own earlier vertices. Each stream is then written a word a lane, as the
 * first pass writes it: the word is read, the bits of the vertices the page names are set to the
 * fields of the vertices they name — a position, a colour byte, a texture code moved to this page's
 * own range —, and the word written, the bits of the vertices it stores as they were; a word with
 * no vertex named is not touched. A vertex of a cluster not resident is zero.
 *
 * A word that holds vertices the page names and vertices it stores is read and written by its lane
 * while other lanes, and the pages of the same level, read the stored vertices' bits from it — a
 * pair of the same streaming page, or of the page itself, names only vertices a page stores. Those
 * bits are the same before and after the write, so a read gives them whatever order the accesses
 * take and however a read is torn.
 */
export const PAGE_LINK_WGSL = wgslProgram(
  `struct Uni{fits:u32,n:u32,named:u32,}
var<workgroup> uni:Uni;
var<workgroup> refRun:PageRun;
var<workgroup> refBase:array<u32,${MAX_PAGE_VERTICES}>;
var<workgroup> refIndex:array<u32,${MAX_PAGE_VERTICES}>;
// The word of the pool that the cluster a pair names starts at, \`NO_UNIT\` for none.
fn pairBase(pair:u32,job:Job)->u32{
 if(pair==${SELF_PLACE}u){return job.dst;}
 let rank=pair>>${REF_PLACE_BITS}u;
 var unit=NO_UNIT;
 if(rank==0u){unit=job.unit;}
 else if(rank<=job.depsCount){unit=deps[job.depsAt+rank-1u];}
 if(unit==NO_UNIT){return NO_UNIT;}
 return unit+(pair&${SELF_PLACE}u);
}
// Field \`k\` (the streams in the order of \`LINKED_STREAMS\`) of vertex \`index\` of the cluster at the
// word \`at\` of the pool, whose header is \`r\`, as the page at the word \`out\`, whose header is \`h\`, holds it.
fn linkedField(k:u32,h:ClusterHeader,out:u32,r:ClusterHeader,at:u32,index:u32)->u32{
 if(at==NO_UNIT||index>=r.vertexCount){return 0u;}
 if(k<3u){
  var slot=index;
  if(r.positionCount<r.vertexCount){slot=clusterField(at+r.links,index*r.linkBits,r.linkBits);}
  let cell=clusterField(at+r.pos[k],slot*r.posBits[k],r.posBits[k]);
  return u32(i32(cell)+r.posStart[k]-h.posStart[k]);
 }
 if(k<5u){return clusterField(at+r.normal[k-3u],index*r.normalBits,r.normalBits);}
 if(k==5u){return clusterField(at+r.tangent,index*(r.tangentBits+1u),r.tangentBits+1u);}
 if(k<10u){
  let c=k-6u;
  return r.colorMin[c]+clusterField(at+r.color[c],index*r.colorBits[c],r.colorBits[c])-h.colorMin[c];
 }
 let s=(k-10u)>>1u;
 let own=clusterUvSet(h,out,s);let source=clusterUvSet(r,at,s);
 if(((k-10u)&1u)==0u){return source.minX+clusterField(at+source.offX,index*source.bitsX,source.bitsX)-own.minX;}
 return source.minY+clusterField(at+source.offY,index*source.bitsY,source.bitsY)-own.minY;
}
// Stream \`k\` of the page \`h\` at the word \`out\`: where it starts, how wide a field is, and whether the
// page carries it and the vertices it names write it.
struct Stream{at:u32,bits:u32,present:bool,}
fn streamOf(k:u32,h:ClusterHeader,out:u32)->Stream{
 var s:Stream;
 if(k<3u){s.at=h.pos[k];s.bits=h.posBits[k];s.present=h.positionCount==h.vertexCount;}
 else if(k<5u){s.at=h.normal[k-3u];s.bits=h.normalBits;s.present=(h.flags&${FLAG_NORMAL}u)!=0u;}
 else if(k==5u){s.at=h.tangent;s.bits=h.tangentBits+1u;s.present=(h.flags&${FLAG_TANGENT}u)!=0u;}
 else if(k<10u){s.at=h.color[k-6u];s.bits=h.colorBits[k-6u];s.present=(h.flags&${FLAG_COLOR}u)!=0u;}
 else{
  let uvSet=(k-10u)>>1u;
  let v=((k-10u)&1u)!=0u;
  let range=clusterUvSet(h,out,uvSet);
  s.at=select(range.offX,range.offY,v);s.bits=select(range.bitsX,range.bitsY,v);
  s.present=clusterHasUv(h.flags,uvSet);
 }
 return s;
}
@compute @workgroup_size(${PAGE_TRANSCODE_WORKGROUP}) fn link(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lid:u32){
 let job=readJob(jobs[level.value]+group.x);
 let base=job.src;let out=job.dst;
 // The first pass wrote the page when its version word is there; else the header at \`out\` is not
 // this page's.
 if(lid==0u){uni.fits=select(0u,1u,dst[out+1u]==RESIDENT_VERSION);}
 let written=workgroupUniformLoad(&uni);
 if(written.fits==0u){return;}
 let h=clusterHeader(out);
 // The disk header after the records: the vertices the page names, then where each section starts.
 let diskAt=base+h.streams-${RESIDENT_TABLE_WORDS}u;
 if(lid==0u){uni.n=h.vertexCount;uni.named=src[diskAt];}
 let u=workgroupUniformLoad(&uni);
 if(u.named==0u){return;}
 let page=base*4u;
 let pairs=base+(src[diskAt+5u]>>2u);
 let flags=base+(src[diskAt+6u]>>2u);
 let refs=src[diskAt+7u];
 // The index of the vertex each vertex named names, a running sum of deltas after the ranks.
 var run:PageRun;
 run.count=u.named;run.comps=1u;run.bytes=1u;run.page=page;run.out=out;run.n=u.n;run.sparse=0u;
 run.cursor=vec3u(refs+u.named,0u,0u);run.bits=vec4u(8u,0u,0u,0u);run.start=vec4u(0u);run.at=vec4u(0u);
 // Its cursor comes from the header in the pool, a buffer this pass writes: the run is read back
 // uniform, as its count decides how often the lanes reach a barrier.
 if(lid==0u){refRun=run;}
 decodeComponent(workgroupUniformLoad(&refRun),0u,lid);
 for(var v=lid;v<u.n;v+=${PAGE_TRANSCODE_WORKGROUP}u){
  if(vertexNamed(flags,v)){
   let rank=namedRank(flags,v);
   refBase[v]=pairBase(src[pairs+planeByte(page+refs+rank)],job);
   refIndex[v]=vals[rank];
  }
 }
 workgroupBarrier();
 for(var k=0u;k<${LINKED_STREAMS}u;k++){
  let s=streamOf(k,h,out);
  if(!s.present||s.bits==0u){continue;}
  for(var w=lid;w<ceilDiv(u.n*s.bits,32u);w+=${PAGE_TRANSCODE_WORKGROUP}u){
   var word=0u;var touched=false;
   // The header of the cluster the last vertex named of this word names a vertex in.
   var held:ClusterHeader;var heldAt=NO_UNIT;
   let last=min(u.n-1u,(w*32u+31u)/s.bits);
   for(var j=(w*32u)/s.bits;j<=last;j++){
    if(!vertexNamed(flags,j)){continue;}
    if(!touched){word=dst[out+s.at+w];touched=true;}
    let at=refBase[j];
    if(at!=NO_UNIT&&at!=heldAt){held=clusterHeader(at);heldAt=at;}
    let shift=i32(j*s.bits)-i32(w*32u);
    let field=linkedField(k,h,out,held,at,refIndex[j])&lowBits(s.bits);
    word=(word&~placed(shift,lowBits(s.bits),s.bits))|placed(shift,field,s.bits);
   }
   if(touched){dst[out+s.at+w]=word;}
  }
 }
}`,
  [PAGE_INSTALL_COMMON, clusterDecodeWgsl('dst')],
)
