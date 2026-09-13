import * as meshoptimizer from 'meshoptimizer';

const MAGIC=0x32504757,VERSION=2;
const OPTIONAL=[
 ['normal',3,1],['uv',2,2],['tangent',4,4],
 ['uv2',2,8],['color',4,16],
] as const;

export type DecodedGeometryPage={indices:Uint32Array;attributes:Record<string,Float32Array>;vertexCount:number;flags:number;decodedBytes:number};

/** Decode one complete meshopt page without referring to any source glTF buffer. */
export async function decodeGeometryPage(data:Uint8Array,maxDecodedBytes=16*1024*1024):Promise<DecodedGeometryPage>{
 if(data.byteLength<32)throw new Error('GEOMETRY_PAGE_HEADER');
 const head=new DataView(data.buffer,data.byteOffset,data.byteLength);
 if(head.getUint32(0,true)!==MAGIC||head.getUint32(4,true)!==VERSION)throw new Error('GEOMETRY_PAGE_VERSION');
 const vertexCount=head.getUint32(8,true),indexCount=head.getUint32(12,true),flags=head.getUint32(16,true),stride=head.getUint32(20,true),indexBytes=head.getUint32(24,true),vertexBytes=head.getUint32(28,true);
 const decodedBytes=vertexCount*stride+indexCount*2;
 if(!vertexCount||vertexCount>65535||!indexCount||indexCount%3||flags&~31||stride!==72||decodedBytes>maxDecodedBytes||32+indexBytes+vertexBytes!==data.byteLength)throw new Error('GEOMETRY_PAGE_BOUNDS');
 await meshoptimizer.MeshoptDecoder.ready;
 const indexData=new Uint8Array(indexCount*2),vertexData=new Uint8Array(vertexCount*stride);
 meshoptimizer.MeshoptDecoder.decodeIndexBuffer(indexData,indexCount,2,data.subarray(32,32+indexBytes));
 meshoptimizer.MeshoptDecoder.decodeVertexBuffer(vertexData,vertexCount,stride,data.subarray(32+indexBytes));
 const indexView=new DataView(indexData.buffer),indices=new Uint32Array(indexCount);
 for(let i=0;i<indexCount;i++){indices[i]=indexView.getUint16(i*2,true);if(indices[i]>=vertexCount)throw new Error('GEOMETRY_PAGE_INDEX');}
 const attributes:Record<string,Float32Array>={position:new Float32Array(vertexCount*3)};
 for(const [name,size,bit] of OPTIONAL)if(flags&bit)attributes[name]=new Float32Array(vertexCount*size);
 const vertices=new DataView(vertexData.buffer);
 for(let i=0;i<vertexCount;i++){
  let offset=i*stride;
  const read=(name:string,size:number)=>{const target=attributes[name];for(let c=0;c<size;c++){const value=vertices.getFloat32(offset,true);if(!Number.isFinite(value))throw new Error('GEOMETRY_PAGE_NONFINITE');target[i*size+c]=value;offset+=4;}};
  read('position',3);
  for(const [name,size,bit] of OPTIONAL)if(flags&bit)read(name,size);else offset+=size*4;
 }
 return {indices,attributes,vertexCount,flags,decodedBytes};
}
