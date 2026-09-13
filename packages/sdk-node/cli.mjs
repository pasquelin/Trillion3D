#!/usr/bin/env node
import {prepare} from './index.mjs';
const [input,output,scope='slice',budget='150000',resourceBaseUrl]=process.argv.slice(2);
const triangleBudget=Number(budget);
if(!input||!output||!resourceBaseUrl)throw new Error('Usage: web-geometry-compile SOURCE CACHE [slice|full] [triangle-budget] RESOURCE_BASE_URL');
if(!['slice','full'].includes(scope))throw new Error('scope must be slice or full');
if(!Number.isSafeInteger(triangleBudget)||triangleBudget<1)throw new Error('triangle-budget must be a positive integer');
const controller=new AbortController();process.once('SIGINT',()=>controller.abort());
const result=await prepare(input,output,scope,triangleBudget,{executable:process.env.WEB_GEOMETRY_COMPILER_BIN,resourceBaseUrl,signal:controller.signal,onProgress:event=>process.stderr.write(`${JSON.stringify(event)}\n`)});
process.stdout.write(`${JSON.stringify(result)}\n`);
