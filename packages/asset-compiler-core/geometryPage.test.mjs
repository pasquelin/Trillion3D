import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareReference} from '../sdk-node/index.mjs';
import {decodeGeometryPage} from '../sdk-browser/geometryPage.ts';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('prepared geometry page preserves local triangles and normalized color without source geometry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wg-autonomous-'));
 try{
  const input=join(root,'input'),cache=join(root,'cache');await mkdir(input);
  const binary=Buffer.alloc(64);
  [0,0,0,1,0,0,0,1,0].forEach((value,i)=>binary.writeFloatLE(value,i*4));
  [0,1,2].forEach((value,i)=>binary.writeUInt16LE(value,36+i*2));
  binary.set([255,0,0,0,255,0,0,0,255],42);
  const gltf={asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:binary.length}],bufferViews:[
   {buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:6},{buffer:0,byteOffset:42,byteLength:9}],
   accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5123,type:'SCALAR',count:3},{bufferView:2,componentType:5121,type:'VEC3',count:3,normalized:true}],
   meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:2},indices:1,material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,materials:[{}],images:[]};
  const json=Buffer.from(JSON.stringify(gltf));
  await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),binary);
  await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:sha(json),sidecars:[{file:'mesh.bin',sha256:sha(binary)}],trianglesAcrossNodes:1,meshNodes:1}}));
  const result=await prepareReference(input,cache,'full',1,{resourceBaseUrl:'/assets/'});
  assert.equal(result.autonomousScene,'scene.gltf');
  const directory=join(cache,'reference','full',result.key),page=result.primitives[0].pages[0];
  assert.equal(page.geometry.formatVersion,2);
  const prepared=JSON.parse(await readFile(join(directory,result.autonomousScene),'utf8'));
  assert.equal(prepared.buffers[0].uri,'scene.bin');
  const decoded=await decodeGeometryPage(await readFile(join(directory,page.geometry.url)));
  assert.deepEqual([...decoded.indices],[0,1,2]);
  assert.deepEqual([...decoded.attributes.position],[0,0,0,1,0,0,0,1,0]);
  assert.deepEqual([...decoded.attributes.color],[1,0,0,1,0,1,0,1,0,0,1,1]);
  assert.ok((await readFile(join(directory,'scene.bin'))).byteLength<binary.byteLength);
 }finally{await rm(root,{recursive:true,force:true});}
});
