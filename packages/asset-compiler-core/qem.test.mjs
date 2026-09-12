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
