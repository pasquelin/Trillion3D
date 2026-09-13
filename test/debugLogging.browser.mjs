import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const labRoot=process.env.LAB_ROOT??resolve('../render-tech-lab');
const {chromium}=createRequire(resolve(labRoot,'package.json'))('playwright');
const origin=process.env.LAB_URL??'http://localhost:5174';
const output=resolve('benchmark-runs/debug-logging');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
let progressTimer;
try{
 const page=await browser.newPage({viewport:{width:1400,height:1100}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 progressTimer=setInterval(()=>{void page.locator('main').innerText({timeout:5000}).then(text=>console.log(JSON.stringify({progress:text.slice(-650),errors}))).catch(()=>{});},30000);
 await page.goto(`${origin}/?test=15-virtualized-integration`);
 await page.locator('#model-debug').waitFor();
 assert.equal(await page.locator('#model-debug').inputValue(),'trace');
 assert.equal(await page.locator('canvas').count(),0,'debug must not start the engine');
 await page.locator('#model-debug').selectOption('summary');
 assert.equal(await page.locator('#model-debug').inputValue(),'summary');
 await page.locator('#model-debug').selectOption('trace');
 for(const width of [700,1400]){
  await page.setViewportSize({width,height:1100});
  assert.ok(await page.locator('#model-debug').isVisible());
  assert.ok(await page.locator('#model-debug').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
  await page.screenshot({path:resolve(output,`debug-${width}.png`)});
 }
 await page.locator('[data-model-availability="ready"]').waitFor({timeout:60000});
 await page.getByRole('radio',{name:/Parcours reproductible/}).click();
 const archived=page.waitForResponse(response=>response.url().includes('/api/save-report')&&response.request().method()==='POST',{timeout:300000});
 void archived.catch(()=>{});
 await page.locator('main').getByRole('button',{name:/^Lancer le parcours/}).first().click();
 await page.waitForFunction(()=>!document.querySelector('#model-debug')||document.querySelector('#model-debug').disabled===true);
 const response=await archived;
 assert.ok(response.ok(),`archive status ${response.status()}`);
 const archive=await response.json();
 const checked=await promisify(execFile)(process.execPath,['--experimental-strip-types',resolve('test/debugLogging.archive.mjs'),archive.package.directory],{env:{...process.env,LAB_ROOT:labRoot},maxBuffer:1024*1024});
 const summary=JSON.parse(checked.stdout);
 assert.equal(summary.status,'passed');
 assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'result.json'),JSON.stringify({...summary,archive,errors},null,2));
 console.log(JSON.stringify(summary));
}finally{clearInterval(progressTimer);await browser.close();}
