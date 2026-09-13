import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {exactPagesBackend} from './index.ts';
import type {ClusterManifest} from '../sdk-core/index.ts';

/** Four leaves, two mid clusters, one root; the root bundle is pinned, the rest follows. */
function fixture(){
 const positions:number[]=[];
 for(let t=0;t<4;t++){const x=-2+t;positions.push(x,-.5,0,x+1,-.5,0,x+.5,.5,0);}
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setIndex([...Array(12).keys()]);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 const mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 const leftSphere=[-1,0,0,1.2],rightSphere=[1,0,0,1.2],rootSphere=[0,0,0,2.3];
 const midError=.02,rootError=.2;
 const leaf=(id:number)=>({id,url:`leaf${id}`,sha256:`leaf${id}`,bytes:12,count:3,
  min:[-2+id,-.5,0],max:[-1+id,.5,0],role:'exact' as const,level:0,lodError:0,
  sphere:[-1.5+id,0,0,.6],parentError:midError,parentSphere:id<2?leftSphere:rightSphere,group:id<2?0:1,source:null,
  stream:1,streamOffset:id*12});
 const pages=[
  leaf(0),leaf(1),leaf(2),leaf(3),
  {id:4,url:'mid-left',sha256:'mid-left',bytes:12,count:3,min:[-2,-.5,0],max:[0,.5,0],role:'coarse' as const,level:1,lodError:midError,sphere:leftSphere,parentError:rootError,parentSphere:rootSphere,group:2,source:0,stream:2,streamOffset:0},
  {id:5,url:'mid-right',sha256:'mid-right',bytes:12,count:3,min:[0,-.5,0],max:[2,.5,0],role:'coarse' as const,level:1,lodError:midError,sphere:rightSphere,parentError:rootError,parentSphere:rootSphere,group:2,source:1,stream:2,streamOffset:12},
  {id:6,url:'root',sha256:'root',bytes:12,count:3,min:[-2,-.5,0],max:[2,.5,0],role:'coarse' as const,level:2,lodError:rootError,sphere:rootSphere,parentError:null,parentSphere:null,group:null,source:2,stream:0,streamOffset:0},
 ];
 const structure={version:1,roots:[6],groups:[
  {level:1,error:midError,sphere:leftSphere,children:[0,1],outputs:[4]},
  {level:1,error:midError,sphere:rightSphere,children:[2,3],outputs:[5]},
  {level:2,error:rootError,sphere:rootSphere,children:[4,5],outputs:[6]},
 ]};
 const streams={version:1,pinned:1,bundleBytes:65536,pages:[
  {url:'bundle-roots',sha256:'roots',bytes:12,count:1},
  {url:'bundle-leaves',sha256:'leaves',bytes:48,count:4},
  {url:'bundle-mid',sha256:'mid',bytes:24,count:2},
 ]};
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',clusterStrategy:'dag-groups',pages,hierarchy:null,structure,streams}]} as unknown as ClusterManifest;
 return {geometry,material,mesh,source,metadata,associations:new Map([[mesh,{meshes:0,primitives:0}]])};
}
function camera(){const cam=new THREE.PerspectiveCamera(55,16/9,.1,1000);cam.position.set(0,0,5);cam.lookAt(0,0,0);cam.updateMatrixWorld();cam.updateProjectionMatrix();return cam;}

test('the root cover is the first thing a cold explorer asks for, and the only thing',()=>{
 const scene=fixture();
 const backend=exactPagesBackend({source:scene.source,metadata:scene.metadata,indices:new Map(),associations:scene.associations,pixelError:0,viewport:[1280,720] as [number,number]});
 backend.render(camera());
 // Nothing is resident: the cut wants the leaves, but what is asked for is the fallback cover.
 assert.deepEqual(backend.pendingUrls?.(),['bundle-roots'],'the coarse complete cover comes first');
 assert.ok(backend.pageUrls?.().includes('bundle-roots'),'and is retained against eviction');
 // The root bundle lands: the scene is drawable, and only now is the detail asked for.
 backend.acceptPage?.('bundle-roots',new Uint32Array([0,1,2]));
 backend.render(camera());
 assert.equal(backend.metrics().submittedTriangles,1,'the root alone already covers the surface');
 const next=backend.pendingUrls?.();
 assert.ok(next&&next.length>0&&!next.includes('bundle-roots'),'the detail follows the cover');
 assert.deepEqual([...(next??[])].sort(),['bundle-leaves'],'and it is the cut the camera asked for');
 backend.dispose();scene.geometry.dispose();scene.material.dispose();
});

test('the ring a prefetch pulls is the next finer level, and only once nothing visible is missing',()=>{
 const scene=fixture();
 const backend=exactPagesBackend({source:scene.source,metadata:scene.metadata,indices:new Map(),associations:scene.associations,pixelError:4,viewport:[1280,720] as [number,number]});
 backend.render(camera());
 backend.acceptPage?.('bundle-roots',new Uint32Array([0,1,2]));
 backend.render(camera());
 // Four pixels of budget put the cut on the mid clusters; half of it reaches the leaves.
 assert.deepEqual(backend.pendingUrls?.(),['bundle-mid'],'the cut comes before any ring');
 backend.acceptPage?.('bundle-mid',new Uint32Array([0,1,2,3,4,5]));
 backend.render(camera());
 assert.deepEqual(backend.pendingUrls?.(),[],'nothing visible is missing');
 assert.deepEqual(backend.prefetchUrls?.(),['bundle-leaves'],'the ring is the next finer level');
 backend.dispose();scene.geometry.dispose();scene.material.dispose();
});
