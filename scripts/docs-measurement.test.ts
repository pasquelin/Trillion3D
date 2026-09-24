import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MEASUREMENT_TAG, withMeasurement } from './docs/measurement.ts';

const root = resolve(import.meta.dirname, '..');

test('the tag is added before the head closes, indented inside it', () => {
  const page = '<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n</html>\n';
  const built = withMeasurement(page);
  assert.equal(built, page.replace('  </head>', `    ${MEASUREMENT_TAG}\n  </head>`));
  assert.ok(built.indexOf(MEASUREMENT_TAG) < built.indexOf('</head>'), 'inside the head');
});

test('a page already carrying the tag is left alone', () => {
  const page = `<html><head>${MEASUREMENT_TAG}</head></html>`;
  assert.equal(withMeasurement(page), page);
});

test('a fragment without a head is copied unchanged', () => {
  assert.equal(withMeasurement('<!doctype html>'), '<!doctype html>');
  assert.equal(withMeasurement('<div>partial</div>'), '<div>partial</div>');
});

/* The guarantee that matters: not that the function can inject a tag, but that every page this
   repository publishes actually receives one. A page written without a `</head>` would be
   served unmeasured and nothing else would notice. */
test('every page of the sources can carry the measurement', async () => {
  const pages: string[] = [];
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.html')) pages.push(path);
    }
  };
  await walk(resolve(root, 'site'));

  assert.ok(pages.length > 30, `the site has ${pages.length} pages`);
  const missing: string[] = [];
  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    if (!withMeasurement(html).includes(MEASUREMENT_TAG)) missing.push(page);
  }
  assert.deepEqual(missing, [], 'these pages have no </head> to carry the measurement');
});
