import test from 'node:test';
import assert from 'node:assert/strict';
import {createCpuStepProfile} from './cpuProfile.ts';

test('a summary ranks the worst images by total, reports a percentile per step, and forgets both',()=>{
 const profile=createCpuStepProfile(['aMs','bMs'],{worst:2});
 for(let frame=1;frame<=5;frame++){profile.row[0]=frame;profile.row[1]=10-frame;profile.record(frame,frame);}
 const summary=profile.summary()!;
 assert.equal(summary.frames,5);
 assert.deepEqual(summary.steps.aMs,{p50:3,p95:5,max:5});
 assert.deepEqual(summary.steps.bMs,{p50:7,p95:9,max:9});
 assert.deepEqual(summary.worst.map(entry=>entry.frame),[5,4]);
 assert.equal(summary.worst[0].aMs,5);
 assert.equal(profile.summary(),null);
});

test('the ring keeps the most recent images once capacity is reached',()=>{
 const profile=createCpuStepProfile(['aMs'],{capacity:2,worst:1});
 for(const value of [1,2,3]){profile.row[0]=value;profile.record(value,value);}
 const summary=profile.summary()!;
 assert.equal(summary.frames,2);
 assert.deepEqual(summary.steps.aMs,{p50:3,p95:3,max:3});
});
