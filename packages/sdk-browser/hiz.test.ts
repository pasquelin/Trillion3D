import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compareImages,HIZ_BACKGROUND} from '../sdk-core/index.ts';
import {rasterVisibilityIds,shadeVisibility,type VisPage} from './visibilityBuffer.ts';
import {HIZ_BOUNDS_VALUES,buildHizPyramid,countUnoccluded,createBoxCorners,createHizCounts,filterUnoccluded,hizOversized,hizRejects,projectBoxToScreen,projectBoxesFlat,sameHizView,splitOccluders,splitOccludersFlat,visibilityDepth,applyTemporalHiz,type HizPage,type TemporalHizState} from './hiz.ts';

test('Hi-Z history is invalidated by camera motion and projection cuts',()=>{
 const previous=cameraAt(),current=previous.clone();
 assert.equal(sameHizView(previous,current),true);
 current.position.x=1;current.updateMatrixWorld();assert.equal(sameHizView(previous,current),false);
 current.position.x=0;current.fov=75;current.updateProjectionMatrix();current.updateMatrixWorld();assert.equal(sameHizView(previous,current),false);
});

function cameraAt(z=5,near=.1){
 const cam=new THREE.PerspectiveCamera(55,1,near,100);cam.position.z=z;cam.lookAt(0,0,0);cam.updateMatrixWorld();return cam;
}

function quad(material:THREE.Material,min:number[],max:number[],clusterId:string):{page:VisPage&HizPage;geometry:THREE.BufferGeometry}{
 const z=(min[2]+max[2])*0.5;
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([min[0],min[1],z,max[0],min[1],z,max[0],max[1],z,min[0],max[1],z],3));
 geometry.setIndex([0,1,2,0,2,3]);
 const page:VisPage&HizPage={array:new Uint32Array([0,1,2,0,2,3]),attributes:geometry.attributes,matrix:new THREE.Matrix4(),material,clusterId,min,max,url:clusterId};
 return {page,geometry};
}

test('visibility depth after the visbuffer uses background 1 and closer-wins z',()=>{
 const material=new THREE.MeshBasicMaterial({color:0xff0000});
 const {page,geometry}=quad(material,[-1,-1,0],[1,1,0],'front');
 const cam=cameraAt(),size:[number,number]=[16,16];
 const ids=rasterVisibilityIds([page],cam,size);
 const depth=visibilityDepth(ids,[page],cam,size);
 assert.equal(depth.length,16*16);
 const center=depth[((16/2)|0)*16+((16/2)|0)];
 assert.ok(center<1);
 assert.ok(center>0);
 let background=0;
 for(let i=0;i<depth.length;i++)if(ids[i]===0){assert.equal(depth[i],HIZ_BACKGROUND);background++;}
 assert.ok(background>0);
 geometry.dispose();material.dispose();
});

test('a box that crosses the near plane is never Hi-Z rejected',()=>{
 const cam=cameraAt(0.5,.1);
 const bounds=projectBoxToScreen([-2,-2,-2],[2,2,2],new THREE.Matrix4(),cam,[32,32]);
 assert.equal(bounds.clipsNear,true);
 const depth=new Float32Array(32*32);depth.fill(0.2);
 const pyramid=buildHizPyramid(depth,32,32);
 assert.equal(hizRejects(pyramid,bounds),false);
});

test('the screen rectangle is rounded outward and a single background hole cannot hide',()=>{
 const depth=new Float32Array(4);depth.set([0.2,0.3,0.4,1]);
 const pyramid=buildHizPyramid(depth,2,2);
 const bounds=projectBoxToScreen([-1,-1,0],[1,1,0],new THREE.Matrix4(),cameraAt(),[2,2]);
 assert.equal(bounds.clipsNear,false);
 assert.ok(bounds.minX<=0&&bounds.minY<=0);
 assert.ok(bounds.maxX>=2&&bounds.maxY>=2);
 assert.equal(hizRejects(pyramid,bounds),false);
});

