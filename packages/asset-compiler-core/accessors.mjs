const invalid=(message,details={})=>{const error=new Error(message);error.code='INVALID_GLTF';error.details=details;throw error;};
const natural=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)invalid(`${label} must be a nonnegative safe integer`,{value});return value;};
const componentBytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const dimensions={SCALAR:[1,1],VEC2:[1,2],VEC3:[1,3],VEC4:[1,4],MAT2:[2,2],MAT3:[3,3],MAT4:[4,4]};
const align4=value=>Math.ceil(value/4)*4;

/** Validate a selected glTF accessor against its own bufferView before cache publication. */
export function validateAccessor(g,bin,id){
 natural(id,'accessor index');
 const a=g.accessors[id];if(!a||typeof a!=='object')invalid('accessor is required',{id});
 const bytes=componentBytes[a.componentType],shape=dimensions[a.type];
 if(!bytes||!shape)invalid('accessor component or type is unsupported',{id});
 const count=natural(a.count,'accessor.count');if(count===0)invalid('accessor.count must be positive',{id});
 const [columns,rows]=shape;
 const elementBytes=columns===1?rows*bytes:columns*(bytes<4?align4(rows*bytes):rows*bytes);
 const viewAt=(viewId,label)=>{
  const index=natural(viewId,`${label}.bufferView`),view=g.bufferViews[index];
  if(!view||typeof view!=='object')invalid(`${label} bufferView is required`,{id,viewId:index});
  return view;
 };
 const within=(view,offset,stride,entries,size,label)=>{
  const start=natural(offset,`${label}.byteOffset`),length=natural(view.byteLength,`${label}.bufferView.byteLength`);
  const extent=entries===0?start:start+(entries-1)*stride+size;
  if(!Number.isSafeInteger(extent)||extent>length)invalid(`${label} exceeds its bufferView`,{id,extent,viewBytes:length});
  const absolute=natural(view.byteOffset??0,`${label}.bufferView.byteOffset`)+start;
  if(!Number.isSafeInteger(absolute)||absolute+extent-start>bin.byteLength)invalid(`${label} exceeds binary buffer`,{id});
  return absolute;
 };
 if(a.bufferView===undefined){
  if(!a.sparse||a.byteOffset!==undefined&&a.byteOffset!==0)invalid('accessor requires bufferView unless sparse',{id});
 }else{
  const view=viewAt(a.bufferView,'accessor');
  const offset=natural(a.byteOffset??0,'accessor.byteOffset');
  const stride=view.byteStride===undefined?elementBytes:natural(view.byteStride,'bufferView.byteStride');
  if(stride<elementBytes||stride%bytes!==0)invalid('accessor stride is invalid',{id,stride,elementBytes});
  if(offset%bytes!==0||(view.byteOffset??0)%bytes!==0)invalid('accessor alignment is invalid',{id});
  within(view,offset,stride,count,elementBytes,'accessor');
 }
 if(a.sparse){
  const sparse=a.sparse,scount=natural(sparse.count,'sparse.count');
  if(scount===0||scount>count)invalid('sparse.count exceeds accessor count',{id,scount,count});
  const ind=sparse.indices,val=sparse.values;
  if(!ind||!val)invalid('sparse indices and values are required',{id});
  const indexBytes={5121:1,5123:2,5125:4}[ind.componentType];
  if(!indexBytes)invalid('sparse indices component is invalid',{id});
  const indView=viewAt(ind.bufferView,'sparse indices'),valView=viewAt(val.bufferView,'sparse values');
  if(indView.byteStride!==undefined||valView.byteStride!==undefined)invalid('sparse bufferViews cannot have a stride',{id});
  const indOffset=natural(ind.byteOffset??0,'sparse indices.byteOffset');
  const valOffset=natural(val.byteOffset??0,'sparse values.byteOffset');
  if((indView.byteOffset??0)%indexBytes!==0||indOffset%indexBytes!==0||(valView.byteOffset??0)%bytes!==0||valOffset%bytes!==0)invalid('sparse alignment is invalid',{id});
  const indBase=within(indView,indOffset,indexBytes,scount,indexBytes,'sparse indices');
  within(valView,valOffset,elementBytes,scount,elementBytes,'sparse values');
  const data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
  let previous=-1;
  for(let i=0;i<scount;i++){
   const at=indBase+i*indexBytes;
   const index=indexBytes===1?bin[at]:indexBytes===2?data.getUint16(at,true):data.getUint32(at,true);
   if(index<=previous||index>=count)invalid('sparse indices must be strictly increasing and in range',{id,index,previous,count});
   previous=index;
  }
 }
 return {count,componentBytes:bytes,elementBytes};
}
