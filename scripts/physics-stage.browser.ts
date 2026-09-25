// The physics-stage proof of `ten-thousand-bodies` (#463): the example opened with `?profile`, its
// one-second profile windows (`window.__profile`, kit `profile.ts`) read after a warm-up, and the
// page's `physics` CPU stage, the worker's step and the frame rate printed as JSON.
//
//   node scripts/physics-stage.browser.ts [--warmup 5] [--windows 10] [--headed]
//
// Runs Chrome: the measurer's only (AGENTS.md rule 2).
import { parseArgs } from 'node:util';
import { launchChrome } from '../bench/runner/chrome.ts';
import { readyEntries } from '../site/app/examples/list.ts';
import type { ProfileWindow } from '../site/examples/kit/profile.ts';
import { startDocsServer } from './docs-serve.ts';
import { openExample } from './docs/examples/capture.ts';
import { physicsStageReading } from './physics-stage.ts';

const { values } = parseArgs({
  options: {
    warmup: { type: 'string', default: '5' },
    windows: { type: 'string', default: '10' },
    headed: { type: 'boolean', default: false },
  },
});
const entry = readyEntries.find(({ id }) => id === 'ten-thousand-bodies');
if (!entry) throw new Error('ten-thousand-bodies is not a ready example');

const { server, port } = await startDocsServer();
const browser = await launchChrome({ headless: !values.headed });
try {
  const opened = await openExample(
    browser,
    port,
    { ...entry, file: `${entry.file}?profile` },
    { width: 1280, height: 720 },
  );
  if (opened.errors.length) throw new Error(opened.errors.join('\n'));
  const windows = await opened.page.evaluate(
    async ({ warmup, count }) => {
      const read = () => (globalThis as { __profile?: ProfileWindow }).__profile;
      const kept: ProfileWindow[] = [],
        start = performance.now(),
        deadline = start + (warmup + count + 10) * 1000;
      let last = read();
      while (kept.length < count) {
        if (performance.now() > deadline) throw new Error('no profile window published');
        await new Promise((next) => setTimeout(next, 100));
        const latest = read();
        if (!latest || latest === last) continue;
        last = latest;
        if (performance.now() - start >= warmup * 1000) kept.push(latest);
      }
      return kept;
    },
    { warmup: Number(values.warmup), count: Number(values.windows) },
  );
  console.log(JSON.stringify(physicsStageReading(windows), null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
