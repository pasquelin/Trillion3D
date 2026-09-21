import { OCT_SCALE } from './clusterFormat.ts';

/**
 * WGSL decode of a `WGP3` quantized cluster page read in place from a storage buffer of words
 * (`docs/FORMAT.md`): the header once per cluster, then any vertex or corner by rank, in O(1)
 * — a field never spans more than two words. The arithmetic is the format's, operation for
 * operation — one multiply, one add, both correctly rounded in WGSL —, so a position decoded here
 * is the 32-bit float the shared Rust codec and `geometryPage.ts` decode; a normal, which goes
 * through `normalize`, agrees to the ULP tolerance WGSL grants that builtin.
 *
 * The host declares the buffer and names it: `clusterDecodeWgsl('pageWords')` binds every routine
 * to `pageWords:array<u32>`.
 */
const CLUSTER_HEADER_WGSL = `struct ClusterHeader{
 vertexCount:u32,indexCount:u32,flags:u32,indexBits:u32,
 posBits:vec3u,posStep:f32,posMin:vec3f,
 uvBits:vec2u,uvStep:f32,uvMin:vec2f,uv1Bits:vec2u,uv1Step:f32,uv1Min:vec2f,
 colorBits:vec4u,colorStep:f32,colorMin:vec4f,
 quantizationError:f32,
 // Word offset of each stream from the page's first word: indices, x, y, z, normal, u, v, u1, v1, r, g, b, a.
 indices:u32,pos:vec3u,normal:u32,uv:vec2u,uv1:vec2u,color:vec4u,
}`;

