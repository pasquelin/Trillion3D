import test from 'node:test';import assert from 'node:assert/strict';
import {decodeManifestBinary,encodeManifestBinary,MANIFEST_BINARY_MAGIC,MANIFEST_BINARY_VERSION} from './manifestBinary.ts';
import {assertCacheIdentity,EngineError,type ClusterManifest} from './contracts.ts';

const TEMPLATES={url:'clusters.bin',pageUrl:'../../objects/{sha}.bin',geometryUrl:'../../objects/{sha}.wgpg',bundleUrl:'../../objects/{sha}.wgsb'};
const sha=(c:string)=>c.repeat(64);
const url=(c:string,extension:string)=>`../../objects/${sha(c)}.${extension}`;

/** Every optional field in both of its shapes: a round trip that misses one would show here. */
function manifest():ClusterManifest{
 const dagPages=[
  {id:0,url:url('a','bin'),sha256:sha('a'),bytes:48,count:12,start:0,min:[-1,-2,-3],max:[1,2,3],role:'exact' as const,
   geometry:{url:url('b','wgpg'),sha256:sha('b'),bytes:32,formatVersion:2 as const,codec:'meshopt' as const,vertexCount:8,indexCount:12,flags:15,uncompressedBytes:128},
   level:0,lodError:0,sphere:[0,0,0,3.7416573867739413],parentError:0.25,parentSphere:[0.5,0,0,4],group:0,source:null,stream:0,streamOffset:0},
  {id:1,url:url('c','bin'),sha256:sha('c'),bytes:48,count:12,start:12,min:[0,0,0],max:[2,2,2],role:'coarse' as const,
   level:1,lodError:0.25,sphere:[1,1,1,1.7320508075688772],parentError:null,parentSphere:null,group:null,source:0,stream:0,streamOffset:48},
 ];
 // A cache with no DAG at all: no level, no error, no group, no bundle, no packed geometry.
 const treePages=[{id:0,url:url('d','bin'),sha256:sha('d'),bytes:24,count:6,min:[0,0,0],max:[1,1,1]}];
 return {
  schema:2,formatVersion:2,status:'ready',key:'k',scope:'full',errorModel:'dag-group-qem-v1',simplification:true,
  sourceTriangles:8,selectedTriangles:8,selectedNodes:[0,1],totalNodes:2,autonomousScene:null,
  primitives:[
   {mesh:0,primitive:0,pass:'exact-clusters',clusterStrategy:'dag-groups',pages:dagPages,hierarchy:null,
    culling:{stride:15,count:1,nodes:[-1,-2,-3,1,2,3,0,0,0,3.7416573867739413,-1,0,0,0,2]},
    structure:{version:1,roots:[1],groups:[{level:1,error:0.25,sphere:[0.5,0,0,4],children:[0],outputs:[1]}]},
    streams:{version:1,pinned:1,bundleBytes:131072,pages:[{url:url('e','wgsb'),sha256:sha('e'),bytes:96,count:2}]},
    topology:{triangles:8,edges:{boundary:4,manifold:8,nonManifold:0},vertices:{interior:1,boundary:4,locked:0,unused:0},manifold:true}},
   {mesh:1,primitive:0,pass:'exact-clusters',pages:treePages,hierarchy:{min:[0,0,0],max:[1,1,1],page:0},culling:null,structure:null,streams:null},
  ],
 } as ClusterManifest;
}

test('a manifest survives the binary columns unchanged, field by field',()=>{
 const source=manifest();
 const {manifest:slim,binary}=encodeManifestBinary(source,TEMPLATES);
 slim.binary.sha256=sha('f');
 const header=new Uint32Array(binary.buffer,binary.byteOffset,4);
 assert.equal(header[0],MANIFEST_BINARY_MAGIC,'the file names its own format');
 assert.equal(header[1],MANIFEST_BINARY_VERSION);
 assert.equal(slim.binary.bytes,binary.byteLength);
 // The small JSON keeps what a reader parses and loses what it maps.
 const text=JSON.stringify(slim);
 assert.ok(!text.includes(sha('a')),'no cluster digest survives in the JSON');
 assert.ok(!text.includes('lodError'),'no per-cluster number survives in the JSON');
 assert.equal(slim.primitives[0].binary.pages,2);
 assert.deepEqual(slim.primitives[0].binary.structure,{version:1,groups:1,roots:1});
 assert.deepEqual(slim.primitives[1].binary,{pages:1,culling:null,structure:null,streams:null});
 const decoded=decodeManifestBinary(JSON.parse(text),binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength));
 assert.deepEqual(decoded,source);
 // Identity is a property of the decoded pages, so it holds after decoding and not before.
 assertCacheIdentity(decoded);
 assert.throws(()=>assertCacheIdentity(slim as unknown as ClusterManifest),(error:EngineError)=>error.code==='INVALID_CACHE');
});

test('a binary from another version, or shorter than it claims, is refused',()=>{
 const {manifest:slim,binary}=encodeManifestBinary(manifest(),TEMPLATES);
 slim.binary.sha256=sha('f');
 const buffer=binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength);
 const bumped=buffer.slice(0);new Uint32Array(bumped,4,1)[0]=MANIFEST_BINARY_VERSION+1;
 assert.throws(()=>decodeManifestBinary(slim,bumped),(error:EngineError)=>error.code==='UNSUPPORTED_FORMAT');
 const unsigned=buffer.slice(0);new Uint32Array(unsigned,0,1)[0]=0;
 assert.throws(()=>decodeManifestBinary(slim,unsigned),(error:EngineError)=>error.code==='INVALID_CACHE');
 assert.throws(()=>decodeManifestBinary(slim,buffer.slice(0,buffer.byteLength-8)),(error:EngineError)=>error.code==='INVALID_CACHE');
 const wrongCounts=structuredClone(slim);wrongCounts.primitives[0].binary.pages=3;
 assert.throws(()=>decodeManifestBinary(wrongCounts,buffer),(error:EngineError)=>error.code==='INVALID_CACHE');
 const wrongVersion=structuredClone(slim);wrongVersion.binary.version=MANIFEST_BINARY_VERSION+1;
 assert.throws(()=>decodeManifestBinary(wrongVersion,buffer),(error:EngineError)=>error.code==='UNSUPPORTED_FORMAT');
});

test('a cluster url that does not follow the manifest template is refused at encoding',()=>{
 const source=manifest();
 source.primitives[0].pages[0].url='pages/0.bin';
 assert.throws(()=>encodeManifestBinary(source,TEMPLATES),(error:EngineError)=>error.code==='INVALID_CACHE');
});
