import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ClusterBatches,DrawRanges,IndexRangeAllocator,type BatchPage} from './clusterBatches.ts';

const total=(allocator:IndexRangeAllocator)=>allocator.freeRanges.reduce((sum,range)=>sum+range.length,0);

test('the range allocator hands out disjoint ranges, reuses a freed range and merges neighbours',()=>{
 const allocator=new IndexRangeAllocator(30);
 const a=allocator.allocate(10),b=allocator.allocate(5),c=allocator.allocate(15);
 assert.deepEqual([a,b,c],[0,10,15]);
 assert.equal(allocator.used,30);
 assert.equal(allocator.allocate(1),-1,'plus aucune place');

 allocator.release(b,5);
 assert.equal(allocator.used,25);
 assert.equal(allocator.allocate(5),10,'la plage libérée est reprise telle quelle');

 allocator.release(0,10);allocator.release(10,5);
 assert.equal(allocator.freeRanges.length,1,'les voisins fusionnent');
 assert.deepEqual({...allocator.freeRanges[0]},{offset:0,length:15});
 assert.equal(allocator.allocate(15),0,'la place fusionnée sert une seule demande');
});

test('a fragmented allocator refuses a range larger than every hole, and accepts it after growth',()=>{
 const allocator=new IndexRangeAllocator(10);
 const a=allocator.allocate(5),b=allocator.allocate(3),c=allocator.allocate(2);
 allocator.release(b,3);allocator.release(c,2);
 assert.equal(allocator.used,5);
 assert.equal(allocator.allocate(6),-1,'5 libres mais en deux trous non contigus');
 assert.equal(allocator.freeRanges.length,1,'b et c étaient adjacents : un seul trou de 5');
 assert.equal(allocator.allocate(5),5);
 allocator.release(a,5);
 assert.equal(allocator.allocate(6),-1);
 allocator.grow(4);
 assert.equal(allocator.capacity,14);
 assert.equal(allocator.allocate(6),-1,'la croissance s\'ajoute à la fin, elle ne comble pas le trou de tête');
 assert.equal(allocator.allocate(4),0,'première place libre : le trou de tête');
 assert.equal(allocator.allocate(4),10,'puis la place ajoutée par la croissance');
 assert.equal(total(allocator)+allocator.used,allocator.capacity);
});

test('a randomised allocate/release sequence never overlaps and never loses space',()=>{
 const allocator=new IndexRangeAllocator(256);
 const live:Array<{offset:number;length:number}>=[];
 let seed=7;
 const random=()=>((seed=(seed*1103515245+12345)>>>0)/0x100000000);
 for(let step=0;step<3000;step++){
  if(live.length&&random()<0.5){
   const taken=live.splice(Math.floor(random()*live.length),1)[0];
   allocator.release(taken.offset,taken.length);
  }else{
   const length=1+Math.floor(random()*16);
   const offset=allocator.allocate(length);
   if(offset<0)continue;
   for(const other of live)assert.ok(offset+length<=other.offset||other.offset+other.length<=offset,'plages disjointes');
   live.push({offset,length});
  }
  assert.equal(total(allocator)+allocator.used,allocator.capacity);
 }
});

test('a draw range list merges adjacent ranges, keeps the given order and grows without losing entries',()=>{
 const ranges=new DrawRanges();
 assert.equal(ranges.push(0,4),true);
 assert.equal(ranges.push(4,6),false,'plage adjacente : fusionnée');
 assert.equal(ranges.count,1);
 assert.equal(ranges.counts[0],10);
 assert.equal(ranges.push(20,2),true,'plage disjointe : nouveau sous-dessin');
 assert.deepEqual([...ranges.starts.subarray(0,2)],[0,80]);
 assert.deepEqual([...ranges.counts.subarray(0,2)],[10,2]);
 for(let i=0;i<20;i++)ranges.push(100+i*10,1);
 assert.equal(ranges.count,22);
 assert.equal(ranges.starts[21],(100+19*10)*4);
 ranges.reset();
 assert.equal(ranges.count,0);
});

// --- lots de clusters --------------------------------------------------------------------------

function attributes(count:number){
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(count*3),3));
 return geometry.attributes;
}

type Fixture={pages:BatchPage[];byUrl:Map<string,BatchPage[]>;arrays:Map<string,Uint32Array>};

