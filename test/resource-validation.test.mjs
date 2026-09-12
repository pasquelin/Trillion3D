import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorer } from '@web-geometry/sdk/browser';
for (const [label,body,status,type,code] of [
 ['SPA HTML','<!DOCTYPE html>',200,'text/html','INVALID_JSON_RESPONSE'],
 ['missing resource','missing',404,'text/plain','RESOURCE_HTTP_ERROR'],
 ['wrong pointer schema','{}',200,'application/json','INVALID_POINTER'],
]) test(label+' is rejected before renderer creation',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(body,{status,headers:{'Content-Type':type}}));
 await assert.rejects(createExplorer({}, {manifestUrl:'http://localhost/cache/manifest.json',scope:'full'}),error=>{
  assert.equal(error.code,code);assert.match(error.message,/manifest\.json/);assert.equal(error.details.status,status);assert.equal(error.details.contentType,type);return true;
 });
});
