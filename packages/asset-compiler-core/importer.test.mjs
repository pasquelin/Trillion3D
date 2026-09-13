import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {prepareReference as prepare} from '../sdk-node/index.mjs';
import {hierarchy,compileAsset,COMPILER_VERSION,CLUSTER_INDEX_COUNT,CLUSTER_TRIANGLES,LOD_ERROR_MODEL} from './index.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('direct reference compilation requires a complete implementation fingerprint',async()=>{
 await assert.rejects(compileAsset({source:{read:async()=>{throw new Error('unexpected read');}},cache:{writeAtomic:async()=>{}},hash,resourceBaseUrl:'/assets/'}),/compilerHash SHA-256/);
});
test('Importer preserves full triangle coverage, limits the slice, repairs corrupt cached pages and rejects changed sources',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-pages-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);const bin=Buffer.alloc(48);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>bin.writeFloatLE(v,i*4));[0,1,2].forEach((v,i)=>bin.writeUInt32LE(v,36+i*4));
  const g={asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:48}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:12}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5125,type:'SCALAR',count:3}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],nodes:[{mesh:0},{mesh:0}],scenes:[{nodes:[0,1]}],scene:0,materials:[{}],images:[]};
  const json=Buffer.from(JSON.stringify(g));await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),bin);await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(json),sidecars:[{file:'mesh.bin',sha256:hash(bin)}],trianglesAcrossNodes:2,meshNodes:2}}));
  const options={resourceBaseUrl:'/assets/'};const slice=await prepare(input,output,'slice',1,options);assert.equal(slice.selectedTriangles,1);assert.equal(slice.selectedNodes.length,1);assert.equal(slice.primitives[0].pages[0].count,3);assert.deepEqual(slice.primitives[0].pages[0].min,[0,0,0]);
  const again=await prepare(input,output,'slice',1,options);assert.equal(again.key,slice.key);assert.equal(again.reusedPages,1);
  const page=join(output,'reference','slice',slice.key,slice.primitives[0].pages[0].url);await writeFile(page,Buffer.alloc(12));const repaired=await prepare(input,output,'slice',1,options);assert.equal(repaired.reusedPages,0);
  const bytes=await readFile(page);assert.deepEqual([bytes.readUInt32LE(0),bytes.readUInt32LE(4),bytes.readUInt32LE(8)],[0,1,2]);
  const full=await prepare(input,output,'full',150000,options);assert.equal(full.selectedTriangles,2);assert.equal(full.selectedNodes.length,2);
  bin[0]=1;await writeFile(join(input,'mesh.bin'),bin);await assert.rejects(prepare(input,output,'full',150000,options),/hash mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer rejects malformed primitive contracts and out-of-bounds buffer views',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-invalid-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);const bin=Buffer.alloc(48);const base={asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:48}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:12}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5125,type:'SCALAR',count:3}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0}],materials:[],images:[]};
  const run=async(g)=>{const json=Buffer.from(JSON.stringify(g));await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),bin);await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(json),sidecars:[{file:'mesh.bin',sha256:hash(bin)}],trianglesAcrossNodes:1,meshNodes:1}}));return prepare(input,output,'slice',1,{resourceBaseUrl:'/assets/'});};
  const noPosition=structuredClone(base);delete noPosition.meshes[0].primitives[0].attributes.POSITION;await assert.rejects(run(noPosition),/POSITION/);
  const partial=structuredClone(base);partial.accessors[1].count=2;await assert.rejects(run(partial),/multiple of three/);
  const outside=structuredClone(base);outside.bufferViews[1].byteOffset=44;outside.bufferViews[1].byteLength=12;await assert.rejects(run(outside),/buffer view.*bounds/i);
  const local=structuredClone(base);local.bufferViews[0].byteLength=24;await assert.rejects(run(local),/accessor.*bufferView/i);
  const stride=structuredClone(base);stride.bufferViews[0].byteStride=8;await assert.rejects(run(stride),/stride/i);
  const sparseCount=structuredClone(base);sparseCount.accessors[0].sparse={count:4,indices:{bufferView:1,componentType:5121},values:{bufferView:0}};await assert.rejects(run(sparseCount),/sparse.count/i);
  const sparseDuplicate=structuredClone(base);sparseDuplicate.accessors[0].sparse={count:2,indices:{bufferView:1,componentType:5121},values:{bufferView:0}};await assert.rejects(run(sparseDuplicate),/sparse indices/i);
  const declared=structuredClone(base);declared.buffers[0].byteLength=32;await assert.rejects(run(declared),/buffer view.*buffer/i);
  const floatIndices=structuredClone(base);floatIndices.accessors[1].componentType=5126;await assert.rejects(run(floatIndices),/indices.*component/i);
  await assert.rejects(readFile(join(output,'reference','slice','manifest.json')),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Hierarchy bounds tens of thousands of leaves without spreading into Math.min',()=>{
 const leaves=Array.from({length:100000},(_,id)=>({id,min:[id,0,0],max:[id+1,1,1]}));
 const tree=hierarchy(leaves);
 assert.deepEqual(tree.min,[0,0,0]);assert.deepEqual(tree.max,[100000,1,1]);
 let pages=0;const walk=node=>{if(node.page!==undefined)pages++;else node.children.forEach(walk);};walk(tree);assert.equal(pages,100000);
});
test('compiler identity matches the package version and 256-triangle clusters',async()=>{
 const pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
 assert.equal(COMPILER_VERSION,pkg.version);
 assert.equal(CLUSTER_INDEX_COUNT,768);
 assert.equal(CLUSTER_TRIANGLES,256);
 assert.equal(LOD_ERROR_MODEL,'qem-local-plus-child-max');
});
function packPositions(positions){
 const bin=Buffer.alloc(positions.length*4);
 positions.forEach((v,i)=>bin.writeFloatLE(v,i*4));
 return bin;
}
function packIndices(indices){
 const bin=Buffer.alloc(indices.length*4);
 indices.forEach((v,i)=>bin.writeUInt32LE(v,i*4));
 return bin;
}
async function writeNamedSource(input,{gltfName,binName,positions,indices,nodes=1}){
 const posBytes=packPositions(positions),indexBytes=packIndices(indices),bin=Buffer.concat([posBytes,indexBytes]);
 const g={asset:{version:'2.0'},buffers:[{uri:binName,byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:posBytes.length},{buffer:0,byteOffset:posBytes.length,byteLength:indexBytes.length}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:positions.length/3},{bufferView:1,componentType:5125,type:'SCALAR',count:indices.length}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:Array.from({length:nodes},()=>({mesh:0})),materials:[],images:[]};
 const json=Buffer.from(JSON.stringify(g));
 await writeFile(join(input,gltfName),json);await writeFile(join(input,binName),bin);
 await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',formatVersion:1,runtime:{file:gltfName,sha256:hash(json),sidecars:[{file:binName,sha256:hash(bin)}],trianglesAcrossNodes:nodes*(indices.length/3),meshNodes:nodes}}));
 return {json,bin,triangles:indices.length/3};
}
test('Importer compiles a glTF under an arbitrary file name',async()=>{
 const root=await mkdtemp(join(tmpdir(),'named-gltf-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const positions=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1];
  const indices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4];
  await writeNamedSource(input,{gltfName:'cube.gltf',binName:'cube.bin',positions,indices,nodes:1});
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(result.selectedTriangles,12);
  assert.equal(result.primitives[0].pages[0].count,36);
  assert.equal(result.simplification,false);
  assert.ok(result.primitives[0].hierarchy);
  assert.equal(result.primitives[0].topology.manifold,true);
  assert.equal(result.primitives[0].topology.edges.boundary,0);
  assert.equal(result.primitives[0].topology.edges.manifold,18);
 }finally{await rm(root,{recursive:true,force:true});}
});
function torusGeometry(radial=8,tubular=6,major=1,minor=0.3){
 const positions=[],indices=[];
 for(let i=0;i<radial;i++)for(let j=0;j<tubular;j++){
  const u=i/radial*Math.PI*2,v=j/tubular*Math.PI*2;
  positions.push((major+minor*Math.cos(v))*Math.cos(u),(major+minor*Math.cos(v))*Math.sin(u),minor*Math.sin(v));
 }
 for(let i=0;i<radial;i++)for(let j=0;j<tubular;j++){
  const a=i*tubular+j,b=i*tubular+(j+1)%tubular,c=((i+1)%radial)*tubular+j,d=((i+1)%radial)*tubular+(j+1)%tubular;
  indices.push(a,c,b,b,c,d);
 }
 return {positions,indices,triangles:indices.length/3};
}
test('Importer compiles triangle, cube and torus fixtures under arbitrary names',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-fixtures-'));try{
  const cases=[
   {gltfName:'triangle.gltf',binName:'triangle.bin',positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],triangles:1},
   {gltfName:'cube.gltf',binName:'cube.bin',positions:[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1],indices:[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4],triangles:12},
   {gltfName:'torus.gltf',binName:'torus.bin',...torusGeometry(),triangles:96},
  ];
  for(const fixture of cases){
   const input=join(root,fixture.gltfName.replace('.gltf','')),output=join(input,'cache');await mkdir(input,{recursive:true});
   await writeNamedSource(input,{...fixture,nodes:1});
   const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
   assert.equal(result.selectedTriangles,fixture.triangles);
   assert.equal(result.primitives[0].pages.reduce((n,p)=>n+p.count,0),fixture.triangles*3);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer qem-endpoints attaches a coarse LOD without dropping exact coverage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qem-gltf-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const positions=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1];
  const indices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4];
  await writeNamedSource(input,{gltfName:'cube.gltf',binName:'cube.bin',positions,indices,nodes:1});
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/',simplification:'qem-endpoints'});
  assert.equal(result.simplification,true);
  assert.equal(result.errorModel,LOD_ERROR_MODEL);
  const exact=result.primitives[0].pages.filter(page=>page.role!=='coarse');
  const coarse=result.primitives[0].pages.filter(page=>page.role==='coarse');
  assert.equal(exact.reduce((n,p)=>n+p.count,0),36);
  assert.ok(coarse.length>=1);
  assert.ok(result.primitives[0].hierarchy.errorObject>=0);
  assert.deepEqual(result.primitives[0].hierarchy.coarsePages,coarse.map(page=>page.id));
 }finally{await rm(root,{recursive:true,force:true});}
});
function assertLodShape(node){
 if(node.children){
  assert.ok(Array.isArray(node.coarsePages)&&node.coarsePages.length>=1);
  assert.ok(node.errorObject>=0);
  node.children.forEach(assertLodShape);
 }else assert.equal(typeof node.page,'number');
}
test('Importer qem-endpoints builds a nested LOD tree for four exact clusters',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lod-gltf-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const fixture=torusGeometry(32,16);
  await writeNamedSource(input,{gltfName:'torus.gltf',binName:'torus.bin',...fixture,nodes:1});
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/',simplification:'qem-endpoints'});
  const exact=result.primitives[0].pages.filter(page=>page.role!=='coarse');
  assert.equal(exact.length,4);
  assert.equal(exact.reduce((n,p)=>n+p.count,0),fixture.triangles*3);
  const tree=result.primitives[0].hierarchy;
  assert.ok(tree.children.length>=2);
  assertLodShape(tree);
  const internals=function walk(node,n=0){return node.children?1+node.children.reduce((s,c)=>s+walk(c),0):n;};
  assert.ok(internals(tree)>=2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer greedy-adjacency strategy covers every source triangle',async()=>{
 const root=await mkdtemp(join(tmpdir(),'greedy-gltf-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const {positions,indices,triangles}=torusGeometry();
  await writeNamedSource(input,{gltfName:'torus.gltf',binName:'torus.bin',positions,indices,nodes:1});
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/',strategy:'greedy-adjacency'});
  assert.equal(result.clusterStrategy,'greedy-adjacency');
  assert.equal(result.selectedTriangles,triangles);
  assert.equal(result.primitives[0].pages.reduce((n,p)=>n+p.count,0),triangles*3);
  assert.equal(result.primitives[0].topology.manifold,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer rejects unsafe runtime.file paths and missing file field',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unsafe-gltf-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const positions=[0,0,0,1,0,0,0,1,0],indices=[0,1,2];
  await writeNamedSource(input,{gltfName:'mesh.gltf',binName:'mesh.bin',positions,indices});
  const manifestPath=join(input,'manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  manifest.runtime.file='../mesh.gltf';
  await writeFile(manifestPath,JSON.stringify(manifest));
  await assert.rejects(prepare(input,output,'slice',1,{resourceBaseUrl:'/assets/'}),/runtime\.file|source name|unsafe/i);
  delete manifest.runtime.file;
  await writeFile(manifestPath,JSON.stringify(manifest));
  await assert.rejects(prepare(input,output,'slice',1,{resourceBaseUrl:'/assets/'}),/runtime\.file/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
function encodeGlb(gltf,bin){
 const json=Buffer.from(JSON.stringify(gltf));
 const jsonPad=(4-json.length%4)%4;
 const jsonChunk=Buffer.concat([json,Buffer.alloc(jsonPad,0x20)]);
 const binPad=(4-bin.length%4)%4;
 const binChunk=Buffer.concat([bin,Buffer.alloc(binPad)]);
 const header=Buffer.alloc(12);
 header.writeUInt32LE(0x46546C67,0);
 header.writeUInt32LE(2,4);
 header.writeUInt32LE(12+8+jsonChunk.length+8+binChunk.length,8);
 const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(jsonChunk.length,0);jsonHeader.writeUInt32LE(0x4E4F534A,4);
 const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binChunk.length,0);binHeader.writeUInt32LE(0x004E4942,4);
 return Buffer.concat([header,jsonHeader,jsonChunk,binHeader,binChunk]);
}
test('Importer compiles a glTF that omits images and uses bufferView images',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-images-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const bin=Buffer.alloc(56);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>bin.writeFloatLE(v,i*4));[0,1,2].forEach((v,i)=>bin.writeUInt32LE(v,36+i*4));
  [137,80,78,71,13,10,26,10].forEach((v,i)=>bin[48+i]=v);
  const g={asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:56}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:12},{buffer:0,byteOffset:48,byteLength:8}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5125,type:'SCALAR',count:3}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0}],materials:[],images:[{bufferView:2,mimeType:'image/png'}]};
  const json=Buffer.from(JSON.stringify(g));
  await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),bin);
  await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(json),sidecars:[{file:'mesh.bin',sha256:hash(bin)}],trianglesAcrossNodes:1,meshNodes:1}}));
  const withView=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
  const written=JSON.parse(await readFile(join(output,'reference','full',withView.key,'source.gltf'),'utf8'));
  assert.equal(written.images[0].uri,undefined);
  assert.equal(written.images[0].bufferView,2);
  const omitted=structuredClone(g);delete omitted.images;
  const omittedJson=Buffer.from(JSON.stringify(omitted));
  await writeFile(join(input,'mesh.gltf'),omittedJson);
  await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(omittedJson),sidecars:[{file:'mesh.bin',sha256:hash(bin)}],trianglesAcrossNodes:1,meshNodes:1}}));
  const without=await prepare(input,join(root,'cache-omit'),'full',150000,{resourceBaseUrl:'/assets/'});
  const omitWritten=JSON.parse(await readFile(join(root,'cache-omit','reference','full',without.key,'source.gltf'),'utf8'));
  assert.equal(omitWritten.images,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer indexes unindexed triangle lists',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-unindexed-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const bin=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>bin.writeFloatLE(v,i*4));
  const g={asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],materials:[]};
  const json=Buffer.from(JSON.stringify(g));
  await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),bin);
  await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(json),sidecars:[{file:'mesh.bin',sha256:hash(bin)}],trianglesAcrossNodes:1,meshNodes:1}}));
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(result.selectedTriangles,1);
  assert.equal(result.primitives[0].pages[0].count,3);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer compiles a raw glTF or GLB without a precomputed manifest',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-raw-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const positions=[0,0,0,1,0,0,0,1,0],indices=[0,1,2];
  await writeNamedSource(input,{gltfName:'mesh.gltf',binName:'mesh.bin',positions,indices});
  await rm(join(input,'manifest.json'));
  const fromDir=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(fromDir.selectedTriangles,1);
  const fromFile=await prepare(join(input,'mesh.gltf'),join(root,'cache-file'),'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(fromFile.selectedTriangles,1);
  const gltf=JSON.parse(await readFile(join(input,'mesh.gltf'),'utf8'));
  const bin=await readFile(join(input,'mesh.bin'));
  delete gltf.buffers[0].uri;
  gltf.buffers[0].byteLength=bin.length;
  const glb=encodeGlb(gltf,bin);
  const glbDir=join(root,'glb');await mkdir(glbDir);
  await writeFile(join(glbDir,'mesh.glb'),glb);
  const fromGlb=await prepare(join(glbDir,'mesh.glb'),join(root,'cache-glb'),'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(fromGlb.selectedTriangles,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer leaves transmissive materials unsplit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-tx-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const positions=[0,0,0,1,0,0,0,1,0],indices=[0,1,2];
  const posBytes=packPositions(positions),indexBytes=packIndices(indices),bin=Buffer.concat([posBytes,indexBytes]);
  const g={asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:posBytes.length},{buffer:0,byteOffset:posBytes.length,byteLength:indexBytes.length}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5125,type:'SCALAR',count:3}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],nodes:[{mesh:0}],materials:[{extensions:{KHR_materials_transmission:{transmissionFactor:1},KHR_materials_volume:{thicknessFactor:0.02,attenuationColor:[0.2,0.8,0.3],attenuationDistance:0.1}}}]};
  const json=Buffer.from(JSON.stringify(g));
  await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),bin);
  await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(json),sidecars:[{file:'mesh.bin',sha256:hash(bin)}],trianglesAcrossNodes:1,meshNodes:1}}));
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(result.primitives[0].pass,'shared-blend');
  assert.equal(result.primitives[0].pages.length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer concatenates multiple glTF buffers and remaps bufferViews',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-multibin-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const pos=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>pos.writeFloatLE(v,i*4));
  const idx=Buffer.alloc(12);[0,1,2].forEach((v,i)=>idx.writeUInt32LE(v,i*4));
  const g={asset:{version:'2.0'},buffers:[{uri:'pos.bin',byteLength:36},{uri:'idx.bin',byteLength:12}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:1,byteOffset:0,byteLength:12}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5125,type:'SCALAR',count:3}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0}],materials:[]};
  const json=Buffer.from(JSON.stringify(g));
  await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'pos.bin'),pos);await writeFile(join(input,'idx.bin'),idx);
  await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(json),sidecars:[{file:'pos.bin',sha256:hash(pos)},{file:'idx.bin',sha256:hash(idx)}],trianglesAcrossNodes:1,meshNodes:1}}));
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(result.selectedTriangles,1);
  assert.equal(result.primitives[0].pages[0].count,3);
  const written=JSON.parse(await readFile(join(output,'reference','full',result.key,'source.gltf'),'utf8'));
  assert.equal(written.buffers.length,1);
  assert.equal(written.bufferViews[0].buffer,0);
  assert.equal(written.bufferViews[1].buffer,0);
  assert.ok(written.bufferViews[1].byteOffset>=written.bufferViews[0].byteLength);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer slice keeps a single oversized mesh instead of failing empty',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-slice-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const positions=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1];
  const indices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4];
  await writeNamedSource(input,{gltfName:'cube.gltf',binName:'cube.bin',positions,indices,nodes:1});
  const result=await prepare(input,output,'slice',1,{resourceBaseUrl:'/assets/'});
  assert.equal(result.selectedTriangles,12);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer decodes sparse accessors and overrides base values',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-sparse-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const basePos=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>basePos.writeFloatLE(v,i*4));
  const baseIdx=Buffer.alloc(12);[0,1,2].forEach((v,i)=>baseIdx.writeUInt32LE(v,i*4));
  const sparseIdx=Buffer.alloc(4);sparseIdx.writeUInt32LE(1,0);
  const sparseVal=Buffer.alloc(12);[5,0,0].forEach((v,i)=>sparseVal.writeFloatLE(v,i*4));
  const bin=Buffer.concat([basePos,baseIdx,sparseIdx,sparseVal]);
  const g={
   asset:{version:'2.0'},
   buffers:[{uri:'mesh.bin',byteLength:bin.length}],
   bufferViews:[
    {buffer:0,byteOffset:0,byteLength:36},
    {buffer:0,byteOffset:36,byteLength:12},
    {buffer:0,byteOffset:48,byteLength:4},
    {buffer:0,byteOffset:52,byteLength:12}
   ],
   accessors:[
    {bufferView:0,componentType:5126,type:'VEC3',count:3,sparse:{count:1,indices:{bufferView:2,componentType:5125},values:{bufferView:3}}},
    {bufferView:1,componentType:5125,type:'SCALAR',count:3}
   ],
   meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],
   nodes:[{mesh:0}],materials:[]
  };
  const json=Buffer.from(JSON.stringify(g));
  await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),bin);
  await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(json),sidecars:[{file:'mesh.bin',sha256:hash(bin)}],trianglesAcrossNodes:1,meshNodes:1}}));
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(result.selectedTriangles,1);
  assert.equal(result.primitives[0].pages[0].max[0],5.0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Importer routes skinned and morph target meshes to shared-blend',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gltf-skin-morph-'));try{
  const input=join(root,'source'),output=join(root,'cache');await mkdir(input);
  const basePos=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>basePos.writeFloatLE(v,i*4));
  const baseIdx=Buffer.alloc(12);[0,1,2].forEach((v,i)=>baseIdx.writeUInt32LE(v,i*4));
  const morphPos=Buffer.alloc(12);[0.1,0.2,0.3].forEach((v,i)=>morphPos.writeFloatLE(v,i*4));
  const ibm=Buffer.alloc(64);
  const bin=Buffer.concat([basePos,baseIdx,morphPos,ibm]);
  const g={
   asset:{version:'2.0'},
   buffers:[{uri:'mesh.bin',byteLength:bin.length}],
   bufferViews:[
    {buffer:0,byteOffset:0,byteLength:36},
    {buffer:0,byteOffset:36,byteLength:12},
    {buffer:0,byteOffset:48,byteLength:12},
    {buffer:0,byteOffset:60,byteLength:64}
   ],
   accessors:[
    {bufferView:0,componentType:5126,type:'VEC3',count:3},
    {bufferView:1,componentType:5125,type:'SCALAR',count:3},
    {bufferView:2,componentType:5126,type:'VEC3',count:1},
    {bufferView:3,componentType:5126,type:'MAT4',count:1}
   ],
   meshes:[{primitives:[{attributes:{POSITION:0},indices:1,targets:[{POSITION:2}]}]}],
   nodes:[{mesh:0,skin:0}],
   skins:[{inverseBindMatrices:3,joints:[0]}],
   materials:[]
  };
  const json=Buffer.from(JSON.stringify(g));
  await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),bin);
  await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:hash(json),sidecars:[{file:'mesh.bin',sha256:hash(bin)}],trianglesAcrossNodes:1,meshNodes:1}}));
  const result=await prepare(input,output,'full',150000,{resourceBaseUrl:'/assets/'});
  assert.equal(result.primitives[0].pass,'shared-blend');
  assert.equal(result.primitives[0].pages.length,0);
  const written=JSON.parse(await readFile(join(output,'reference','full',result.key,'source.gltf'),'utf8'));
  assert.ok(Array.isArray(written.skins));
  assert.ok(Array.isArray(written.meshes[0].primitives[0].targets));
 }finally{await rm(root,{recursive:true,force:true});}
});
