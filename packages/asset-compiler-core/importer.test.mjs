import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {prepareReference as prepare} from '../sdk-node/index.mjs';
import {hierarchy,COMPILER_VERSION,CLUSTER_INDEX_COUNT,CLUSTER_TRIANGLES} from './index.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
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
  const noIndices=structuredClone(base);delete noIndices.meshes[0].primitives[0].indices;await assert.rejects(run(noIndices),/indices/);
  const partial=structuredClone(base);partial.accessors[1].count=2;await assert.rejects(run(partial),/multiple of three/);
  const outside=structuredClone(base);outside.bufferViews[1].byteOffset=44;outside.bufferViews[1].byteLength=12;await assert.rejects(run(outside),/buffer view.*bounds/i);
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