test('an integer-edge screen max includes that pixel so a hole there cannot hide',()=>{
 const depth=new Float32Array(16);depth.fill(0.2);
 depth[2*4+2]=1;
 const pyramid=buildHizPyramid(depth,4,4);
 assert.equal(hizRejects(pyramid,{minX:0,minY:0,maxX:2,maxY:2,nearestDepth:0.8,clipsNear:false}),false);
});

test('pages that cross the near plane are not used as Hi-Z occluders',()=>{
 const cam=cameraAt(0.5,.1);
 const crossing=quad(new THREE.MeshBasicMaterial(),[-2,-2,-2],[2,2,2],'crossing');
 const far=quad(new THREE.MeshBasicMaterial(),[-0.2,-0.2,-2],[0.2,0.2,-2],'far');
 const {occluders,rest}=splitOccluders([crossing.page,far.page],cam,[16,16]);
 assert.equal(occluders.some(page=>page.url==='crossing'),false);
 assert.ok(rest.some(page=>page.url==='crossing'));
 crossing.geometry.dispose();far.geometry.dispose();crossing.page.material.dispose();far.page.material.dispose();
});

test('Hi-Z rejects a fully covered farther page and keeps a page beside a hole',()=>{
 const frontMat=new THREE.MeshBasicMaterial({color:0xff0000});
 const backMat=new THREE.MeshBasicMaterial({color:0x00ff00});
 const holeMat=new THREE.MeshBasicMaterial({color:0x0000ff});
 const front=quad(frontMat,[-1,-1,0],[1,1,0],'front');
 const back=quad(backMat,[-0.2,-0.2,-2],[0.2,0.2,-2],'back');
 const hole=quad(holeMat,[-1,-1,0],[0,1,0],'hole');
 const open=quad(backMat,[0.35,-0.2,-2],[0.8,0.2,-2],'open');
 const cam=cameraAt(),size:[number,number]=[32,32];
 const occluderIds=rasterVisibilityIds([front.page],cam,size);
 const occluderDepth=visibilityDepth(occluderIds,[front.page],cam,size);
 const pyramid=buildHizPyramid(occluderDepth,32,32);
 const selected=[front.page,back.page];
 const remaining=filterUnoccluded(selected,pyramid,cam,size);
 assert.deepEqual(remaining.map(page=>page.url),['front']);
 assert.ok(remaining.every(page=>selected.includes(page)));
 const holeIds=rasterVisibilityIds([hole.page],cam,size);
 const holePyramid=buildHizPyramid(visibilityDepth(holeIds,[hole.page],cam,size),32,32);
 const beside=filterUnoccluded([hole.page,open.page],holePyramid,cam,size);
 assert.ok(beside.some(page=>page.url==='open'));
 front.geometry.dispose();back.geometry.dispose();hole.geometry.dispose();open.geometry.dispose();
 frontMat.dispose();backMat.dispose();holeMat.dispose();
});

test('Hi-Z remaining pages are a subset of the selected cut and never punch a beauty hole',()=>{
 const frontMat=new THREE.MeshBasicMaterial({color:0xff0000});
 const backMat=new THREE.MeshBasicMaterial({color:0x00ff00});
 const front=quad(frontMat,[-1,-1,0],[1,1,0],'front');
 const back=quad(backMat,[-0.2,-0.2,-2],[0.2,0.2,-2],'back');
 const cam=cameraAt(),size:[number,number]=[32,32];
 const selected=[front.page,back.page];
 const {occluders,rest}=splitOccluders(selected,cam,size);
 assert.deepEqual(occluders.map(page=>page.url),['front']);
 assert.deepEqual(rest.map(page=>page.url),['back']);
 const ids=rasterVisibilityIds(occluders,cam,size);
 const remaining=filterUnoccluded(selected,buildHizPyramid(visibilityDepth(ids,occluders,cam,size),32,32),cam,size);
 assert.ok(remaining.every(page=>selected.includes(page)));
 const full=shadeVisibility(rasterVisibilityIds(selected,cam,size),selected,cam,size);
 const filtered=shadeVisibility(rasterVisibilityIds(remaining,cam,size),remaining,cam,size);
 assert.equal(compareImages(full,filtered).maxChannelError,0);
 front.geometry.dispose();back.geometry.dispose();frontMat.dispose();backMat.dispose();
});