export function clusterDecodeWgsl(buffer: string) {
  return `${CLUSTER_HEADER_WGSL}
fn clusterPow2(exponent:i32)->f32{return bitcast<f32>(u32(exponent+127)<<23u);}
fn clusterBitsFor(range:u32)->u32{return select(32u-countLeadingZeros(range),0u,range==0u);}
fn clusterStreamWords(count:u32,bits:u32)->u32{return (count*bits+31u)/32u;}
// The \`bits\`-bit field at bit \`at\` of the page at word \`base\`.
fn clusterField(base:u32,at:u32,bits:u32)->u32{
 if(bits==0u){return 0u;}
 let shift=at&31u;let index=base+(at>>5u);
 var value=${buffer}[index]>>shift;
 if(shift+bits>32u){value|=${buffer}[index+1u]<<(32u-shift);}
 return select(value&((1u<<bits)-1u),value,bits==32u);
}
// A record word: six bits per width from bit 0, the exponent as a signed byte on top.
fn clusterWidths(word:u32)->vec4u{return vec4u(word&63u,(word>>6u)&63u,(word>>12u)&63u,(word>>18u)&63u);}
fn clusterStep(word:u32)->f32{return clusterPow2(i32(word)>>24u);}
fn clusterHeader(base:u32)->ClusterHeader{
 var h:ClusterHeader;
 h.vertexCount=${buffer}[base+2u];h.indexCount=${buffer}[base+3u];h.flags=${buffer}[base+4u];
 let p=${buffer}[base+5u];h.posBits=clusterWidths(p).xyz;h.posStep=clusterStep(p);
 h.posMin=vec3f(bitcast<f32>(${buffer}[base+6u]),bitcast<f32>(${buffer}[base+7u]),bitcast<f32>(${buffer}[base+8u]));
 let t=${buffer}[base+9u];h.uvBits=clusterWidths(t).xy;h.uvStep=clusterStep(t);
 h.uvMin=vec2f(bitcast<f32>(${buffer}[base+10u]),bitcast<f32>(${buffer}[base+11u]));
 let s=${buffer}[base+12u];h.uv1Bits=clusterWidths(s).xy;h.uv1Step=clusterStep(s);
 h.uv1Min=vec2f(bitcast<f32>(${buffer}[base+13u]),bitcast<f32>(${buffer}[base+14u]));
 let c=${buffer}[base+15u];h.colorBits=clusterWidths(c);h.colorStep=clusterStep(c);
 h.colorMin=vec4f(bitcast<f32>(${buffer}[base+16u]),bitcast<f32>(${buffer}[base+17u]),bitcast<f32>(${buffer}[base+18u]),bitcast<f32>(${buffer}[base+19u]));
 h.quantizationError=bitcast<f32>(${buffer}[base+20u]);
 h.indexBits=clusterBitsFor(h.vertexCount-1u);
 var at=24u;
 h.indices=at;at+=clusterStreamWords(h.indexCount,h.indexBits);
 h.pos.x=at;at+=clusterStreamWords(h.vertexCount,h.posBits.x);
 h.pos.y=at;at+=clusterStreamWords(h.vertexCount,h.posBits.y);
 h.pos.z=at;at+=clusterStreamWords(h.vertexCount,h.posBits.z);
 h.normal=at;if((h.flags&1u)!=0u){at+=clusterStreamWords(h.vertexCount,16u);}
 h.uv.x=at;if((h.flags&2u)!=0u){at+=clusterStreamWords(h.vertexCount,h.uvBits.x);}
 h.uv.y=at;if((h.flags&2u)!=0u){at+=clusterStreamWords(h.vertexCount,h.uvBits.y);}
 h.uv1.x=at;if((h.flags&4u)!=0u){at+=clusterStreamWords(h.vertexCount,h.uv1Bits.x);}
 h.uv1.y=at;if((h.flags&4u)!=0u){at+=clusterStreamWords(h.vertexCount,h.uv1Bits.y);}
 h.color.x=at;if((h.flags&8u)!=0u){at+=clusterStreamWords(h.vertexCount,h.colorBits.x);}
 h.color.y=at;if((h.flags&8u)!=0u){at+=clusterStreamWords(h.vertexCount,h.colorBits.y);}
 h.color.z=at;if((h.flags&8u)!=0u){at+=clusterStreamWords(h.vertexCount,h.colorBits.z);}
 h.color.w=at;
 return h;
}
// Local vertex index of corner \`corner\` (three per triangle).
fn clusterIndex(h:ClusterHeader,base:u32,corner:u32)->u32{
 return clusterField(base+h.indices,corner*h.indexBits,h.indexBits);
}
fn clusterGrid(base:u32,stream:u32,vertex:u32,bits:u32,minimum:f32,step:f32)->f32{
 return minimum+f32(clusterField(base+stream,vertex*bits,bits))*step;
}
fn clusterPosition(h:ClusterHeader,base:u32,vertex:u32)->vec3f{
 return vec3f(clusterGrid(base,h.pos.x,vertex,h.posBits.x,h.posMin.x,h.posStep),
  clusterGrid(base,h.pos.y,vertex,h.posBits.y,h.posMin.y,h.posStep),
  clusterGrid(base,h.pos.z,vertex,h.posBits.z,h.posMin.z,h.posStep));
}
fn clusterUv(h:ClusterHeader,base:u32,vertex:u32)->vec2f{
 return vec2f(clusterGrid(base,h.uv.x,vertex,h.uvBits.x,h.uvMin.x,h.uvStep),
  clusterGrid(base,h.uv.y,vertex,h.uvBits.y,h.uvMin.y,h.uvStep));
}
fn clusterUv1(h:ClusterHeader,base:u32,vertex:u32)->vec2f{
 return vec2f(clusterGrid(base,h.uv1.x,vertex,h.uv1Bits.x,h.uv1Min.x,h.uv1Step),
  clusterGrid(base,h.uv1.y,vertex,h.uv1Bits.y,h.uv1Min.y,h.uv1Step));
}
// Two octahedral bytes back to a unit vector.
fn clusterNormal(h:ClusterHeader,base:u32,vertex:u32)->vec3f{
 let q=clusterField(base+h.normal,vertex*16u,16u);
 var x=f32(q&255u)*${OCT_SCALE}-1.0;var y=f32((q>>8u)&255u)*${OCT_SCALE}-1.0;
 let z=1.0-abs(x)-abs(y);
 if(z<0.0){
  let fx=(1.0-abs(y))*select(-1.0,1.0,x>=0.0);let fy=(1.0-abs(x))*select(-1.0,1.0,y>=0.0);
  x=fx;y=fy;
 }
 return normalize(vec3f(x,y,z));
}
fn clusterColor(h:ClusterHeader,base:u32,vertex:u32)->vec4f{
 return vec4f(clusterGrid(base,h.color.x,vertex,h.colorBits.x,h.colorMin.x,h.colorStep),
  clusterGrid(base,h.color.y,vertex,h.colorBits.y,h.colorMin.y,h.colorStep),
  clusterGrid(base,h.color.z,vertex,h.colorBits.z,h.colorMin.z,h.colorStep),
  clusterGrid(base,h.color.w,vertex,h.colorBits.w,h.colorMin.w,h.colorStep));
}
// The tangent a page no longer stores, from the triangle's positions and texture coordinates:
// the direction along which \`u\` grows, made orthogonal to the normal, with the handedness of
// the (tangent, bitangent, normal) frame in \`w\`. A triangle with no texture area yields zero.
fn clusterTangent(p0:vec3f,p1:vec3f,p2:vec3f,t0:vec2f,t1:vec2f,t2:vec2f,n:vec3f)->vec4f{
 let e1=p1-p0;let e2=p2-p0;let d1=t1-t0;let d2=t2-t0;
 let det=d1.x*d2.y-d2.x*d1.y;
 if(det==0.0){return vec4f(0.0);}
 let tangent=(e1*d2.y-e2*d1.y)/det;let bitangent=(e2*d1.x-e1*d2.x)/det;
 let t=normalize(tangent-n*dot(n,tangent));
 return vec4f(t,select(-1.0,1.0,dot(cross(n,t),bitangent)>=0.0));
}`;
}