/** Deux primitives ; la première est instanciée deux fois (renderOrder 0 et 1), la seconde une fois (2). */
function fixture():Fixture{
 const material=new THREE.MeshBasicMaterial();
 const shared=attributes(64),other=attributes(16);
 const pages:BatchPage[]=[];
 const arrays=new Map<string,Uint32Array>();
 const add=(renderOrder:number,attrs:THREE.BufferGeometry['attributes'],id:number,url:string,triangles:number,extra:Partial<BatchPage>={})=>{
  pages.push({id,url,triangles,min:[0,0,0],max:[1,1,1],attributes:attrs,material,matrix:new THREE.Matrix4(),renderOrder,...extra});
  if(!arrays.has(url))arrays.set(url,Uint32Array.from({length:triangles*3},(_unused,i)=>i));
 };
 for(const renderOrder of [0,1]){
  add(renderOrder,shared,0,'a',2);
  add(renderOrder,shared,1,'b',3);
  add(renderOrder,shared,2,'c',1);
 }
 add(2,other,0,'d',4);
 const byUrl=new Map<string,BatchPage[]>();
 for(const page of pages){const list=byUrl.get(page.url)??[];list.push(page);byUrl.set(page.url,list);}
 return {pages,byUrl,arrays};
}

function resident(batches:ClusterBatches,data:Fixture,urls:string[]){
 for(const url of urls){
  const array=data.arrays.get(url)!;
  for(const page of data.byUrl.get(url)!)page.array=array;
  batches.acceptPage(data.byUrl.get(url)!,array);
 }
}
function drawOf(scene:THREE.Scene,renderOrder:number){
 const mesh=scene.children.find(child=>child.renderOrder===renderOrder) as (THREE.Mesh&{_multiDrawStarts:Int32Array;_multiDrawCounts:Int32Array;_multiDrawCount:number})|undefined;
 if(!mesh)return undefined;
 return {
  geometry:mesh.geometry,
  count:mesh._multiDrawCount,
  starts:[...mesh._multiDrawStarts.subarray(0,mesh._multiDrawCount)],
  counts:[...mesh._multiDrawCounts.subarray(0,mesh._multiDrawCount)],
 };
}

test('instances of one primitive share a single resident index buffer written once per page',()=>{
 const scene=new THREE.Scene(),data=fixture();
 const batches=new ClusterBatches(scene,data.pages);
 resident(batches,data,['a','b','c','d']);
 // a=6, b=9, c=3 indices pour la primitive partagée ; d=12 pour l'autre.
 assert.equal(batches.metrics.pageRangeWrites,4,'une écriture par page, pas une par instance');
 assert.equal(batches.metrics.indexBytesWritten,(6+9+3+12)*4);
 assert.equal(batches.indexBytes,(6+9+3+12)*4,'capacité = somme des pages de chaque primitive');

 batches.update(data.pages);
 const first=drawOf(scene,0)!,second=drawOf(scene,1)!,third=drawOf(scene,2)!;
 assert.equal(first.geometry,second.geometry,'les deux instances partagent la géométrie et son index');
 assert.notEqual(first.geometry,third.geometry);
 assert.equal(first.count,1,'les trois pages sont contiguës : un seul sous-dessin');
 assert.deepEqual(first.starts,[0]);
 assert.deepEqual(first.counts,[18]);
 assert.deepEqual(second.counts,[18]);
 assert.deepEqual(third.counts,[12]);
 assert.equal(batches.metrics.drawCalls,3);
 assert.equal(batches.metrics.submittedTriangles,(2+3+1)*2+4);
 assert.equal(scene.children.length,3);
});