test('temporal Hi-Z reprojects previous depth pyramid and handles disocclusion smoothly',()=>{
 const frontMat=new THREE.MeshBasicMaterial({color:0xff0000});
 const backMat=new THREE.MeshBasicMaterial({color:0x00ff00});
 const front=quad(frontMat,[-1,-1,0],[1,1,0],'front');
 const back=quad(backMat,[-0.2,-0.2,-2],[0.2,0.2,-2],'back');
 const size:[number,number]=[32,32];
 const history:TemporalHizState={};

 // Frame 0: Front directly occludes back. History is populated.
 const cam0=cameraAt(5);
 const res0=applyTemporalHiz([front.page,back.page],cam0,size,history);
 assert.deepEqual(res0.shown.map(p=>p.url),['front']);
 assert.equal(res0.hizRejected,1);
 assert.ok(history.pyramid);
 assert.ok(history.camera);

 // Frame 1: Same camera pose. Front remains occluder, back remains rejected.
 const res1=applyTemporalHiz([front.page,back.page],cam0,size,history);
 assert.deepEqual(res1.shown.map(p=>p.url),['front']);
 assert.equal(res1.hizRejected,1);

 // Frame 2: Camera shifts to the side so back is no longer occluded by front.
 const cam2=new THREE.PerspectiveCamera(55,1,0.1,100);
 cam2.position.set(5,0,2);
 cam2.lookAt(0,0,-1);
 cam2.updateMatrixWorld();
 const res2=applyTemporalHiz([front.page,back.page],cam2,size,history);
 // Both front and back should be shown now (disoccluded!)
 assert.ok(res2.shown.some(p=>p.url==='back'));
 assert.ok(res2.shown.some(p=>p.url==='front'));
 assert.equal(res2.hizRejected,0);

 front.geometry.dispose();back.geometry.dispose();frontMat.dispose();backMat.dispose();
});

test('flat projection and split reproduce the object forms to the bit, including depth ties',()=>{
 let seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)>>>0;return seed/4294967296;};
 const pages:HizPage[]=[];
 for(let i=0;i<300;i++){
  const centre=[rnd()*20-10,rnd()*20-10,-rnd()*40],half=[rnd()*2+0.01,rnd()*2+0.01,rnd()*2+0.01];
  const matrix=new THREE.Matrix4().makeRotationY(rnd()*6).setPosition(rnd()*4-2,rnd()*4-2,rnd()*4-2);
  pages.push({min:centre.map((value,axis)=>value-half[axis]),max:centre.map((value,axis)=>value+half[axis]),matrix});
 }
 // Copies of existing boxes give the sort exactly equal depths, where the index tie-break decides.
 for(let i=0;i<30;i++)pages.push({...pages[i]});
 const camera=new THREE.PerspectiveCamera(60,16/9,0.1,200);
 camera.position.set(1,2,3);camera.lookAt(0,0,-20);camera.updateProjectionMatrix();camera.updateMatrixWorld();
 const viewport:[number,number]=[1280,720];
 const flat=new Float64Array(pages.length*HIZ_BOUNDS_VALUES);
 projectBoxesFlat(pages,pages.length,camera,viewport,flat);
 for(let i=0;i<pages.length;i++){
  const reference=projectBoxToScreen(pages[i].min,pages[i].max,pages[i].matrix,camera,viewport),base=i*HIZ_BOUNDS_VALUES;
  assert.equal(flat[base+5]!==0,reference.clipsNear);
  if(reference.clipsNear)continue;
  assert.deepEqual([flat[base],flat[base+1],flat[base+2],flat[base+3],flat[base+4]],
   [reference.minX,reference.minY,reference.maxX,reference.maxY,reference.nearestDepth]);
 }
 // The same rectangles when the world corners are kept across images, including a second image that
 // reads the cache instead of rebuilding it: a hoisted corner is the same double, not a rounded one.
 const corners=createBoxCorners(pages.length),pageIndex=new Int32Array(pages.length).map((_,index)=>index);
 const cached=new Float64Array(flat.length);
 for(const pass of [0,1]){
  cached.fill(0);
  projectBoxesFlat(pages,pages.length,camera,viewport,cached,undefined,{corners,pageIndex,epoch:1});
  assert.deepEqual([...cached],[...flat],`image ${pass} avec coins gardés`);
 }
 const rest=new Uint8Array(pages.length),occluders=splitOccludersFlat(pages.length,flat,rest);
 const tagged=pages.map((page,index)=>({...page,tag:index}));
 const reference=splitOccluders(tagged,camera,viewport);
 assert.equal(occluders,reference.occluders.length);
 const referenceOccluders=new Set(reference.occluders.map(page=>page.tag));
 for(let i=0;i<pages.length;i++)assert.equal(rest[i]===0,referenceOccluders.has(i),`page ${i}`);
});

