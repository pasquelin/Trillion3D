import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {EngineError,type ClusterManifest} from '../sdk-core/index.ts';
import {acceptPageArray,collectClusterPages,collectPendingUrls,indexPagesByUrl,pageRequestUrl,rootCoverage,selectVisiblePages,type PageRec,type SelectionResult} from './pageSelection.ts';
import {cameraSelectionUniforms} from './gpuSelection.ts';
import {evaluateDagSelectionKernel,packDagSelection} from './gpuDagSelection.ts';

function blendFixture(material:THREE.Material=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide})){
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0,99,-1,0,101,-1,0,100,1,0],3));
 geometry.setIndex([0,1,2,3,4,5]);
 const mesh=new THREE.Mesh(geometry,material),source=new THREE.Group();source.add(mesh);
 // Two level-0 clusters that nothing replaces: the smallest legal DAG, so both are root clusters.
 const pages=[
  {id:0,url:'near',count:3,bytes:12,sha256:'near',min:[-1,-1,0],max:[1,1,0],role:'exact' as const,start:0,
   level:0,lodError:0,sphere:[0,0,0,1.5],parentError:null,parentSphere:null,group:null,source:null},
  {id:1,url:'far',count:3,bytes:12,sha256:'far',min:[99,-1,0],max:[101,1,0],role:'exact' as const,start:3,
   level:0,lodError:0,sphere:[100,0,0,1.5],parentError:null,parentSphere:null,group:null,source:null},
 ];
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'clustered-blend',clusterStrategy:'dag-groups' as const,pages,
  structure:{version:1,roots:[0,1],groups:[]}}]} as unknown as ClusterManifest;
 const indices=new Map([['near',new Uint32Array([0,1,2])],['far',new Uint32Array([3,4,5])]]);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 return {geometry,material,mesh,source,metadata,indices,associations};
}

function camera(){const camera=new THREE.PerspectiveCamera(55,1,.1,1000);camera.position.z=5;camera.lookAt(0,0,0);camera.updateMatrixWorld();return camera;}

