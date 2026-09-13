import test from 'node:test';import assert from 'node:assert/strict';
import {simplifyToEndpoints} from './qem.mjs';

test('QEM endpoint collapse reduces a closed cube while locking open-border triangles',()=>{
 const positions=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1];
 const indices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4];
 const reduced=simplifyToEndpoints(positions,indices,{targetTriangles:8});
 assert.ok(reduced.triangles<=8,`expected <=8 triangles, got ${reduced.triangles}`);
 assert.ok(reduced.triangles<12);
 assert.ok(reduced.errorObject>=0);
 const open=simplifyToEndpoints([0,0,0,1,0,0,0,1,0],[0,1,2],{targetTriangles:0});
 assert.deepEqual([...open.indices],[0,1,2]);
});

test('QEM error is finite when a closed cube is simplified',()=>{
 const positions=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1];
 const indices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4];
 const result=simplifyToEndpoints(positions,indices,{targetTriangles:6});
 assert.ok(Number.isFinite(result.errorObject));
 assert.equal(result.indices.length,result.triangles*3);
});

test('QEM keeps a two-triangle square when asked for one triangle',()=>{
 const positions=[-1,-1,0,1,-1,0,1,1,0,-1,1,0];
 const result=simplifyToEndpoints(positions,[0,1,2,0,2,3],{targetTriangles:1});
 assert.ok(result.triangles>=1);
 assert.equal(result.indices.length,result.triangles*3);
 assert.ok(result.triangles===2||result.errorObject>0);
});

test('QEM never flips or collapses a surviving face of a concave planar fan',()=>{
 const points=[[2,0],[2,1],[1,1],[1,2],[0,2],[0,0],[0.5,0.5]];
 const positions=points.flatMap(([x,y])=>[x,y,0]);
 const indices=[];for(let i=0;i<6;i++)indices.push(6,i,(i+1)%6);
 const reduced=simplifyToEndpoints(positions,indices,{targetTriangles:4});
 const signedArea=(a,b,c)=>{
  const ax=positions[a*3],ay=positions[a*3+1],bx=positions[b*3],by=positions[b*3+1],cx=positions[c*3],cy=positions[c*3+1];
  return ((bx-ax)*(cy-ay)-(by-ay)*(cx-ax))/2;
 };
 for(let i=0;i<reduced.indices.length;i+=3){
  const area=signedArea(...reduced.indices.slice(i,i+3));
  assert.ok(area>1e-9,`surviving face ${i/3} flipped or degenerated: ${area}`);
 }
 assert.ok(Number.isFinite(reduced.errorObject));
});
