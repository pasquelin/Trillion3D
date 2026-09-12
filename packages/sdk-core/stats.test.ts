import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,frameStatistics,STUTTER_MS} from './index.ts';

test('summarize and frameStatistics share percentile and stutter threshold',()=>{
 const stats=summarize([10,20,30,40,60]);
 assert.equal(stats?.p50,30);
 assert.equal(stats?.max,60);
 const cadence=frameStatistics([10,20,30,40,60]);
 assert.equal(cadence.stutters,1);
 assert.equal(STUTTER_MS,50);
});
