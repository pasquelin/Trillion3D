import test from 'node:test';import assert from 'node:assert/strict';
import {classifyTopology} from './topology.mjs';
import {buildLodTree,clusterAdjacency,certifiedLodError,preservesBoundary} from './lod.mjs';

test('LOD replacement keeps the exact oriented border and a conservative distance bound',()=>{
 const quad=[0,1,2,0,2,3];
 assert.equal(preservesBoundary(quad,quad),true);
 assert.equal(preservesBoundary(quad,[0,1,2]),false);
 assert.equal(preservesBoundary(quad,[0,2,1,0,2,3]),false);
 assert.equal(certifiedLodError([0,0,0],[2,3,6]),7);
});

function manifoldStrip(triangles){
 const indices=[];
 for(let i=0;i<triangles;i++){
  if(i%2===0)indices.push(i,i+1,i+2);
  else indices.push(i+1,i,i+2);
 }
 const positions=[];
 for(let i=0;i<triangles+2;i++)positions.push(i,0,0);
 return {positions,indices};
}
function countInternal(node){
 if(node.type==='leaf')return 0;
 return 1+node.children.reduce((n,child)=>n+countInternal(child),0);
}
function countLeaves(node){
 if(node.type==='leaf')return 1;
 return node.children.reduce((n,child)=>n+countLeaves(child),0);
}

test('four adjacent clusters merge into a binary LOD tree with coarse meshes on internal nodes',()=>{
 const {positions,indices}=manifoldStrip(4);
 const clusters=[[0],[1],[2],[3]];
 const topology=classifyTopology(indices,positions.length/3);
 assert.equal(topology.manifold,true);
 const adj=clusterAdjacency(clusters,topology.neighbors);
 assert.ok(adj[0].includes(1));
 const tree=buildLodTree(positions,indices,clusters,topology.neighbors);
 assert.equal(tree.type,'node');
 assert.equal(countLeaves(tree),4);
 assert.equal(countInternal(tree),3);
 assert.ok(Array.isArray(tree.coarseIndices));
 assert.ok(tree.coarseIndices.length/3<=4);
 assert.ok(tree.errorObject>=0);
 assert.equal(tree.children.length,2);
 for(const child of tree.children){
  if(child.type==='node'){
   assert.ok(child.coarseIndices.length/3<=child.triangles.length);
   assert.ok(child.children.length>=1);
  }else assert.equal(child.type,'leaf');
 }
});

test('a single cluster stays a leaf so the compiler can attach a one-level coarse page',()=>{
 const {positions,indices}=manifoldStrip(2);
 const tree=buildLodTree(positions,indices,[[0,1]],classifyTopology(indices,positions.length/3).neighbors);
 assert.equal(tree.type,'leaf');
 assert.equal(tree.clusterIndex,0);
});

function leafIds(node){
 if(node.type==='leaf')return [node.clusterIndex];
 return node.children.flatMap(leafIds);
}

test('disconnected clusters preserve all leaves in lod tree',()=>{
 const {positions:p1,indices:i1}=manifoldStrip(2);
 const {positions:p2,indices:i2}=manifoldStrip(2);
 const positions=[...p1];
 const offset=positions.length/3;
 for(let i=0;i<p2.length;i+=3)positions.push(p2[i]+100,p2[i+1],p2[i+2]);
 const indices=[...i1,...i2.map(idx=>idx+offset)];
 const clusters=[[0],[1],[2],[3]];
 const topology=classifyTopology(indices,positions.length/3);
 const tree=buildLodTree(positions,indices,clusters,topology.neighbors);
 assert.equal(countLeaves(tree),4);
 assert.deepEqual(leafIds(tree).sort((a,b)=>a-b),[0,1,2,3]);
 assert.equal(tree.type,'node');
 assert.equal(tree.reduced,false);
 assert.equal(tree.mesh.length,0);
});
