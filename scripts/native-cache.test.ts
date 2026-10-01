import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('deployment cannot populate the native cache that lets Quality skip Rust checks', () => {
  const workflow = (name: string) =>
    readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
  const pages = workflow('pages'),
    quality = workflow('quality');
  assert.match(
    pages,
    /uses: Swatinem\/rust-cache@v2\s+with:\s+(?:#[^\n]*\n\s*)?prefix-key: deployment-rust/,
  );
  assert.doesNotMatch(pages, /\.github\/actions\/native-cache|actions\/cache\/save/);
  assert.doesNotMatch(quality, /prefix-key: deployment-rust/);
  const validated = quality.indexOf('run: pnpm run validate --group native');
  const saved = quality.indexOf('uses: actions/cache/save@v4');
  assert.ok(validated >= 0 && saved > validated, 'only validated binaries certify native gates');
  assert.match(quality.slice(saved), /key: \$\{\{ steps\.native\.outputs\.key \}\}/);
});
