import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticChannel} from './diagnosticChannel.ts';

const event=(phase:string,kind='lifecycle')=>({phase,message:phase,context:{kind}});

test('diagnostic delivery is deferred, isolated from throwing observers, and idempotent',async()=>{
 const seen:unknown[]=[];
 const channel=createDiagnosticChannel(record=>{seen.push(record);throw new Error('observer failure');},{sessionId:'test-session',now:()=>1700000000000});
 channel.emit(event('one'));
 assert.equal(seen.length,0);
 await channel.flush();
 assert.equal(seen.length,1);
 const delivered=seen[0] as {sequence:number;sessionId:string;queuedAt:number;createdAt:number};
 assert.equal(delivered.sequence,1);
 assert.equal(delivered.sessionId,'test-session');
 assert.equal(delivered.queuedAt,1700000000000);
 assert.equal(delivered.createdAt,1700000000000);
 await channel.flush();
 assert.equal(seen.length,1);
});

test('bounded overflow emits an explicit loss record and keeps sequence provenance',async()=>{
 const seen:{phase:string;sequence?:number;context:Record<string,unknown>}[]=[];
 const channel=createDiagnosticChannel(record=>seen.push(record),{maxBuffer:2,now:()=>1700000000100});
 channel.emit(event('one'));
 channel.emit(event('two'));
 channel.emit(event('three'));
 channel.emit(event('four'));
 assert.equal(channel.pending(),2);
 assert.equal(channel.dropped(),2);
 await channel.flush();
 assert.deepEqual(seen.map(record=>record.phase),['one','two','diagnostic-loss']);
 assert.deepEqual(seen.map(record=>record.sequence),[1,2,4]);
 assert.equal(seen[2].context.lostCount,2);
 assert.equal(seen[2].context.firstSequence,3);
 assert.equal(seen[2].context.lastSequence,4);
 assert.equal(channel.dropped(),2);
});

test('disabled channels and summary detail do not deliver frame volume',async()=>{
 const disabled:unknown[]=[];
 const off=createDiagnosticChannel(record=>disabled.push(record),{enabled:false});
 off.emit(event('lifecycle'));
 await off.flush();
 assert.equal(disabled.length,0);

 const summary:unknown[]=[];
 const channel=createDiagnosticChannel(record=>summary.push(record),{detail:'summary'});
 channel.emit(event('frame','frame'));
 channel.emit(event('lifecycle'));
 await channel.flush();
 assert.deepEqual((summary as {phase:string}[]).map(record=>record.phase),['lifecycle']);
});

test('flushSync drains a flush already scheduled without double delivery',async()=>{
 const seen:string[]=[];
 const channel=createDiagnosticChannel(record=>seen.push(record.phase));
 channel.emit(event('before-sync'));
 const pending=channel.flush();
 channel.flushSync();
 assert.deepEqual(seen,['before-sync']);
 await pending;
 await channel.flush();
 assert.deepEqual(seen,['before-sync']);
});

test('a deferred backend keeps its original event creation time',async()=>{
 const seen:{createdAt?:number;queuedAt?:number}[]=[];
 const channel=createDiagnosticChannel(record=>seen.push(record),{now:()=>200});
 channel.emit({phase:'backend',message:'created before delivery',context:{createdAt:100}});
 await channel.flush();
 assert.equal(seen[0].createdAt,100);
 assert.equal(seen[0].queuedAt,200);
});