test('a cut that changes every frame rewrites no index and detaches the groups it drops',()=>{
 const scene=new THREE.Scene(),data=fixture();
 const batches=new ClusterBatches(scene,data.pages);
 resident(batches,data,['a','b','c','d']);
 batches.update(data.pages);
 const writes=batches.metrics.pageRangeWrites,bytes=batches.metrics.indexBytesWritten;

 // Coupe 2 : l'instance 1 disparaît, l'instance 0 ne garde que les pages a et c (non adjacentes).
 const cut=data.pages.filter(page=>(page.renderOrder===0&&page.url!=='b')||page.renderOrder===2);
 batches.update(cut);
 assert.equal(batches.metrics.pageRangeWrites,writes,'aucune plage réécrite');
 assert.equal(batches.metrics.indexBytesWritten,bytes,'aucun octet d\'index réuploadé');
 assert.equal(drawOf(scene,1),undefined,'le groupe sans page visible est détaché');
 const first=drawOf(scene,0)!;
 assert.equal(first.count,2,'a et c ne sont pas adjacentes : deux sous-dessins');
 assert.deepEqual(first.starts,[0,15*4]);
 assert.deepEqual(first.counts,[6,3]);
 assert.equal(batches.metrics.drawCalls,2);

 // Retour à la coupe complète : le groupe est ré-attaché, toujours sans écriture d'index.
 batches.update(data.pages);
 assert.equal(batches.metrics.pageRangeWrites,writes);
 assert.equal(drawOf(scene,1)!.counts[0],18);
 assert.equal(batches.metrics.drawCalls,3);
});

test('an evicted page frees its range and the next residency reuses it',()=>{
 const scene=new THREE.Scene(),data=fixture();
 const batches=new ClusterBatches(scene,data.pages);
 resident(batches,data,['a','b','c']);
 batches.update(data.pages);
 assert.deepEqual(drawOf(scene,0)!.counts,[18]);

 for(const page of data.byUrl.get('b')!)page.array=undefined;
 batches.dropPage(data.byUrl.get('b')!);
 batches.update(data.pages);
 const partial=drawOf(scene,0)!;
 assert.deepEqual(partial.starts,[0,15*4]);
 assert.deepEqual(partial.counts,[6,3],'a et c restent en place, le trou de b est sauté');

 resident(batches,data,['b']);
 batches.update(data.pages);
 const back=drawOf(scene,0)!;
 assert.equal(back.count,1,'b reprend exactement son trou : tout redevient contigu');
 assert.deepEqual(back.counts,[18]);
});

test('a transparent group draws its pages in source order whatever the order of the cut',()=>{
 const material=new THREE.MeshBasicMaterial({transparent:true});
 const attrs=attributes(64);
 const matrix=new THREE.Matrix4();
 const pages:BatchPage[]=[0,1,2].map(id=>({
  id,url:`t${id}`,triangles:1,min:[0,0,0],max:[1,1,1],attributes:attrs,material,matrix,renderOrder:0,
  transparent:true,sourceOrder:[2,0,1][id],
 }));
 const scene=new THREE.Scene();
 const batches=new ClusterBatches(scene,pages);
 for(const page of pages){const array=Uint32Array.from([0,1,2]);page.array=array;batches.acceptPage([page],array);}
 batches.update([pages[0],pages[1],pages[2]]);
 const forward=drawOf(scene,0)!;
 batches.update([pages[2],pages[0],pages[1]]);
 const shuffled=drawOf(scene,0)!;
 assert.deepEqual(shuffled.starts,forward.starts,'ordre de dessin stable');
 assert.deepEqual(shuffled.counts,forward.counts);
 // sourceOrder = [2,0,1] -> page 1 (plage 3), page 2 (plage 6), page 0 (plage 0) ;
 // les plages 3 et 6 se suivent, elles fusionnent en un seul sous-dessin sans changer l'ordre.
 assert.deepEqual(forward.starts,[3*4,0]);
 assert.deepEqual(forward.counts,[6,3]);
});

test('page urls of a cut are listed once per page, instances included, and diagnostics can hide every batch',()=>{
 const scene=new THREE.Scene(),data=fixture();
 const batches=new ClusterBatches(scene,data.pages);
 resident(batches,data,['a','b','c','d']);
 const urls:string[]=[];
 batches.markUrls(data.pages,1,urls);
 assert.deepEqual(urls.sort(),['a','b','c','d']);
 const again:string[]=[];
 batches.markUrls(data.pages,2,again);
 assert.equal(again.length,4,'une nouvelle estampille redonne la liste complète');

 batches.update(data.pages);
 assert.equal(scene.children.length,3);
 batches.hideAll();
 assert.equal(scene.children.length,0);
 assert.equal(batches.metrics.drawCalls,0);
 batches.update(data.pages);
 assert.equal(scene.children.length,3,'le mode beauté réattache les mêmes lots');
 batches.dispose();
 assert.equal(scene.children.length,0);
});