test('the CPU occlusion oracle counts the clusters and the triangles it eliminated',()=>{
 const frontMat=new THREE.MeshBasicMaterial({color:0xff0000});
 const backMat=new THREE.MeshBasicMaterial({color:0x00ff00});
 const front=quad(frontMat,[-1,-1,0],[1,1,0],'front');
 const back=quad(backMat,[-0.2,-0.2,-2],[0.2,0.2,-2],'back');
 // Close enough that the near quad is wider than the test kernel and answers from a coarser mip.
 const cam=cameraAt(2.2),size:[number,number]=[32,32];
 const frontBounds=projectBoxToScreen(front.page.min,front.page.max,front.page.matrix,cam,size);
 assert.equal(hizOversized(frontBounds.minX,frontBounds.minY,frontBounds.maxX,frontBounds.maxY,frontBounds.clipsNear),true);
 const ids=rasterVisibilityIds([front.page],cam,size);
 const pyramid=buildHizPyramid(visibilityDepth(ids,[front.page],cam,size),32,32);
 const counts=createHizCounts();
 const kept=countUnoccluded([front.page,back.page],pyramid,cam,size,counts);
 assert.deepEqual(kept.map(page=>page.url),['front']);
 // Two clusters of two triangles each: the covered one is eliminated, the wide occluder is not.
 assert.deepEqual(counts,{tested:2,rejected:1,oversized:1,testedTriangles:4,rejectedTriangles:2,oversizedTriangles:2});
 front.geometry.dispose();back.geometry.dispose();frontMat.dispose();backMat.dispose();
});

test('the temporal Hi-Z fallback reports the counts of the image it just cut',()=>{
 const frontMat=new THREE.MeshBasicMaterial({color:0xff0000});
 const backMat=new THREE.MeshBasicMaterial({color:0x00ff00});
 const front=quad(frontMat,[-1,-1,0],[1,1,0],'front');
 const back=quad(backMat,[-0.2,-0.2,-2],[0.2,0.2,-2],'back');
 const size:[number,number]=[32,32],history:TemporalHizState={},counts=createHizCounts();
 const cut=applyTemporalHiz([front.page,back.page],cameraAt(5),size,history,counts);
 assert.equal(cut.counts,counts);
 assert.equal(counts.rejected,cut.hizRejected);
 assert.equal(counts.tested,1);
 assert.equal(counts.rejected,1);
 assert.equal(counts.rejectedTriangles,2);
 assert.equal(counts.testedTriangles,2);
 // A second image over the same counters restates that image alone instead of accumulating.
 applyTemporalHiz([front.page,back.page],cameraAt(5),size,history,counts);
 assert.equal(counts.tested,1);
 assert.equal(counts.rejected,1);
 front.geometry.dispose();back.geometry.dispose();frontMat.dispose();backMat.dispose();
});
