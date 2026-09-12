import test from 'node:test';import assert from 'node:assert/strict';
import {classifyTopology} from './topology.mjs';

test('triangle has three boundary edges and three boundary vertices',()=>{
 const report=classifyTopology([0,1,2],3);
 assert.equal(report.edges.boundary,3);
 assert.equal(report.edges.manifold,0);
 assert.equal(report.edges.nonManifold,0);
 assert.equal(report.vertices.boundary,3);
 assert.equal(report.vertices.interior,0);
 assert.equal(report.vertices.locked,0);
 assert.equal(report.manifold,true);
});

test('two triangles sharing an edge are a manifold quad',()=>{
 const report=classifyTopology([0,1,2,0,2,3],4);
 assert.equal(report.edges.boundary,4);
 assert.equal(report.edges.manifold,1);
 assert.equal(report.edges.nonManifold,0);
 assert.equal(report.vertices.boundary,4);
 assert.equal(report.vertices.interior,0);
 assert.equal(report.manifold,true);
});

test('closed tetrahedron is manifold with interior-free vertices on a closed surface',()=>{
 const report=classifyTopology([0,1,2,0,3,1,1,3,2,0,2,3],4);
 assert.equal(report.edges.boundary,0);
 assert.equal(report.edges.manifold,6);
 assert.equal(report.edges.nonManifold,0);
 assert.equal(report.vertices.interior,4);
 assert.equal(report.vertices.boundary,0);
 assert.equal(report.manifold,true);
});

test('torus is a closed manifold with no boundary edges',()=>{
 const radial=8,tubular=6,indices=[];
 for(let i=0;i<radial;i++)for(let j=0;j<tubular;j++){
  const a=i*tubular+j,b=i*tubular+(j+1)%tubular,c=((i+1)%radial)*tubular+j,d=((i+1)%radial)*tubular+(j+1)%tubular;
  indices.push(a,c,b,b,c,d);
 }
 const report=classifyTopology(indices,radial*tubular);
 assert.equal(report.edges.boundary,0);
 assert.equal(report.edges.manifold,radial*tubular*3);
 assert.equal(report.vertices.interior,radial*tubular);
 assert.equal(report.manifold,true);
});
test('three triangles sharing one edge are non-manifold and lock the vertices',()=>{
 const report=classifyTopology([0,1,2,0,1,3,0,1,4],5);
 assert.equal(report.edges.nonManifold,1);
 assert.equal(report.manifold,false);
 assert.ok(report.vertices.locked>=2);
});