test('clustered blend pages retain their source and only select the intersecting part of a mesh',()=>{
 const fixture=blendFixture();
 const {roots,allPages,blendCopies}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.equal(blendCopies.length,0);
 assert.equal(allPages.length,2);
 for(const page of allPages){assert.equal(page.transparent,true);assert.equal(page.sourceMesh,fixture.mesh);}
 const selected=selectVisiblePages(roots,camera(),{pixelError:100,viewport:[960,540],frame:1,holdResident:true});
 assert.deepEqual(selected.shown.map(page=>page.url),['near']);
 assert.equal(selected.displayedTriangles,1);
 assert.equal(selected.complete,true);
 assert.deepEqual(rootCoverage(roots).map(page=>page.url),['near','far']);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('clustered blend never reports missing exact coverage as resident',()=>{
 const fixture=blendFixture();fixture.indices.delete('near');
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations,{allowMissing:true});
 const selected=selectVisiblePages(roots,camera(),{frame:1,holdResident:true});
 assert.equal(selected.complete,false);
 assert.deepEqual(selected.wanted.map(page=>page.url),['near']);
 assert.deepEqual(selected.shown,[]);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('double-sided blend pages survive backface cones in CPU and packed GPU selection',()=>{
 const fixture=blendFixture();
 const {roots,allPages}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 allPages[0].cone={axis:[0,0,-1],angle:0};
 const cam=camera(),packed=packDagSelection(roots);
 const cpu=selectVisiblePages(roots,cam,{frame:1});
 const gpu=evaluateDagSelectionKernel(packed,cameraSelectionUniforms(cam,0,[960,540]));
 assert.deepEqual(cpu.shown.map(page=>page.url),['near']);
 assert.deepEqual(gpu.pageIds.map(id=>packed.pageUrls[id]),['near']);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('clustered blend classification remains explicit if material transparency was disabled',()=>{
 const fixture=blendFixture(new THREE.MeshBasicMaterial());
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.equal(collected.allPages[0].transparent,true);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('transparent source materials on legacy exact pages still use the forward pass',()=>{
 const fixture=blendFixture();fixture.metadata.primitives[0].pass='exact-clusters';
 const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.equal(collected.allPages[0].transparent,true);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('shared blend and runtime transmission keep their full source fallback',()=>{
 for(const pass of ['shared-blend','clustered-blend']){
  const material=pass==='clustered-blend'?new THREE.MeshPhysicalMaterial({transmission:1}):new THREE.MeshBasicMaterial({transparent:true});
  const fixture=blendFixture(material);fixture.metadata.primitives[0].pass=pass;
  const collected=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
  assert.equal(collected.allPages.length,0);
  assert.equal(collected.roots.length,0);
  assert.equal(collected.blendCopies.length,1);
  assert.equal(collected.blendCopies[0].geometry,fixture.geometry);
  fixture.geometry.dispose();fixture.material.dispose();
 }
});

/** Four source triangles in a row, replaced by two mid clusters, then by one root. */
function dagFixture(){
 const positions:number[]=[];
 for(let t=0;t<4;t++){const x=-2+t;positions.push(x,-.5,0,x+1,-.5,0,x+.5,.5,0);}
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setIndex([...Array(12).keys()]);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
 const source=new THREE.Group();source.add(mesh);
 const leftSphere=[-1,0,0,1.2],rightSphere=[1,0,0,1.2],rootSphere=[0,0,0,2.3];
 const midError=.02,rootError=.2;
 const leaf=(id:number)=>({id,url:`leaf${id}`,sha256:`leaf${id}`,bytes:12,count:3,
  min:[-2+id,-.5,0],max:[-1+id,.5,0],role:'exact' as const,level:0,lodError:0,
  sphere:[-1.5+id,0,0,.6],parentError:midError,parentSphere:id<2?leftSphere:rightSphere,group:id<2?0:1,source:null});
 const pages=[
  leaf(0),leaf(1),leaf(2),leaf(3),
  {id:4,url:'mid-left',sha256:'mid-left',bytes:12,count:3,min:[-2,-.5,0],max:[0,.5,0],role:'coarse' as const,level:1,lodError:midError,sphere:leftSphere,parentError:rootError,parentSphere:rootSphere,group:2,source:0},
  {id:5,url:'mid-right',sha256:'mid-right',bytes:12,count:3,min:[0,-.5,0],max:[2,.5,0],role:'coarse' as const,level:1,lodError:midError,sphere:rightSphere,parentError:rootError,parentSphere:rootSphere,group:2,source:1},
  {id:6,url:'root',sha256:'root',bytes:12,count:3,min:[-2,-.5,0],max:[2,.5,0],role:'coarse' as const,level:2,lodError:rootError,sphere:rootSphere,parentError:null,parentSphere:null,group:null,source:2},
 ];
 const structure={version:1,roots:[6],groups:[
  {level:1,error:midError,sphere:leftSphere,children:[0,1],outputs:[4]},
  {level:1,error:midError,sphere:rightSphere,children:[2,3],outputs:[5]},
  {level:2,error:rootError,sphere:rootSphere,children:[4,5],outputs:[6]},
 ]};
 const metadata={errorModel:'dag-group-qem-v1',clusterStrategy:'dag-groups',primitives:[{mesh:0,primitive:0,pass:'exact-clusters',clusterStrategy:'dag-groups' as const,pages,hierarchy:null,structure}]} as unknown as ClusterManifest;
 const indices=new Map(pages.map(page=>[page.url,new Uint32Array([0,1,2])]));
 for(let id=0;id<4;id++)indices.set(`leaf${id}`,new Uint32Array([id*3,id*3+1,id*3+2]));
 return {geometry,mesh,source,metadata,indices,associations:new Map([[mesh,{meshes:0,primitives:0}]])};
}
function wideCamera(){const cam=new THREE.PerspectiveCamera(55,16/9,.1,1000);cam.position.set(0,0,5);cam.lookAt(0,0,0);cam.updateMatrixWorld();return cam;}
function urls(fixture:ReturnType<typeof dagFixture>,pixelError:number,cam=wideCamera()){
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 return selectVisiblePages(roots,cam,{pixelError,viewport:[1280,720],frame:1,holdResident:true}).shown.map(page=>page.url).sort();
}

test('a flat cluster cut selects exactly one level per chain and covers the surface once',()=>{
 const fixture=dagFixture();
 assert.deepEqual(urls(fixture,0),['leaf0','leaf1','leaf2','leaf3']);
 assert.deepEqual(urls(fixture,8),['mid-left','mid-right']);
 assert.deepEqual(urls(fixture,200),['root']);
 // Every threshold keeps exactly one cluster of each leaf-to-root chain.
 const chains=[['leaf0','mid-left','root'],['leaf1','mid-left','root'],['leaf2','mid-right','root'],['leaf3','mid-right','root']];
 for(const pixelError of [0,1,4,7.4,7.6,20,138,139,1e6]){
  const shown=new Set(urls(fixture,pixelError));
  for(const chain of chains)assert.equal(chain.filter(url=>shown.has(url)).length,1,`pixelError ${pixelError}: ${chain.join('>')}`);
 }
 fixture.geometry.dispose();
});

test('a flat cluster cut keeps the frustum cut and reports the root cover',()=>{
 const fixture=dagFixture();
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.deepEqual(rootCoverage(roots).map(page=>page.url),['root']);
 const cam=new THREE.PerspectiveCamera(40,1,.1,1000);cam.position.set(-1.5,0,2);cam.lookAt(-1.5,0,0);cam.updateMatrixWorld();
 const selected=selectVisiblePages(roots,cam,{pixelError:0,viewport:[1280,720],frame:1,holdResident:true});
 assert.deepEqual(selected.shown.map(page=>page.url).sort(),['leaf0','leaf1']);
 assert.ok(selected.frustumRejected>0);
 fixture.geometry.dispose();
});

/** One representation per group: either every child, or the coarse output, never both, never none. */
function assertOneRepresentationPerGroup(shown:readonly string[]){
 const drawn=new Set(shown);
 const regions=[
  {children:['leaf0','leaf1'],output:'mid-left'},
  {children:['leaf2','leaf3'],output:'mid-right'},
  {children:['mid-left','mid-right'],output:'root'},
 ];
 for(const region of regions){
  const fine=region.children.filter(url=>drawn.has(url)).length;
  const coarse=drawn.has(region.output)?1:0;
  // A region is covered by its own output, by its children, or by something coarser above it.
  assert.ok(!(coarse&&fine),`${region.output}: covered twice`);
 }
 // Exactly one representation of the whole surface.
 const leftCovered=drawn.has('root')||drawn.has('mid-left')||(drawn.has('leaf0')&&drawn.has('leaf1'));
 const rightCovered=drawn.has('root')||drawn.has('mid-right')||(drawn.has('leaf2')&&drawn.has('leaf3'));
 assert.ok(leftCovered&&rightCovered,`hole in ${[...drawn].join(',')}`);
}

test('a missing cluster steps its whole group back to the coarse representation, never leaving a hole',()=>{
 const fixture=dagFixture();fixture.indices.delete('leaf0');
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations,{allowMissing:true});
 const selected=selectVisiblePages(roots,wideCamera(),{pixelError:0,viewport:[1280,720],frame:1,holdResident:true});
 const shown=selected.shown.map(page=>page.url).sort();
 assert.deepEqual(shown,['leaf2','leaf3','mid-left'],'the left half falls back, the right half stays fine');
 assertOneRepresentationPerGroup(shown);
 assert.deepEqual(selected.wanted.map(page=>page.url).sort(),['leaf0','leaf1','leaf2','leaf3'],'the finer cut is still requested');
 assert.equal(selected.complete,false,'the cut is not resident yet, even though the frame has no hole');
 assert.equal(selected.displayedTriangles,3,'every displayed cluster is drawable');
 fixture.geometry.dispose();
});

test('a missing coarse cluster keeps stepping back until the pinned root covers everything',()=>{
 const fixture=dagFixture();fixture.indices.delete('leaf0');fixture.indices.delete('mid-left');
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations,{allowMissing:true});
 const selected=selectVisiblePages(roots,wideCamera(),{pixelError:0,viewport:[1280,720],frame:1,holdResident:true});
 const shown=selected.shown.map(page=>page.url).sort();
 assert.deepEqual(shown,['root'],'the whole primitive falls back to its root');
 assertOneRepresentationPerGroup(shown);
 fixture.geometry.dispose();
});

test('the fallback covers the surface once for every residency pattern',()=>{
 const urlsByBit=['leaf0','leaf1','leaf2','leaf3','mid-left','mid-right'];
 for(let mask=0;mask<64;mask++){
  const fixture=dagFixture();
  for(let bit=0;bit<urlsByBit.length;bit++)if(mask&(1<<bit))fixture.indices.delete(urlsByBit[bit]);
  const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations,{allowMissing:true});
  for(const pixelError of [0,4,20]){
   const selected=selectVisiblePages(roots,wideCamera(),{pixelError,viewport:[1280,720],frame:1,holdResident:true});
   const shown=selected.shown.map(page=>page.url).sort();
   assert.ok(shown.length>0,`mask ${mask} px ${pixelError}: nothing drawn`);
   assertOneRepresentationPerGroup(shown);
   assert.ok(selected.shown.every(page=>!!page.array),`mask ${mask}: a missing page was drawn`);
  }
  fixture.geometry.dispose();
 }
});

test('the root cover is what stays pinned for a flat cut',()=>{
 const fixture=dagFixture();
 const {roots,bootstrap}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.deepEqual(bootstrap.map(page=>page.url),['root']);
 assert.deepEqual(rootCoverage(roots).map(page=>page.url),['root']);
 fixture.geometry.dispose();
});

test('a page whose replacement error sits below its own error is rejected at load time',()=>{
 const fixture=dagFixture();
 fixture.metadata.primitives[0].pages[4].parentError=0.001;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/parentError sous lodError/);
 fixture.metadata.primitives[0].pages[4].parentError=0.2;
 fixture.metadata.primitives[0].pages[4].parentSphere=null;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/parentError sans parentSphere/);
 fixture.geometry.dispose();
});

/** Hand-built hierarchy over the fixture: leaves in one child, coarse levels in the other. */
function dagCulling(){
 const left=[-1,0,0,1.2],right=[1,0,0,1.2],rootSphere=[0,0,0,2.3];
 const both=[0,0,0,2.2];
 const whole=[-2,-.5,0,2,.5,0];
 const node=(box:number[],sphere:number[],maxParent:number,firstChild:number,childCount:number,firstPage:number,pageCount:number)=>
  [...box,...sphere,maxParent,firstChild,childCount,firstPage,pageCount];
 return {stride:15,count:3,nodes:[
  ...node(whole,rootSphere,-1,1,2,0,0),
  ...node(whole,both,.02,0,0,0,4),
  ...node(whole,rootSphere,-1,0,0,4,3),
 ]};
}

test('the culling hierarchy accelerates the flat cut without changing it',()=>{
 const plain=dagFixture(),accelerated=dagFixture();
 accelerated.metadata.primitives[0].culling=dagCulling();
 const cam=wideCamera();
 for(const pixelError of [0,1,3.4,3.6,20,60,200,1e6]){
  const a=urls(plain,pixelError,cam),b=urls(accelerated,pixelError,cam);
  assert.deepEqual(b,a,`pixelError ${pixelError}`);
 }
 // The leaf subtree must actually be skipped once its replacement error fits the budget.
 const {roots}=collectClusterPages(accelerated.source,accelerated.metadata,accelerated.indices,accelerated.associations);
 assert.ok(roots[0].culling,'the hierarchy must be unpacked');
 const coarse=selectVisiblePages(roots,cam,{pixelError:20,viewport:[1280,720],frame:1});
 assert.deepEqual(coarse.shown.map(page=>page.url).sort(),['mid-left','mid-right']);
 plain.geometry.dispose();accelerated.geometry.dispose();
});

test('a culling hierarchy that does not match its pages is rejected',()=>{
 const fixture=dagFixture();
 const broken=dagCulling();broken.nodes[15+13]=99; // the leaf child now claims pages past the end
 fixture.metadata.primitives[0].culling=broken;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/culling/i);
 const short=dagCulling();short.count=4;
 fixture.metadata.primitives[0].culling=short;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/culling/i);
 fixture.geometry.dispose();
});

test('transparent flat pages keep a draw order taken from their source rank',()=>{
 const fixture=dagFixture();
 fixture.mesh.material=new THREE.MeshBasicMaterial({transparent:true});
 for(const page of fixture.metadata.primitives[0].pages)page.start=(6-page.id)*3;
 const {allPages}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 assert.deepEqual(allPages.map(page=>page.sourceOrder),[18,15,12,9,6,3,0]);
 fixture.geometry.dispose();
});

/** Two bundles: the roots on their own, then the rest. Offsets are the page order inside each. */
function withBundles(fixture:ReturnType<typeof dagFixture>){
 const pages=fixture.metadata.primitives[0].pages;
 const rootPages=pages.filter(page=>page.parentError==null),rest=pages.filter(page=>page.parentError!=null);
 const layout=(list:typeof pages,stream:number)=>{
  let offset=0;
  for(const page of list){page.stream=stream;page.streamOffset=offset;offset+=page.count*4;}
  return offset;
 };
 const rootBytes=layout(rootPages,0),restBytes=layout(rest,1);
 fixture.metadata.primitives[0].streams={version:1,pinned:1,bundleBytes:65536,pages:[
  {url:'bundle-roots',sha256:'roots',bytes:rootBytes,count:rootPages.length},
  {url:'bundle-rest',sha256:'rest',bytes:restBytes,count:rest.length},
 ]};
 const pack=(list:typeof pages)=>{
  const array=new Uint32Array(list.reduce((sum,page)=>sum+page.count,0));
  let at=0;for(const page of list){array.set(fixture.indices.get(page.url)??new Uint32Array(page.count),at);at+=page.count;}
  return array;
 };
 return {roots:pack(rootPages),rest:pack(rest)};
}

test('a streaming bundle is one request that makes every cluster it carries drawable',()=>{
 const fixture=dagFixture();
 const bundled=withBundles(fixture);
 const {roots,allPages}=collectClusterPages(fixture.source,fixture.metadata,new Map(),fixture.associations,{allowMissing:true});
 const byUrl=indexPagesByUrl(allPages);
 assert.deepEqual([...byUrl.keys()].sort(),['bundle-rest','bundle-roots'],'residency is a property of the bundle');
 const pending=collectPendingUrls(allPages,[]);
 assert.deepEqual(pending.sort(),['bundle-rest','bundle-roots'],'seven clusters cost two requests');
 acceptPageArray(byUrl.get('bundle-rest')!,bundled.rest);
 acceptPageArray(byUrl.get('bundle-roots')!,bundled.roots);
 for(const rec of allPages){
  assert.ok(rec.array,`${rec.url} not resident after its bundle arrived`);
  assert.equal(rec.array!.length,rec.triangles*3);
  assert.deepEqual([...rec.array!],[...(fixture.indices.get(rec.url) as Uint32Array)],`${rec.url} reads the wrong slice of its bundle`);
 }
 const selected=selectVisiblePages(roots,wideCamera(),{pixelError:0,viewport:[1280,720],frame:1,holdResident:true});
 assert.deepEqual(selected.shown.map(page=>page.url).sort(),['leaf0','leaf1','leaf2','leaf3']);
 fixture.geometry.dispose();
});

test('only the root bundle resident still covers the surface once',()=>{
 const fixture=dagFixture();
 const bundled=withBundles(fixture);
 const {roots,allPages,bootstrap}=collectClusterPages(fixture.source,fixture.metadata,new Map(),fixture.associations,{allowMissing:true});
 assert.deepEqual(bootstrap.map(page=>pageRequestUrl(page)),['bundle-roots']);
 acceptPageArray(indexPagesByUrl(allPages).get('bundle-roots')!,bundled.roots);
 const selected=selectVisiblePages(roots,wideCamera(),{pixelError:0,viewport:[1280,720],frame:1,holdResident:true});
 assert.deepEqual(selected.shown.map(page=>page.url),['root'],'the pinned root covers the frame on its own');
 assert.deepEqual(selected.wanted.map(page=>page.url).sort(),['leaf0','leaf1','leaf2','leaf3'],'the finer cut keeps driving the streamer');
 assert.ok(collectPendingUrls(selected.wanted,[]).includes('bundle-rest'),'the missing bundle is what gets requested');
 fixture.geometry.dispose();
});

test('a cut wider than the page budget is answered by a coarser cut, not by dropped clusters',()=>{
 const fixture=dagFixture();
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const full=selectVisiblePages(roots,wideCamera(),{pixelError:0,viewport:[1280,720],frame:1,holdResident:true});
 assert.equal(full.shown.length,4);
 const tight=selectVisiblePages(roots,wideCamera(),{pixelError:0,viewport:[1280,720],frame:2,holdResident:true,pageBudget:3});
 assert.ok(tight.shown.length<=3);
 assertOneRepresentationPerGroup(tight.shown.map(page=>page.url));
 assert.ok(tight.pixelError>0,'the threshold was raised instead of truncating the cut');
 fixture.geometry.dispose();
});

test('budget pressure down to the pinned roots still publishes a complete, coarser cut',()=>{
 const cam=wideCamera(),viewport:[number,number]=[1280,720];
 const fixture=dagFixture();
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 // A budget below the finest cut answers with the next coarser complete cover, at its own threshold.
 const tight=selectVisiblePages(roots,cam,{pixelError:0,viewport,frame:1,holdResident:true,pageBudget:3});
 assert.deepEqual(tight.shown.map(page=>page.url).sort(),['mid-left','mid-right']);
 assert.ok(tight.pixelError>0);
 assert.equal(tight.complete,true);
 // Budget pressure evicted every intermediate level: only the pinned roots are resident. The cut
 // published must still cover the surface once rather than report an incomplete frame.
 const pinned=new Set(rootCoverage(roots).map(page=>page.url));
 assert.deepEqual([...pinned],['root']);
 const starved=selectVisiblePages(roots,cam,{pixelError:0,viewport,frame:2,holdResident:true,rootFallback:true,isResident:rec=>pinned.has(rec.url)});
 assert.equal(starved.complete,true,'the pinned root cover leaves no hole');
 assert.deepEqual(starved.shown.map(page=>page.url),['root']);
 // The wanted cut is untouched, so streaming still asks the detail back.
 assert.deepEqual(starved.wanted.map(page=>page.url).sort(),['leaf0','leaf1','leaf2','leaf3']);
 fixture.geometry.dispose();
});

test('a primitive whose clusters carry no DAG error band is refused by name, not half-read',()=>{
 const fixture=dagFixture();
 for(const page of fixture.metadata.primitives[0].pages)delete (page as {lodError?:number}).lodError;
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),
  (error:unknown)=>error instanceof EngineError&&error.code==='STALE_CACHE'&&/without a DAG error band/.test(error.message));
 fixture.geometry.dispose();
});

