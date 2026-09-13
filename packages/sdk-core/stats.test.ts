import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,frameStatistics} from './index.ts';

test('summarize and frameStatistics share percentile and the 50 ms stutter threshold',()=>{
 const stats=summarize([10,20,30,40,60]);
 assert.equal(stats?.p50,30);
 assert.equal(stats?.max,60);
 const cadence=frameStatistics([10,20,30,40,60]);
 assert.equal(cadence.stutters,1);
 assert.equal(frameStatistics([10,20,30,40,49]).stutters,0);
});
