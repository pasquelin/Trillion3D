import assert from 'node:assert/strict';
import { launchChrome } from '../../scripts/mesure/chrome.ts';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { HIZ_SHADER, hizBindEntries } from '../../packages/sdk-browser/gpuHiz.ts';
import {
  STATE_WORDS,
  ST_TESTED,
  TESTED_U32,
} from '../../packages/sdk-browser/gpuPartitionContract.ts';
import { BOX_NEAREST, cases, height, width } from '../appui/hizCas.ts';
import { executerHiz } from './hizWebgpuPage.ts';

interface HizReport {
  version: number;
  startedAt: string;
  shader: string;
  shaderSha256: string;
  width: number;
  height: number;
  adapter: unknown;
  results: unknown[];
  errors: string[];
  status?: string;
  failure?: string;
  finishedAt?: string;
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>WebGeometry Hi-Z GPU check</title>');
});
await new Promise<void>((ready: () => void, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', ready);
});
const address = server.address();
if (!address || typeof address === 'string') throw Error('HTTP listener unavailable');
const browser = await launchChrome({ headless: true });
const report: HizReport = {
  version: 1,
  startedAt: new Date().toISOString(),
  shader: 'packages/sdk-browser/gpuHiz.ts',
  shaderSha256: createHash('sha256').update(HIZ_SHADER).digest('hex'),
  width,
  height,
  adapter: null,
  results: [],
  errors: [],
};
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const result = await page.evaluate(executerHiz, {
    shader: HIZ_SHADER,
    cases,
    bindEntries: hizBindEntries(256),
    stateWords: STATE_WORDS,
    stTested: ST_TESTED,
    testedU32: TESTED_U32,
    boxNearest: BOX_NEAREST,
  });
  Object.assign(report, result);
  assert.ok(!result.unavailable, result.unavailable);
  assert.deepEqual(result.compilationErrors ?? [], []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.results?.map((item) => item.flag),
    cases.map((item) => item.expected),
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  const out = resolve(process.env.HIZ_RESULT ?? 'benchmark-runs/webgpu-hiz/result.json');
  await mkdir(resolve(out, '..'), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  JSON.stringify({ status: report.status, adapter: report.adapter, results: report.results }),
);
