import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prepare} from '../packages/sdk-node/index.mjs';

const repo=resolve('.'),labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(join(labRoot,'package.json'))('playwright');
const {createServer:createViteServer}=await import(pathToFileURL(join(labRoot,'node_modules/vite/dist/node/index.js')).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=await mkdtemp(join(tmpdir(),'wg-autonomous-browser-')),html=join(repo,`.autonomous-smoke-${process.pid}.html`);
let dataServer,vite,browser;
try{
 const input=join(root,'input'),cache=join(root,'cache');await mkdir(input);
 const binary=Buffer.alloc(48);[0,0,0,1,0,0,0,1,0].forEach((value,i)=>binary.writeFloatLE(value,i*4));[0,1,2].forEach((value,i)=>binary.writeUInt32LE(value,36+i*4));
 const gltf={asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:12}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5125,type:'SCALAR',count:3}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[0.8,0.2,0.1,1]}}],images:[]};
 const json=Buffer.from(JSON.stringify(gltf));await writeFile(join(input,'mesh.gltf'),json);await writeFile(join(input,'mesh.bin'),binary);
 await writeFile(join(input,'manifest.json'),JSON.stringify({status:'ready',runtime:{file:'mesh.gltf',sha256:sha(json),sidecars:[{file:'mesh.bin',sha256:sha(binary)}],trianglesAcrossNodes:1,meshNodes:1}}));
 await prepare(input,cache,'full',1,{resourceBaseUrl:'/assets/'});
 const requested=[];
 dataServer=createServer(async(req,res)=>{try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(cache,'.'+pathname);
  requested.push(pathname);if(!file.startsWith(cache+sep))throw new Error('outside fixture');
  const bytes=await readFile(file);res.writeHead(200,{'access-control-allow-origin':'*','content-type':pathname.endsWith('.gltf')||pathname.endsWith('.json')?'application/json':'application/octet-stream'});res.end(bytes);
 }catch{res.writeHead(404,{'access-control-allow-origin':'*'});res.end();}});
 await new Promise((ok,no)=>{dataServer.once('error',no);dataServer.listen(0,'127.0.0.1',ok);});
 await writeFile(html,'<!doctype html><title>Autonomous WebGeometry smoke</title>');
 vite=await createViteServer({root:repo,configFile:false,server:{host:'127.0.0.1',port:0,strictPort:false}});await vite.listen();
 const address=vite.httpServer.address(),dataAddress=dataServer.address();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.goto(`http://127.0.0.1:${address.port}/${html.split('/').at(-1)}`);
 const result=await page.evaluate(async manifestUrl=>{
  const {createExplorer,referenceBackend}=await import('/dist/sdk-browser/index.js');
  const create=async options=>{const canvas=document.createElement('canvas');document.body.append(canvas);return createExplorer(canvas,{manifestUrl,scope:'full',width:128,height:128,replicaCount:4,...options});};
  const reference=await create({backends:[referenceBackend],preload:'all'});
  const before=performance.getEntriesByType('resource').length;
  const autonomous=await create({autonomousGeometry:true,maxResidentPages:4});
  try{
   reference.render();autonomous.render();
   const baseline=reference.capture(),prepared=autonomous.capture();
   let maxDifference=0,foreground=0;for(let i=0;i<baseline.length;i+=4){maxDifference=Math.max(maxDifference,Math.abs(baseline[i]-prepared[i]),Math.abs(baseline[i+1]-prepared[i+1]),Math.abs(baseline[i+2]-prepared[i+2]));if(prepared[i]>30&&prepared[i]>prepared[i+1]*1.5)foreground++;}
   return {maxDifference,foreground,metrics:autonomous.render(),backend:autonomous.backend,autonomousRequests:performance.getEntriesByType('resource').slice(before).map(entry=>entry.name)};
  }finally{reference.dispose();autonomous.dispose();}
 },`http://127.0.0.1:${dataAddress.port}/native/full/manifest.json`);
 assert.deepEqual(errors,[]);assert.equal(result.backend,'autonomous-pages-webgl');assert.equal(result.metrics.coverageReady,true);assert.ok(result.foreground>50,String(result.foreground));assert.ok(result.maxDifference<=5,String(result.maxDifference));
 assert.ok(!result.autonomousRequests.some(url=>url.endsWith('/source.bin')),result.autonomousRequests.join(', '));
 console.log(JSON.stringify({status:'passed',foreground:result.foreground,maxDifference:result.maxDifference,sourceBinRequests:0}));
}finally{await browser?.close();await vite?.close();if(dataServer)await new Promise(ok=>dataServer.close(ok));await rm(html,{force:true});await rm(root,{recursive:true,force:true});}
