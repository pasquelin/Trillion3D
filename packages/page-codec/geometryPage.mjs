/**
 * Reference encoder for the `.wgpg` geometry page. The compiler that ships pages is the native one
 * in `asset-compiler-rust`; this independent implementation exists so the browser decoder in
 * `sdk-browser/geometryPage.ts` is tested against something other than itself.
 */
import * as meshoptimizer from 'meshoptimizer';

const GEOMETRY_PAGE_VERSION=2;
const GEOMETRY_PAGE_MAGIC=0x32504757; // WGP2, little endian
const GEOMETRY_PAGE_STRIDE=72;
const GEOMETRY_ATTRIBUTES=[
 ['NORMAL',3,1],['TEXCOORD_0',2,2],['TANGENT',4,4],
 ['TEXCOORD_1',2,8],['COLOR_0',4,16],
];

/** Lossless float32 attributes and local uint16 indices, compressed with meshoptimizer. */
export async function encodeGeometryPage(sourceIndices,attributes){
 await meshoptimizer.MeshoptEncoder.ready;
 const position=attributes.POSITION;
 if(!position||position.itemSize!==3||!position.array.length)throw new Error('PAGE_POSITION_REQUIRED');
 const count=position.array.length/3,local=new Map(),original=[],indices=new Uint16Array(sourceIndices.length);
 if(sourceIndices.length<3||sourceIndices.length%3)throw new Error('PAGE_TRIANGLES_INVALID');
 for(let i=0;i<sourceIndices.length;i++){
  const source=sourceIndices[i];if(!Number.isSafeInteger(source)||source<0||source>=count)throw new Error('PAGE_INDEX_INVALID');
  let id=local.get(source);
  if(id===undefined){id=original.length;if(id>=65535)throw new Error('PAGE_VERTEX_LIMIT');local.set(source,id);original.push(source);}
  indices[i]=id;
 }
 let flags=0;
 for(const [name,size,bit] of GEOMETRY_ATTRIBUTES){
  const attr=attributes[name];if(!attr)continue;
  if(attr.itemSize!==size&&!(name==='COLOR_0'&&attr.itemSize===3)||attr.array.length!==count*attr.itemSize)throw new Error('PAGE_ATTRIBUTE_INVALID: '+name);
  flags|=bit;
 }
 const stride=GEOMETRY_PAGE_STRIDE,vertices=new Uint8Array(original.length*stride),view=new DataView(vertices.buffer);
 for(let i=0;i<original.length;i++){
  const source=original[i];let offset=i*stride;
  const write=(attr,size)=>{for(let c=0;c<size;c++){const value=c<attr.itemSize?attr.array[source*attr.itemSize+c]:1;if(!Number.isFinite(value))throw new Error('PAGE_ATTRIBUTE_NONFINITE');view.setFloat32(offset,value,true);offset+=4;}};
  write(position,3);
  for(const [name,size,bit] of GEOMETRY_ATTRIBUTES)if(flags&bit)write(attributes[name],size);else offset+=size*4;
 }
 const indexBytes=meshoptimizer.MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer),indices.length,2);
 const vertexBytes=meshoptimizer.MeshoptEncoder.encodeVertexBuffer(vertices,original.length,stride);
 const data=new Uint8Array(32+indexBytes.length+vertexBytes.length),head=new DataView(data.buffer);
 head.setUint32(0,GEOMETRY_PAGE_MAGIC,true);head.setUint32(4,GEOMETRY_PAGE_VERSION,true);
 head.setUint32(8,original.length,true);head.setUint32(12,indices.length,true);
 head.setUint32(16,flags,true);head.setUint32(20,stride,true);
 head.setUint32(24,indexBytes.length,true);head.setUint32(28,vertexBytes.length,true);
 data.set(indexBytes,32);data.set(vertexBytes,32+indexBytes.length);
 return {data,vertexCount:original.length,indexCount:indices.length,flags,uncompressedBytes:vertices.length+indices.byteLength};
}
