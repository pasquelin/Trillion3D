import test from 'node:test';import assert from 'node:assert/strict';
import {assertFormat,EngineError,FORMAT_VERSION,compareImages} from './index.ts';
test('Public core imports without DOM and rejects unknown format with a structured code',()=>{assert.equal(typeof (globalThis as {document?:unknown}).document,'undefined');assertFormat(FORMAT_VERSION);assert.throws(()=>assertFormat(999),(error:unknown)=>error instanceof EngineError&&error.code==='UNSUPPORTED_FORMAT');assert.equal(compareImages(new Uint8Array([1,2,3,255]),new Uint8Array([1,2,3,255])).differentPixels,0);});
