#!/usr/bin/env node
import { prepare, createTerminalProgress, isSimplification } from './index.mts';
const [
  input,
  output,
  scope = 'slice',
  budget = '150000',
  resourceBaseUrl,
  threads = '2',
  ramBudgetMb = '256',
  simplification = 'none',
] = process.argv.slice(2);
const triangleBudget = Number(budget);
if (!input || !output || !resourceBaseUrl)
  throw new Error(
    'Usage: web-geometry-compile SOURCE CACHE [slice|full] [triangle-budget] RESOURCE_BASE_URL [threads] [RAM_MB] [none|qem-endpoints|qem-attributes]',
  );
if (scope !== 'slice' && scope !== 'full') throw new Error('scope must be slice or full');
if (!Number.isSafeInteger(triangleBudget) || triangleBudget < 1)
  throw new Error('triangle-budget must be a positive integer');
if (!isSimplification(simplification))
  throw new Error('simplification must be none, qem-endpoints or qem-attributes');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
// A terminal gets a live bar; a pipe (CI, another program) gets the raw JSON events.
const progress =
  process.stderr.isTTY && !process.env.WEB_GEOMETRY_RAW_EVENTS
    ? createTerminalProgress({ label: input })
    : null;
const result = await prepare(input, output, scope, triangleBudget, {
  executable: process.env.WEB_GEOMETRY_COMPILER_BIN,
  resourceBaseUrl,
  threads: Number(threads),
  ramBudgetMb: Number(ramBudgetMb),
  simplification,
  signal: controller.signal,
  onProgress: (event) =>
    progress ? progress.event(event) : process.stderr.write(`${JSON.stringify(event)}\n`),
}).catch((error: unknown) => {
  progress?.fail(error instanceof Error ? error.message : String(error));
  throw error;
});
const {
  status,
  key,
  scope: resultScope,
  url,
  pointer,
  cache,
  selectedTriangles,
  sourceTriangles,
  metrics,
  unsupported,
} = result;
process.stdout.write(
  `${JSON.stringify({ status, key, scope: resultScope, url, pointer, cache, selectedTriangles, sourceTriangles, metrics, unsupported })}\n`,
);
