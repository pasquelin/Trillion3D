import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_SCENARIOS,makeCameraPath,type CameraPose} from './index.ts';

const home: CameraPose = {position:[2,1,2],target:[0,0,0],fov:55,near:0.1,far:100};

test('makeCameraPath keeps a stationary camera on the home pose',()=>{
 const path=makeCameraPath('stationary',home,4);
 assert.equal(path.length,4);
 for(const pose of path)assert.deepEqual(pose.position,home.position);
});

test('CAMERA_SCENARIOS expose implemented geometric paths and mark the rest unavailable',()=>{
 const implemented=new Set(CAMERA_SCENARIOS.filter(s=>s.available).map(s=>s.id));
 assert.deepEqual([...implemented].sort(),['fast-orbit','initial-load','near-far','round-trip','slow-orbit','stationary']);
 assert.equal(CAMERA_SCENARIOS.find(s=>s.id==='round-trip')?.scope.includes('no eviction'),false);
});
