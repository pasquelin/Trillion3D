import test from 'node:test';import assert from 'node:assert/strict';
import {classifyTopology} from './topology.mjs';
import {exactClusters,greedyClusters} from './cluster.mjs';

test('exact clusters slice triangles in source order with 256-triangle pages',()=>{
 const clusters=exactClusters(300*3);
 assert.equal(clusters.length,2);
 assert.deepEqual(clusters[0],Array.from({length:256},(_,i)=>i));
 assert.deepEqual(clusters[1],Array.from({length:44},(_,i)=>256+i));
});

test('greedy clusters cover every triangle once and grow through manifold neighbours',()=>{
 const indices=[];
 for(let i=0;i<6;i++){
  if(i%2===0)indices.push(i,i+1,i+2);
  else indices.push(i+1,i,i+2);
 }
 const topology=classifyTopology(indices,8);
 assert.equal(topology.manifold,true);
 const clusters=greedyClusters(indices,topology.neighbors,{maxTriangles:2,maxVertices:8});
 assert.deepEqual(clusters.flat().sort((a,b)=>a-b),[0,1,2,3,4,5]);
 assert.ok(clusters.every(cluster=>cluster.length<=2));
 for(const cluster of clusters){
  if(cluster.length<2)continue;
  const set=new Set(cluster);
  assert.ok(cluster.some(triangle=>topology.neighbors[triangle].some(neighbour=>set.has(neighbour))));
 }
});

test('greedy clusters respect the unique-vertex budget',()=>{
 const indices=[0,1,2,0,2,3,0,3,4];
 const topology=classifyTopology(indices,5);
 const clusters=greedyClusters(indices,topology.neighbors,{maxTriangles:8,maxVertices:4});
 assert.ok(clusters.every(cluster=>{
  const vertices=new Set();
  for(const triangle of cluster)for(let k=0;k<3;k++)vertices.add(indices[triangle*3+k]);
  return vertices.size<=4;
 }));
 assert.deepEqual(clusters.flat().sort((a,b)=>a-b),[0,1,2]);
 assert.ok(clusters.some(cluster=>cluster.length>=2));
});

test('greedy clusters cover a long strip from the adjacency frontier',()=>{
 const indices=[];
 for(let i=0;i<64;i++){
  if(i%2===0)indices.push(i,i+1,i+2);
  else indices.push(i+1,i,i+2);
 }
 const topology=classifyTopology(indices,66);
 const clusters=greedyClusters(indices,topology.neighbors,{maxTriangles:8,maxVertices:16});
 assert.deepEqual(clusters.flat().sort((a,b)=>a-b),Array.from({length:64},(_,i)=>i));
 assert.ok(clusters.every(cluster=>cluster.length<=8));
});