test('une image de coupe réutilise sa table plate, son résultat et ses tableaux : elle n\'alloue rien',()=>{
 const fixture=blendFixture();
 const {roots}=collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations);
 const table=roots[0].table,shown:PageRec[]=[],wanted:PageRec[]=[];
 const result:SelectionResult<PageRec>={shown,wanted,visible:0,selectedTriangles:0,displayedTriangles:0,frustumRejected:0,lodLevel:0,complete:true,pixelError:0};
 const cam=camera(),ask={pixelError:100,viewport:[960,540] as [number,number],frame:1,holdResident:true,wanted,result};
 const first=selectVisiblePages(roots,cam,ask,shown);
 ask.frame=2;
 const second=selectVisiblePages(roots,cam,ask,shown);
 assert.equal(second,first,'le résultat rendu est celui fourni, image après image');
 assert.equal(second,result);
 assert.equal(second.shown,shown);
 assert.equal(second.wanted,wanted);
 assert.equal(roots[0].table,table,'la table plate est construite avec la primitive, jamais par image');
 assert.deepEqual(second.shown.map(page=>page.url),['near']);
 fixture.geometry.dispose();fixture.material.dispose();
});

test('une bande de cluster invalide est refusée à la préparation, pas au milieu d\'une image',()=>{
 const fixture=blendFixture();
 // La sphère propre est déjà validée au chargement ; celle du remplaçant ne l'était nulle part.
 const page=fixture.metadata.primitives[0].pages[0] as {parentError:number|null;parentSphere:number[]|null};
 page.parentError=1;page.parentSphere=[0,0,0,-1];
 assert.throws(()=>collectClusterPages(fixture.source,fixture.metadata,fixture.indices,fixture.associations),/Parametres de cluster invalides/);
 fixture.geometry.dispose();fixture.material.dispose();
});
